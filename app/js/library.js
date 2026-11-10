// The active profile's library. Imported/synced playlists hold "songs" (title/artist metadata) that are
// matched to a playable Audius upload on demand; liked songs, local playlists and saved items hold
// Audius objects directly. Match results are shared by all profiles.
var Library = (function () {
  var listeners = [], matches = {};
  var ORIGIN = { spotify: 'Spotify', 'spotify-export': 'Spotify import', 'youtube-export': 'YouTube import', local: 'Playlist' };

  function changed(what) { listeners.forEach(function (fn) { try { fn(what); } catch (e) { console.error(e); } }); }
  function list(k) { return Store.get(k, []); }
  function setList(k, v) { Store.set(k, v); changed(k); }

  // ---- liked songs, saved collections, followed artists, recents ----
  function isLiked(t) { return !!t && list('liked').some(function (x) { return x.uri === t.uri; }); }
  function toggleLike(t) {
    var l = list('liked'), i = -1;
    l.forEach(function (x, n) { if (x.uri === t.uri) i = n; });
    if (i >= 0) l.splice(i, 1); else l.unshift(strip(t));
    setList('liked', l);
    return i < 0;
  }
  function strip(t) {
    var c = {}; ['uri', 'id', 'name', 'artist_names', 'artist_id', 'album_name', 'album_cover_url', 'cover_big', 'cover_small', 'duration', 'src', 'orig'].forEach(function (k) { if (t[k] !== undefined) c[k] = t[k]; });
    return c;
  }
  function isSaved(kind, id) { return list(kind === 'artist' ? 'following' : 'saved').some(function (x) { return x.id === id; }); }
  function toggleSaved(item) {
    var key = item.kind === 'artist' ? 'following' : 'saved', l = list(key), i = -1;
    l.forEach(function (x, n) { if (x.id === item.id) i = n; });
    if (i >= 0) l.splice(i, 1); else l.unshift(item);
    setList(key, l);
    return i < 0;
  }
  function addRecent(ctx) {
    if (!ctx || !ctx.id) return;
    var l = list('recent').filter(function (x) { return !(x.id === ctx.id && x.kind === ctx.kind); });
    l.unshift(ctx);
    setList('recent', l.slice(0, 24));
  }

  // ---- playlists ----
  function playlists() { return list('playlists'); }
  function getPlaylist(id) { return playlists().filter(function (p) { return p.id === id; })[0]; }
  function replaceFrom(origin, pls) {
    setList('playlists', playlists().filter(function (p) { return p.origin !== origin; }).concat(pls));
  }
  function createPlaylist(name) {
    var p = { id: 'local:' + Date.now(), origin: 'local', name: name, cover: '', tracks: [] };
    var l = playlists(); l.unshift(p); setList('playlists', l);
    return p;
  }
  function addToPlaylist(id, t) {
    var l = playlists();
    l.forEach(function (p) { if (p.id === id && p.tracks && !p.tracks.some(function (x) { return x.uri === t.uri; })) { p.tracks.push(strip(t)); if (!p.cover) p.cover = t.album_cover_url; } });
    setList('playlists', l);
  }
  function removePlaylist(id) { setList('playlists', playlists().filter(function (p) { return p.id !== id; })); }

  // ---- matching imported songs to playable uploads ----
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
  // Covers, remixes, live takes, sped-up edits etc. are different recordings: only accept one when the
  // library song itself is that variant.
  var VARIANT = /\b(remix|cover|sing off|bootleg|mashup|edit|live|sped|slowed|reverb|nightcore|acoustic|karaoke|instrumental|8d|lyrics?|vip|flip|rework|version)\b/g;
  function variantMismatch(s, t) {
    var want = norm(s.name), m = String(t.name || '').toLowerCase().match(VARIANT) || [];
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
    return Sources.searchTracks(s.artist.split(',')[0] + ' ' + s.name, 8).then(function (res) {
      var best = null, bs = 0;
      res.forEach(function (t) { var sc = score(s, t); if (sc > bs) { bs = sc; best = t; } });
      if (best) best = strip(best);
      matches[k] = best; saveMatches();
      return best;
    }, function () { return undefined; });
  }
  var saveT = null;
  function saveMatches() { clearTimeout(saveT); saveT = setTimeout(function () { Store.gset('match.v3', matches); }, 500); }
  function cached(s) { var k = key(s); return k in matches ? matches[k] : undefined; }
  function resolve(songs, each) {
    var i = 0, active = 0, out = new Array(songs.length), stopped = false;
    var p = new Promise(function (done) {
      function next() {
        if (stopped) return;
        if (i >= songs.length && !active) return done(out);
        while (active < 3 && i < songs.length) {
          (function (n) {
            active++;
            match(songs[n]).then(function (t) { out[n] = t || null; active--; if (each && !stopped) each(n, out[n]); next(); });
          })(i++);
        }
      }
      next();
    });
    p.stop = function () { stopped = true; };
    return p;
  }

  // ---- importers (files sent from the phone page) ----
  function song(name, artist, album, duration, cover) { return { name: name || '', artist: artist || '', album: album || '', duration: duration || 0, cover: cover || '' }; }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function base(n) { return n.split('/').pop(); }
  function csv(text) {
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim(); }); });
  }
  function splitVideoTitle(title, channel) {
    var clean = title.replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyric|visuali[sz]er|hd|4k|mv)[^\)\]]*[\)\]]/ig, '').trim();
    var m = clean.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (m) return { artist: m[1].trim(), name: m[2].trim() };
    return { artist: (channel || '').replace(/\s*-\s*Topic$/i, '').trim(), name: clean };
  }
  function oembed(id) {
    return fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id))
      .then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
  }
  function youtubeVideos(name, rows, progress) {
    var h = rows[0].map(function (x) { return x.trim().toLowerCase(); }), col = h.indexOf('video id');
    var ids = rows.slice(1).map(function (r) { return (r[col] || '').trim(); }).filter(Boolean), songs = [], i = 0;
    function batch() {
      if (i >= ids.length) return Promise.resolve({ id: 'ytx:' + slug(name), origin: 'youtube-export', name: name, cover: '', songs: songs });
      var part = ids.slice(i, i + 4); i += 4;
      progress('Looking up ' + name + ' (' + Math.min(i, ids.length) + '/' + ids.length + ')');
      return Promise.all(part.map(oembed)).then(function (vs) {
        vs.forEach(function (v) { if (v) { var s = splitVideoTitle(v.title, v.author_name); songs.push(song(s.name, s.artist)); } });
        return batch();
      });
    }
    return batch();
  }
  function importFiles(files, progress) {
    progress = progress || function () {};
    var out = [], chain = Promise.resolve();
    Object.keys(files).forEach(function (name) {
      var b = base(name), text = files[name];
      chain = chain.then(function () {
        try {
          if (/^YourLibrary\.json$/i.test(b)) {
            var j = JSON.parse(text), tr = (j.tracks || []).map(function (t) { return song(t.track, t.artist, t.album); });
            if (tr.length) out.push({ id: 'spx:liked', origin: 'spotify-export', name: 'Spotify Liked Songs', cover: '', songs: tr });
          } else if (/^Playlist\d*\.json$/i.test(b)) {
            (JSON.parse(text).playlists || []).forEach(function (p) {
              out.push({ id: 'spx:' + slug(p.name), origin: 'spotify-export', name: p.name, cover: '',
                songs: (p.items || []).map(function (i) { return i.track || i.item; }).filter(function (t) { return t && t.trackName; })
                  .map(function (t) { return song(t.trackName, t.artistName, t.albumName); }) });
            });
          } else if (/\.csv$/i.test(b)) {
            var rows = csv(text); if (!rows.length) return;
            var h = rows[0].map(function (x) { return x.trim().toLowerCase(); });
            if (h.indexOf('video id') >= 0) return youtubeVideos(b.replace(/\.csv$/i, '').replace(/-videos$/i, ''), rows, progress).then(function (p) { out.push(p); });
            if (h.indexOf('song title') >= 0) {
              var c = function (n) { return h.indexOf(n); };
              out.push({ id: 'ytx:library', origin: 'youtube-export', name: 'YouTube Music Library', cover: '',
                songs: rows.slice(1).map(function (r) { return song(r[c('song title')], r[c('artist name 1')], r[c('album title')]); }).filter(function (s) { return s.name; }) });
            }
          }
        } catch (e) { console.warn('import', name, e); }
      });
    });
    return chain.then(function () {
      out = out.filter(function (p) { return p.songs.length; });
      var origins = {};
      out.forEach(function (p) { origins[p.origin] = true; });
      Object.keys(origins).forEach(function (o) {
        var mine = out.filter(function (p) { return p.origin === o; });
        // Same playlist names from a newer export replace the old ones; others are kept.
        var ids = mine.map(function (p) { return p.id; });
        setList('playlists', playlists().filter(function (p) { return ids.indexOf(p.id) < 0; }).concat(mine));
      });
      Store.set('importedAt', Date.now());
      return out;
    });
  }

  // Pulls exports the phone uploaded to the TV helper.
  var importing = false;
  function checkHelper(onResult) {
    if (importing) return;
    fetch(CFG.helper + '/api/imports').then(function (r) { return r.ok ? r.json() : []; }, function () { return []; }).then(function (items) {
      if (!items.length) return;
      importing = true;
      var chain = Promise.resolve(), total = [];
      items.forEach(function (it) {
        chain = chain.then(function () {
          return importFiles(it.files, function (m) { onResult({ progress: m }); }).then(function (pls) {
            total = total.concat(pls);
            return fetch(CFG.helper + '/api/imports/done?id=' + it.id, { method: 'POST' });
          });
        });
      });
      chain.then(function () { importing = false; onResult({ playlists: total }); }, function (e) { importing = false; onResult({ error: e.message }); });
    });
  }

  // ---- Spotify live sync ----
  function fromSpotifyTrack(t) {
    var img = t.album && t.album.images && t.album.images[0];
    return song(t.name, (t.artists || []).map(function (a) { return a.name; }).join(', '), t.album && t.album.name, t.duration_ms, img && img.url);
  }
  function syncSpotify(progress) {
    if (!SpotifyApi.linked()) return Promise.reject(new Error('Spotify is not connected'));
    var out = [], skipped = 0;
    progress = progress || function () {};
    progress('Reading Liked Songs');
    return SpotifyApi.getAll('/me/tracks?limit=50').then(function (items) {
      out.push({ id: 'sp:liked', origin: 'spotify', name: 'Spotify Liked Songs', cover: '',
        songs: items.map(function (i) { return i.track && fromSpotifyTrack(i.track); }).filter(Boolean) });
      return SpotifyApi.getAll('/me/playlists?limit=50', 1000);
    }).then(function (pls) {
      var chain = Promise.resolve();
      pls.forEach(function (p, n) {
        chain = chain.then(function () {
          progress('Reading playlist ' + (n + 1) + '/' + pls.length + ': ' + p.name);
          return SpotifyApi.getAll('/playlists/' + p.id + '/items?limit=50').then(function (items) {
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
      replaceFrom('spotify', out); Store.set('syncedAt', Date.now());
      return { playlists: out.length, skipped: skipped };
    });
  }

  function load() { matches = Store.gget('match.v3', {}); }

  return {
    load: load, onChange: function (fn) { listeners.push(fn); }, ORIGIN: ORIGIN,
    liked: function () { return list('liked'); }, isLiked: isLiked, toggleLike: toggleLike,
    saved: function () { return list('saved'); }, following: function () { return list('following'); }, isSaved: isSaved, toggleSaved: toggleSaved,
    recent: function () { return list('recent'); }, addRecent: addRecent,
    playlists: playlists, getPlaylist: getPlaylist, createPlaylist: createPlaylist, addToPlaylist: addToPlaylist, removePlaylist: removePlaylist,
    resolve: resolve, cached: cached, clearMatches: function () { matches = {}; Store.gset('match.v3', {}); },
    importFiles: importFiles, checkHelper: checkHelper, syncSpotify: syncSpotify,
    syncedAt: function () { return Store.get('syncedAt', 0); }, importedAt: function () { return Store.get('importedAt', 0); }
  };
})();
