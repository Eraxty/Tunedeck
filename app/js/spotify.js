// Spotify account link, done entirely on the TV: Authorization Code + PKCE with no client secret.
// The TV helper relays the redirect: the phone opens http://<tv>:8899/login (from a QR code), logs in, and
// Spotify redirects to https://<tv>:8900/callback; the app polls the helper for the code and exchanges it.
// Not named "Spotify": the Web Playback SDK claims window.Spotify when it loads.
var SpotifyApi = (function () {
  var access = null, exp = 0, pendingRefresh = null, poll = null;

  function auth() { return Store.get('spotify', null); }
  function fail(msg, code) { var e = new Error(msg); e.code = code; return e; }
  function b64url(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function randomBytes(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  function form(o) { return Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }

  function helper(path, opts) {
    return fetch(CFG.helper + path, opts).then(function (r) { if (!r.ok) throw new Error('helper ' + r.status); return r.json(); },
      function () { throw fail('The TuneDeck helper is not running on the TV. Reinstall with scripts/deploy.sh.', 'helper'); });
  }

  function tokenRequest(body) {
    return fetch(CFG.spotifyAuth + '/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }, function () { throw fail('Cannot reach Spotify', 'network'); });
  }

  // The Spotify app key (Client ID) this profile signs in with. Everyone brings their own (Spotify allows only
  // 5 accounts per key for apps not run by a company); the phone page sends it to the TV during sign-in.
  function clientId() { var a = auth(); return (a && a.clientId) || Store.get('clientId', null); }

  // Starts a login; resolves with { phoneUrl } to show as a QR code. onDone(err) fires when it finishes.
  // The phone page can send a different key mid-login; the login then restarts with that key.
  function startLogin(onDone) {
    stopLogin();
    return helper('/api/info').then(function (info) {
      var verifier, cid;
      function register() {
        cid = Store.get('clientId', null);
        verifier = b64url(randomBytes(48));
        var state = b64url(randomBytes(16)), challenge = b64url(sha256(new TextEncoder().encode(verifier)));
        // Without a key yet, the phone shows the key setup first; the login URL is made once the key arrives.
        var url = cid ? CFG.spotifyAuth + '/authorize?' + form({ client_id: cid, response_type: 'code', redirect_uri: info.callback,
          scope: CFG.spotifyScopes, state: state, code_challenge_method: 'S256', code_challenge: challenge }) : null;
        return helper('/api/login', { method: 'POST', body: JSON.stringify({ url: url, state: state, clientId: cid }) });
      }
      return register().then(function () {
        poll = setInterval(function () {
          helper('/api/login/result').then(function (r) {
            if (r.clientId) { Store.set('clientId', r.clientId); Log.add('own key received'); register(); return; }
            if (!r.code && !r.error) return;
            stopLogin();
            if (r.error) return onDone(fail(r.error === 'access_denied' ? 'Login was cancelled' : 'Spotify said: ' + r.error));
            tokenRequest({ grant_type: 'authorization_code', code: r.code, redirect_uri: info.callback, client_id: cid, code_verifier: verifier })
              .then(function (res) {
                if (!res.ok) throw fail(res.j.error_description || res.j.error || 'Login failed');
                save(res.j, { clientId: cid }); onDone(null);
              }).catch(onDone);
          }, function () {});
        }, 2000);
        return { phoneUrl: info.phoneUrl, callback: info.callback };
      });
    });
  }
  function stopLogin() { if (poll) clearInterval(poll); poll = null; }

  function save(j, old) {
    access = j.access_token; exp = Date.now() + ((j.expires_in || 3600) - 60) * 1000;
    // Spotify may or may not return a new refresh token; keep the old one when it doesn't.
    Store.set('spotify', { refresh_token: j.refresh_token || (old && old.refresh_token), linkedAt: (old && old.linkedAt) || Date.now(), clientId: (old && old.clientId) || clientId() });
  }

  function refresh() {
    if (pendingRefresh) return pendingRefresh;
    var cur = auth();
    if (!cur) return Promise.reject(fail('Spotify is not connected', 'login'));
    pendingRefresh = tokenRequest({ grant_type: 'refresh_token', refresh_token: cur.refresh_token, client_id: cur.clientId || clientId() }).then(function (r) {
      pendingRefresh = null;
      if (!r.ok) {
        if (r.j.error === 'invalid_grant') { Store.set('spotify', null); throw fail('Your Spotify link expired. Connect Spotify again in Settings.', 'login'); }
        throw fail(r.j.error_description || r.j.error || 'Token refresh failed', 'auth');
      }
      save(r.j, cur); return access;
    }, function (e) { pendingRefresh = null; throw e; });
    return pendingRefresh;
  }

  function token() { return access && Date.now() < exp ? Promise.resolve(access) : refresh(); }
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  function get(path, attempt) { return call('GET', path, null, attempt); }
  // Web API call with token refresh, 401 retry and 429 backoff honouring Retry-After.
  function call(method, path, body, attempt) {
    attempt = attempt || 0;
    return token().then(function (t) {
      var opts = { method: method, headers: { Authorization: 'Bearer ' + t } };
      if (body !== null && body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
      return fetch(path.indexOf('https://') === 0 ? path : CFG.spotifyApi + path, opts);
    }).then(function (r) {
      if (r.status === 204 || r.status === 202) return null;
      if (r.ok) return r.text().then(function (t) { return t ? JSON.parse(t) : null; });
      if (r.status === 401 && attempt < 1) { access = null; return call(method, path, body, attempt + 1); }
      if (r.status === 429 && attempt < 3) {
        var ra = parseInt(r.headers.get('Retry-After'), 10), ms = ra > 0 ? ra * 1000 : 1000 * Math.pow(2, attempt);
        if (ms > 30000) throw fail('Spotify is rate limiting us. Try again in ' + Math.ceil(ms / 1000) + 's.', 429);
        return wait(ms).then(function () { return call(method, path, body, attempt + 1); });
      }
      return r.json().catch(function () { return {}; }).then(function (j) {
        var msg = (j.error && j.error.message) || ('Spotify error ' + r.status);
        if (r.status === 403 && /not registered|user may not be registered|developer/i.test(msg)) msg = 'This Spotify account isn’t on the app’s allowed users list (Spotify developer dashboard, Users and Access).';
        throw fail(msg, r.status);
      });
    });
  }

  function getAll(path, cap) {
    var out = [];
    function page(p) {
      return get(p).then(function (j) { out = out.concat(j.items || []); return j.next && out.length < (cap || 5000) ? page(j.next) : out; });
    }
    return page(path);
  }

  var meP = null;
  function me() {
    if (!meP) meP = get('/me').then(function (m) {
      var u = { id: m.id, account: m.account_id || m.id, name: m.display_name || m.id, avatar: m.images && m.images.length ? m.images[m.images.length - 1].url : '' };
      Store.set('spotifyMe', u); return u;
    }, function (e) { meP = null; throw e; });
    return meP;
  }

  return {
    linked: function () { return !!auth(); }, linkedAt: function () { var a = auth(); return a && a.linkedAt; },
    token: token, call: call, me: me, clientId: clientId,
    forgetKey: function () { Store.set('clientId', null); }, cachedMe: function () { return Store.get('spotifyMe', null); },
    unlink: function () { Store.set('spotify', null); Store.set('spotifyMe', null); access = null; meP = null; },
    startLogin: startLogin, stopLogin: stopLogin, get: get, getAll: getAll,
  };
})();
