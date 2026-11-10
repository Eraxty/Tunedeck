// What the pages read from: Spotify (Web API, live) when the profile is signed in to Spotify, Audius otherwise.
// Everything is normalised to the shapes in sources.js (track / collection / artist).
var Cat = (function () {
  function isSp() { return Spotify.linked(); }

  // ---------- Spotify mapping ----------
  function imgs(list, big) {
    list = list || []; if (!list.length) return '';
    if (big) return list[0].url;
    var pick = list[list.length - 1].url;
    list.forEach(function (i) { if (i.height && i.height >= 200 && i.height <= 400) pick = i.url; });
    return pick;
  }
  function track(t, album) {
    if (!t || t.type === 'episode' || t.is_local) return null;
    var al = t.album || album || {};
    return { uri: t.uri, id: t.id, name: t.name, artist_names: (t.artists || []).map(function (a) { return a.name; }),
      artist_id: t.artists && t.artists[0] ? t.artists[0].id : null, album_name: al.name || '', album_id: al.id || null,
      album_cover_url: imgs(al.images), cover_big: imgs(al.images, true), cover_small: al.images && al.images.length ? al.images[al.images.length - 1].url : '',
      duration: t.duration_ms || 0, explicit: !!t.explicit, src: { source: 'spotify' } };
  }
  function album(a) {
    return { kind: 'album', id: a.id, uri: a.uri, name: a.name, owner: (a.artists || []).map(function (x) { return x.name; }).join(', '),
      owner_id: a.artists && a.artists[0] ? a.artists[0].id : null, cover: imgs(a.images), cover_big: imgs(a.images, true),
      count: a.total_tracks || 0, year: (a.release_date || '').slice(0, 4), type: a.album_type || 'album', description: '' };
  }
  function playlist(p) {
    var me = Spotify.cachedMe();
    return { kind: 'playlist', id: p.id, uri: p.uri, name: p.name, owner: p.owner ? (p.owner.display_name || p.owner.id) : '', owner_id: null,
      own: !!(me && p.owner && p.owner.id === me.id) || !!p.collaborative, cover: imgs(p.images), cover_big: imgs(p.images, true),
      count: (p.items || p.tracks || {}).total || 0, description: (p.description || '').replace(/<[^>]+>/g, '') };
  }
  function artist(a) { return { kind: 'artist', id: a.id, uri: a.uri, name: a.name, avatar: imgs(a.images), avatar_big: imgs(a.images, true), followers: null, genres: a.genres || [] }; }
  function clean(list) { return list.filter(Boolean); }
  function spAll(path, cap, map) { return Spotify.getAll(path, cap).then(function (items) { return clean(items.map(map)); }); }

  // ---------- liked songs (Spotify keeps a local set for instant heart states) ----------
  var likedSet = {}, likedLoaded = null;
  function loadLiked() {
    if (!likedLoaded) likedLoaded = spAll('/me/tracks?limit=50', 2000, function (i) { return track(i.track); }).then(function (ts) {
      likedSet = {}; ts.forEach(function (t) { likedSet[t.uri] = 1; }); return ts;
    }, function (e) { likedLoaded = null; throw e; });
    return likedLoaded;
  }

  var cache = {};
  function memo(key, ms, fn) {
    var c = cache[key];
    if (c && Date.now() - c.t < ms) return c.p;
    var p = fn(); cache[key] = { t: Date.now(), p: p }; p.catch(function () { delete cache[key]; });
    return p;
  }

  return {
    provider: function () { return isSp() ? 'spotify' : 'audius'; },
    track: track,

    search: function (q) {
      if (!isSp()) return Promise.all([Sources.searchTracks(q, 20), Sources.searchArtists(q, 10), Sources.searchPlaylists(q, 12)])
        .then(function (r) { return { tracks: r[0], artists: r[1], albums: [], playlists: r[2] }; });
      var e = encodeURIComponent(q);
      // Dev-mode search returns at most 10 per type and page, so songs are fetched as two pages.
      return Promise.all([
        Spotify.get('/search?type=track,artist,album,playlist&limit=10&q=' + e),
        Spotify.get('/search?type=track&limit=10&offset=10&q=' + e).catch(function () { return {}; })
      ]).then(function (r) {
        var a = r[0], more = (r[1].tracks && r[1].tracks.items) || [];
        return { tracks: clean(((a.tracks && a.tracks.items) || []).concat(more).map(function (t) { return track(t); })),
          artists: clean(((a.artists && a.artists.items) || []).map(function (x) { return x && artist(x); })),
          albums: clean(((a.albums && a.albums.items) || []).map(function (x) { return x && album(x); })),
          playlists: clean(((a.playlists && a.playlists.items) || []).map(function (x) { return x && playlist(x); })) };
      });
    },

    // { item, tracks, note } for an album or playlist
    collection: function (kind, id) {
      if (!isSp()) return Promise.all([Sources.collection(id), Sources.collectionTracks(id)]).then(function (r) { return { item: r[0], tracks: r[1] }; });
      if (kind === 'album') return Spotify.get('/albums/' + id).then(function (a) {
        var al = album(a), list = clean(((a.tracks && a.tracks.items) || []).map(function (t) { return track(t, a); }));
        var next = a.tracks && a.tracks.next;
        if (!next) return { item: al, tracks: list };
        return Spotify.getAll(next, 500).then(function (rest) { return { item: al, tracks: list.concat(clean(rest.map(function (t) { return track(t, a); }))) }; });
      });
      return Spotify.get('/playlists/' + id).then(function (p) {
        var pl = playlist(p), items = p.items || p.tracks;
        if (!items || !items.items) return { item: pl, tracks: null, note: 'Spotify only lets apps list the songs of playlists you own. Press Play to listen to it.' };
        var list = clean(items.items.map(function (i) { return track(i.item || i.track); }));
        if (!items.next) return { item: pl, tracks: list };
        return Spotify.getAll(items.next, 1000).then(function (rest) { return { item: pl, tracks: list.concat(clean(rest.map(function (i) { return track(i.item || i.track); }))) }; });
      });
    },

    artist: function (id) {
      if (!isSp()) return Promise.all([Sources.artist(id), Sources.artistTracks(id, 10), Sources.artistAlbums(id), Sources.artistPlaylists(id)])
        .then(function (r) { return { artist: r[0], top: r[1], albums: r[2], singles: [], playlists: r[3] }; });
      return Spotify.get('/artists/' + id).then(function (a) {
        var ar = artist(a);
        // Artist top tracks are gone for dev-mode apps; a search scoped to the artist is the closest substitute.
        return Promise.all([
          Spotify.get('/search?type=track&limit=10&q=' + encodeURIComponent('artist:"' + a.name + '"')).then(function (s) {
            return clean(s.tracks.items.map(function (t) { return track(t); })).filter(function (t) { return t.artist_names.indexOf(a.name) >= 0; });
          }).catch(function () { return []; }),
          spAll('/artists/' + id + '/albums?include_groups=album&limit=20', 40, album).catch(function () { return []; }),
          spAll('/artists/' + id + '/albums?include_groups=single&limit=20', 40, album).catch(function () { return []; })
        ]).then(function (r) { return { artist: ar, top: r[0], albums: r[1], singles: r[2], playlists: [] }; });
      });
    },

    // ---------- library ----------
    liked: function () { return isSp() ? loadLiked() : Promise.resolve(Library.liked()); },
    isLiked: function (t) { if (!t) return false; return t.src && t.src.source === 'spotify' ? !!likedSet[t.uri] : Library.isLiked(t); },
    toggleLike: function (t) {
      if (!(t.src && t.src.source === 'spotify')) return Promise.resolve(Library.toggleLike(t));
      var on = !likedSet[t.uri];
      if (on) likedSet[t.uri] = 1; else delete likedSet[t.uri];
      likedLoaded = null;
      return Spotify.call(on ? 'PUT' : 'DELETE', '/me/library?uris=' + encodeURIComponent(t.uri)).then(function () { return on; }, function (e) {
        if (on) delete likedSet[t.uri]; else likedSet[t.uri] = 1;
        throw e;
      });
    },
    checkLiked: function (t) {
      if (!isSp() || !t || t.src.source !== 'spotify') return Promise.resolve(Library.isLiked(t));
      return Spotify.get('/me/library/contains?uris=' + encodeURIComponent(t.uri)).then(function (r) {
        var on = Array.isArray(r) ? !!r[0] : false; if (on) likedSet[t.uri] = 1; else delete likedSet[t.uri]; return on;
      }, function () { return !!likedSet[t.uri]; });
    },
    isSaved: function (item) { return isSp() ? !!(cache.saved && cache.saved[item.uri]) : Library.isSaved(item.kind, item.id); },
    toggleSaved: function (item) {
      if (!isSp()) return Promise.resolve(Library.toggleSaved(item));
      cache.saved = cache.saved || {};
      var on = !cache.saved[item.uri];
      if (on) cache.saved[item.uri] = 1; else delete cache.saved[item.uri];
      delete cache.albums; delete cache.following; delete cache.playlists;
      return Spotify.call(on ? 'PUT' : 'DELETE', '/me/library?uris=' + encodeURIComponent(item.uri)).then(function () { return on; });
    },
    loadSavedFlags: function (item) {
      if (!isSp() || !item.uri) return Promise.resolve(Library.isSaved(item.kind, item.id));
      return Spotify.get('/me/library/contains?uris=' + encodeURIComponent(item.uri)).then(function (r) {
        cache.saved = cache.saved || {}; var on = Array.isArray(r) && !!r[0];
        if (on) cache.saved[item.uri] = 1; else delete cache.saved[item.uri]; return on;
      }, function () { return false; });
    },
    playlists: function () {
      if (!isSp()) return Promise.resolve(Library.playlists());
      return memo('playlists', 120000, function () { return spAll('/me/playlists?limit=50', 500, playlist); });
    },
    albums: function () { return isSp() ? memo('albums', 120000, function () { return spAll('/me/albums?limit=50', 300, function (i) { return album(i.album); }); }) : Promise.resolve(Library.saved()); },
    following: function () {
      if (!isSp()) return Promise.resolve(Library.following());
      return memo('following', 120000, function () {
        var out = [];
        function page(url) { return Spotify.get(url).then(function (j) { out = out.concat(clean(j.artists.items.map(artist))); return j.artists.next && out.length < 300 ? page(j.artists.next) : out; }); }
        return page('/me/following?type=artist&limit=50');
      });
    },
    topArtists: function () { return isSp() ? memo('topA', 600000, function () { return Spotify.get('/me/top/artists?limit=20&time_range=medium_term').then(function (j) { return clean(j.items.map(artist)); }); }) : Promise.resolve([]); },
    topTracks: function () { return isSp() ? memo('topT', 600000, function () { return Spotify.get('/me/top/tracks?limit=30&time_range=short_term').then(function (j) { return clean(j.items.map(function (t) { return track(t); })); }); }) : Promise.resolve([]); },
    recent: function () {
      if (!isSp()) return Promise.resolve(Library.recent());
      return memo('recent', 60000, function () {
        return Spotify.get('/me/player/recently-played?limit=50').then(function (j) {
          var seen = {}, out = [];
          (j.items || []).forEach(function (i) {
            var c = i.context, t = i.track;
            if (c && /^spotify:(album|playlist|artist):/.test(c.uri)) { if (!seen[c.uri]) { seen[c.uri] = 1; out.push({ kind: c.type, id: c.uri.split(':')[2], uri: c.uri, pending: true }); } }
            else if (t && t.album && !seen[t.album.uri]) { seen[t.album.uri] = 1; out.push(album(t.album)); }
          });
          // Contexts only come back as URIs: fetch their names and covers (single-ID endpoints in dev mode).
          return Promise.all(out.slice(0, 16).map(function (x) {
            if (!x.pending) return x;
            var path = x.kind === 'album' ? '/albums/' : x.kind === 'artist' ? '/artists/' : '/playlists/';
            return Spotify.get(path + x.id + (x.kind === 'playlist' ? '?fields=id,uri,name,images,owner,description,collaborative,items.total,tracks.total' : '')).then(function (d) {
              return x.kind === 'album' ? album(d) : x.kind === 'artist' ? artist(d) : playlist(d);
            }, function () { return null; });
          })).then(clean);
        });
      });
    },
    // Newest releases from the artists you listen to most (Spotify's "new releases" endpoint is gone in dev mode).
    newFromArtists: function () {
      if (!isSp()) return Promise.resolve([]);
      return memo('newrel', 3600000, function () {
        return this.topArtists().then(function (as) {
          return Promise.all(as.slice(0, 8).map(function (a) { return Spotify.get('/artists/' + a.id + '/albums?include_groups=album,single&limit=3').then(function (j) { return j.items.map(album); }, function () { return []; }); }));
        }).then(function (lists) {
          var all = [].concat.apply([], lists); all.sort(function (a, b) { return b.year.localeCompare(a.year); });
          return all.slice(0, 20);
        });
      }.bind(this));
    },
    clear: function () { cache = {}; likedLoaded = null; likedSet = {}; }
  };
})();
