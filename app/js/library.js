// The user's library, merged from every source: live Spotify sync (Web API) and file imports pushed by
// scripts/import.js (Spotify data export, YouTube Takeout). Imported songs are metadata only; each one is
// matched to a playable Audius track on demand and the match is cached.
var Library = (function () {
  var KEY = 'lib.v1', MKEY = 'match.v3';
  var lib = { playlists: [], syncedAt: 0, importedAt: 0 };
  var matches = {};

  function load() {
    try { lib = JSON.parse(localStorage.getItem(KEY)) || lib; } catch (e) {}
    try { matches = JSON.parse(localStorage.getItem(MKEY)) || {}; } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(lib)); localStorage.setItem(MKEY, JSON.stringify(matches)); }
    catch (e) { console.error('library too large for storage', e); }
  }

  // Song shape: { name, artist, album, duration (ms), cover }
  function song(name, artist, album, duration, cover) {
    return { name: name || '', artist: artist || '', album: album || '', duration: duration || 0, cover: cover || '' };
  }

  // Replace every playlist from one origin, keep the rest.
  function replaceFrom(origin, playlists) {
    lib.playlists = lib.playlists.filter(function (p) { return p.origin !== origin; }).concat(playlists);
  }

  function fromSpotifyTrack(t) {
    var img = t.album && t.album.images && t.album.images[0];
    return song(t.name, (t.artists || []).map(function (a) { return a.name; }).join(', '), t.album && t.album.name, t.duration_ms, img && img.url);
  }

  function syncSpotify(progress) {
    if (!WebApi.loggedIn()) return Promise.reject(new Error('Spotify not connected. Run scripts/login.js on the laptop.'));
    var out = [], skipped = 0;
    progress = progress || function () {};
    progress('Reading Liked Songs');
    return WebApi.getAll('/me/tracks?limit=50').then(function (items) {
      out.push({ id: 'sp:liked', origin: 'spotify', name: 'Liked Songs', cover: '',
        songs: items.map(function (i) { return i.track && fromSpotifyTrack(i.track); }).filter(Boolean) });
      return WebApi.getAll('/me/playlists?limit=50', 1000);
    }).then(function (pls) {
      var chain = Promise.resolve();
      pls.forEach(function (p, n) {
        chain = chain.then(function () {
          progress('Reading playlist ' + (n + 1) + '/' + pls.length + ': ' + p.name);
          return WebApi.getAll('/playlists/' + p.id + '/items?limit=50').then(function (items) {
            out.push({ id: 'sp:' + p.id, origin: 'spotify', name: p.name, cover: p.images && p.images[0] ? p.images[0].url : '',
              songs: items.map(function (i) { var t = i.item || i.track; return t && !i.is_local && t.type !== 'episode' && fromSpotifyTrack(t); }).filter(Boolean) });
          }, function (e) {
            // Spotify only lists items of playlists you own or collaborate on (403 otherwise).
            if (e.code === 403) { skipped++; return; }
            throw e;
          });
        });
      });
      return chain;
    }).then(function () {
      replaceFrom('spotify', out); lib.syncedAt = Date.now(); save();
      return { playlists: out.length, skipped: skipped };
    });
  }

  // window.IMPORT_DATA is written by scripts/import.js: { importedAt, playlists: [{ id, origin, name, songs }] }
  function applyImport() {
    var d = window.IMPORT_DATA;
    if (!d || !d.playlists || d.importedAt === lib.importedAt) return false;
    var origins = {};
    d.playlists.forEach(function (p) { origins[p.origin] = true; });
    Object.keys(origins).forEach(function (o) { replaceFrom(o, d.playlists.filter(function (p) { return p.origin === o; })); });
    lib.importedAt = d.importedAt; save();
    return true;
  }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/feat\..*$|ft\..*$/, ' ')
      .replace(/[^a-z0-9À-ɏऀ-ॿ ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function key(s) { return norm(s.artist.split(',')[0]) + '|' + norm(s.name); }

  function words(s) { return norm(s).split(' ').filter(Boolean); }
  function overlap(a, b) {
    var wa = words(a), wb = words(b); if (!wa.length) return 0;
    return wa.filter(function (w) { return wb.indexOf(w) >= 0; }).length / wa.length;
  }

  // Accept only a result whose title and artist really line up, and whose length is close when we know it,
  // so a song never silently plays as some unrelated remix.
  // Covers, remixes, live takes, sped-up edits etc. are different recordings: only accept one when the
  // library song itself is that variant.
  var VARIANT = /\b(remix|cover|sing off|bootleg|mashup|edit|live|sped|slowed|reverb|nightcore|acoustic|karaoke|instrumental|8d|lyrics?|vip|flip|rework|version)\b/;
  function variantMismatch(s, t) {
    var want = norm(s.name), got = String(t.name || '').toLowerCase();
    var m = got.match(new RegExp(VARIANT.source, 'g')) || [];
    return m.some(function (w) { return want.indexOf(w) < 0; });
  }

  function score(s, t) {
    if (variantMismatch(s, t)) return 0;
    // The uploader must be the artist: anyone else's upload is a re-upload or a cover, not the recording.
    var title = overlap(s.name, t.name), artist = overlap(s.artist.split(',')[0], t.artist_names.join(' '));
    if (title < 0.8 || artist < 0.75) return 0;
    if (s.duration && Math.abs(s.duration - t.duration) > 15000) return 0;
    return title + artist - (s.duration ? Math.abs(s.duration - t.duration) / 60000 : 0);
  }

  function match(s) {
    var k = key(s);
    if (k in matches) return Promise.resolve(matches[k]);
    return Sources.search(s.artist.split(',')[0] + ' ' + s.name, 8).then(function (res) {
      var best = null, bs = 0;
      res.forEach(function (t) { var sc = score(s, t); if (sc > bs) { bs = sc; best = t; } });
      matches[k] = best; save();
      return best;
    }, function () { return undefined; });
  }

  // Resolves songs to playable tracks a few at a time; `each` fires as matches land so the UI can fill in.
  function resolve(songs, each) {
    var i = 0, active = 0, out = new Array(songs.length);
    return new Promise(function (done) {
      function next() {
        if (i >= songs.length && !active) return done(out);
        while (active < 3 && i < songs.length) {
          (function (n) {
            active++;
            match(songs[n]).then(function (t) {
              out[n] = t || null; active--;
              if (each) each(n, out[n]);
              next();
            });
          })(i++);
        }
      }
      next();
    });
  }

  function cached(s) { var k = key(s); return k in matches ? matches[k] : undefined; }

  load();
  return {
    playlists: function () { return lib.playlists; },
    get: function (id) { return lib.playlists.filter(function (p) { return p.id === id; })[0]; },
    syncSpotify: syncSpotify, applyImport: applyImport, resolve: resolve, cached: cached,
    syncedAt: function () { return lib.syncedAt; }, importedAt: function () { return lib.importedAt; },
    clearMatches: function () { matches = {}; save(); }
  };
})();
