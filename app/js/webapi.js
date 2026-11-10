// Spotify Web API client. Authorization Code + PKCE (no client secret anywhere): the one-time login runs on
// the laptop (scripts/login.js) and seeds a refresh token; this module only refreshes and calls.
var WebApi = (function () {
  var KEY = 'auth.v1', access = null, exp = 0, pending = null;

  function stored() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }

  // A newer seed (fresh login) wins over whatever we rotated to locally.
  function current() {
    var s = stored(), seed = window.AUTH_SEED;
    if (seed && seed.refresh_token && (!s || s.seed !== seed.issued)) return { refresh_token: seed.refresh_token, seed: seed.issued };
    return s;
  }

  function fail(msg, code) { var e = new Error(msg); e.code = code; return e; }

  function refresh() {
    if (pending) return pending;
    var cur = current();
    if (!cur) return Promise.reject(fail('Not logged in. Run scripts/login.js on the laptop.', 'login'));
    var body = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(cur.refresh_token) + '&client_id=' + CFG.clientId;
    pending = fetch(CFG.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        pending = null;
        if (!r.ok) {
          if (r.j.error === 'invalid_grant') {
            try { localStorage.removeItem(KEY); } catch (e) {}
            throw fail('Spotify login expired. Run scripts/login.js on the laptop.', 'login');
          }
          throw fail(r.j.error_description || r.j.error || 'Token refresh failed', 'auth');
        }
        access = r.j.access_token; exp = Date.now() + (r.j.expires_in - 60) * 1000;
        // Spotify may or may not rotate the refresh token; keep the old one when none comes back.
        try { localStorage.setItem(KEY, JSON.stringify({ refresh_token: r.j.refresh_token || cur.refresh_token, seed: cur.seed })); } catch (e) {}
        return access;
      }, function (e) { pending = null; throw fail('Cannot reach Spotify', 'network'); });
    return pending;
  }

  function token() { return access && Date.now() < exp ? Promise.resolve(access) : refresh(); }
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  function get(path, attempt) {
    attempt = attempt || 0;
    return token().then(function (t) {
      return fetch(CFG.webapi + path, { headers: { Authorization: 'Bearer ' + t } });
    }).then(function (r) {
      if (r.ok) return r.json();
      if (r.status === 401 && attempt < 1) { access = null; return get(path, attempt + 1); }
      if (r.status === 429 && attempt < 3) {
        var ra = parseInt(r.headers.get('Retry-After'), 10);
        var ms = ra > 0 ? ra * 1000 : 1000 * Math.pow(2, attempt);
        if (ms > 30000) throw fail('Spotify is rate limiting us. Try again in ' + Math.ceil(ms / 1000) + 's.', 429);
        return wait(ms).then(function () { return get(path, attempt + 1); });
      }
      return r.json().catch(function () { return {}; }).then(function (j) {
        throw fail((j.error && j.error.message) || ('Spotify error ' + r.status), r.status);
      });
    });
  }

  return {
    get: get,
    loggedIn: function () { return !!current(); },
    search: function (q) { return get('/search?type=track&limit=10&q=' + encodeURIComponent(q)); }
  };
})();
