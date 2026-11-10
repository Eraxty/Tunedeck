// What the pages read from: Spotify (Web API, live) when the profile is signed in to Spotify, Audius otherwise.
// Everything is normalised to the shapes in sources.js (track / collection / artist).
var Cat = (function () {
  function isSp() { return SpotifyApi.linked(); }

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
    var me = SpotifyApi.cachedMe();
    return { kind: 'playlist', id: p.id, uri: p.uri, name: p.name, owner: p.owner ? (p.owner.display_name || p.owner.id) : '', owner_id: null,
      own: !!(me && p.owner && p.owner.id === me.id) || !!p.collaborative, cover: imgs(p.images), cover_big: imgs(p.images, true),
      count: (p.items || p.tracks || {}).total || 0, description: (p.description || '').replace(/<[^>]+>/g, '') };
  }
  function artist(a) { return { kind: 'artist', id: a.id, uri: a.uri, name: a.name, avatar: imgs(a.images), avatar_big: imgs(a.images, true), followers: null, genres: a.genres || [] }; }
  function clean(list) { return list.filter(Boolean); }
  // Name and cover of an album, artist or playlist known only by URI (from recently played).
  function lookupContext(x) {
    var path = x.kind === 'album' ? '/albums/' : x.kind === 'artist' ? '/artists/' : '/playlists/';
    return SpotifyApi.get(path + x.id + (x.kind === 'playlist' ? '?fields=id,uri,name,images,owner,description,collaborative,items.total,tracks.total' : '')).then(function (d) {
      return x.kind === 'album' ? album(d) : x.kind === 'artist' ? artist(d) : playlist(d);
    }, function (e) { return x.kind === 'playlist' && e.code !== 429 ? mix(x.id, x.art) : null; });
  }
  // Spotify-made playlists (Daily Mix, artist Mixes, Discover Weekly...) can't be read by apps like this one,
  // but they still play. Their name comes from Spotify's public embed info.
  function mix(id, cover) {
    var base = { kind: 'playlist', id: id, uri: 'spotify:playlist:' + id, name: 'Spotify mix', owner: 'Spotify', own: false, cover: cover || '', cover_big: cover || '', count: 0, description: '', mix: true };
    return fetch('https://open.spotify.com/oembed?url=spotify:playlist:' + id).then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) {
      if (j.title) base.name = j.title; if (j.thumbnail_url && !cover) { base.cover = base.cover_big = j.thumbnail_url; } return base;
    }, function () { return base; });
  }
  function spAll(path, cap, map) { return SpotifyApi.getAll(path, cap).then(function (items) { return clean(items.map(map)); }); }

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
        SpotifyApi.get('/search?type=track,artist,album,playlist&limit=10&q=' + e),
        SpotifyApi.get('/search?type=track&limit=10&offset=10&q=' + e).catch(function () { return {}; })
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
      if (kind === 'album') return SpotifyApi.get('/albums/' + id).then(function (a) {
        var al = album(a), list = clean(((a.tracks && a.tracks.items) || []).map(function (t) { return track(t, a); }));
        var next = a.tracks && a.tracks.next;
        if (!next) return { item: al, tracks: list };
        return SpotifyApi.getAll(next, 500).then(function (rest) { return { item: al, tracks: list.concat(clean(rest.map(function (t) { return track(t, a); }))) }; });
      });
      var MIXNOTE = 'Spotify doesn’t let apps list the songs of its own mixes and playlists. Press Play to listen to it.';
      return SpotifyApi.get('/playlists/' + id).then(function (p) {
        var pl = playlist(p), items = p.items || p.tracks;
        if (!items || !items.items) return { item: pl, tracks: null, note: pl.owner === 'Spotify' ? MIXNOTE : 'Spotify only lets apps list the songs of playlists you own. Press Play to listen to it.' };
        var list = clean(items.items.map(function (i) { return track(i.item || i.track); }));
        if (!items.next) return { item: pl, tracks: list };
        return SpotifyApi.getAll(items.next, 1000).then(function (rest) { return { item: pl, tracks: list.concat(clean(rest.map(function (i) { return track(i.item || i.track); }))) }; });
      }, function (e) {
        if (e.code !== 404 && e.code !== 403) throw e;
        return mix(id).then(function (m) { return { item: m, tracks: null, note: MIXNOTE }; });
      });
    },

    artist: function (id) {
      if (!isSp()) return Promise.all([Sources.artist(id), Sources.artistTracks(id, 10), Sources.artistAlbums(id), Sources.artistPlaylists(id)])
        .then(function (r) { return { artist: r[0], top: r[1], albums: r[2], singles: [], playlists: r[3] }; });
      // Cached for an hour: an artist page costs 5 requests, and Spotify rate-limits developer apps.
      var bad = false, key = 'artistPage:' + id;
      return memo(key, 3600000, function () { return SpotifyApi.get('/artists/' + id).then(function (a) {
        var ar = artist(a);
        // Artist top tracks are gone for dev-mode apps; search scoped to the artist (most popular first) is the
        // closest substitute. Search pages hold 10 results, so two pages are read and matched by artist id.
        var q = encodeURIComponent('artist:"' + a.name + '"');
        return Promise.all([
          Promise.all([0, 10].map(function (off) {
            return SpotifyApi.get('/search?type=track&limit=10&offset=' + off + '&q=' + q).then(function (s) { return s.tracks.items; }, function () { return []; });
          })).then(function (pages) {
            var seen = {};
            return clean([].concat.apply([], pages).filter(function (t) {
              var mine = t && t.artists && t.artists.some(function (x) { return x.id === id; }), key = t && t.name.toLowerCase();
              if (!mine || seen[key]) return false; seen[key] = 1; return true;
            }).map(function (t) { return track(t); }));
          }),
          // Albums, then singles: Spotify rate-limits this endpoint hard, so not both at once.
          spAll('/artists/' + id + '/albums?include_groups=album&limit=10', 40, album).catch(function (e) { bad = true; Log.add('artist albums fail', e.code, e.message); return []; }).then(function (albums) {
            return spAll('/artists/' + id + '/albums?include_groups=single&limit=10', 40, album).catch(function (e) { bad = true; Log.add('artist singles fail', e.code, e.message); return []; }).then(function (singles) { return [albums, singles]; });
          })
        ]).then(function (r) {
          if (bad) delete cache[key];   // a partly failed page is fetched again next time
          return { artist: ar, top: r[0], albums: r[1][0], singles: r[1][1], playlists: [] };
        });
      }); });
    },

    // Just the artist (one request, cached): what the Now Playing panel needs on every song change.
    artistInfo: function (id) {
      if (!isSp()) return Sources.artist(id);
      return memo('artist:' + id, 3600000, function () { return SpotifyApi.get('/artists/' + id).then(artist); });
    },
    // Which of these songs are liked, asked in small batches; updates the local set used for heart icons.
    checkLikedMany: function (tracks) {
      if (!isSp()) return Promise.resolve();
      var uris = tracks.filter(function (t) { return t && t.src && t.src.source === 'spotify'; }).map(function (t) { return t.uri; }), chunks = [];
      for (var i = 0; i < uris.length; i += 20) chunks.push(uris.slice(i, i + 20));
      return Promise.all(chunks.map(function (c) {
        return SpotifyApi.get('/me/library/contains?uris=' + encodeURIComponent(c.join(','))).then(function (r) {
          if (Array.isArray(r)) c.forEach(function (u, n) { if (r[n]) likedSet[u] = 1; else delete likedSet[u]; });
        }, function () {});
      }));
    },

    // ---------- library ----------
    liked: function () { return isSp() ? loadLiked() : Promise.resolve(Library.liked()); },
    isLiked: function (t) { if (!t) return false; return t.src && t.src.source === 'spotify' ? !!likedSet[t.uri] : Library.isLiked(t); },
    toggleLike: function (t) {
      if (!(t.src && t.src.source === 'spotify')) return Promise.resolve(Library.toggleLike(t));
      var on = !likedSet[t.uri];
      if (on) likedSet[t.uri] = 1; else delete likedSet[t.uri];
      likedLoaded = null;
      return SpotifyApi.call(on ? 'PUT' : 'DELETE', '/me/library?uris=' + encodeURIComponent(t.uri)).then(function () { return on; }, function (e) {
        if (on) delete likedSet[t.uri]; else likedSet[t.uri] = 1;
        throw e;
      });
    },
    checkLiked: function (t) {
      if (!isSp() || !t || t.src.source !== 'spotify') return Promise.resolve(Library.isLiked(t));
      return SpotifyApi.get('/me/library/contains?uris=' + encodeURIComponent(t.uri)).then(function (r) {
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
      return SpotifyApi.call(on ? 'PUT' : 'DELETE', '/me/library?uris=' + encodeURIComponent(item.uri)).then(function () { return on; });
    },
    loadSavedFlags: function (item) {
      if (!isSp() || !item.uri) return Promise.resolve(Library.isSaved(item.kind, item.id));
      return SpotifyApi.get('/me/library/contains?uris=' + encodeURIComponent(item.uri)).then(function (r) {
        cache.saved = cache.saved || {}; var on = Array.isArray(r) && !!r[0];
        if (on) cache.saved[item.uri] = 1; else delete cache.saved[item.uri]; return on;
      }, function () { return false; });
    },
    playlists: function () {
      if (!isSp()) return Promise.resolve(Library.playlists());
      return memo('playlists', 600000, function () { return spAll('/me/playlists?limit=50', 500, playlist); });
    },
    albums: function () { return isSp() ? memo('albums', 600000, function () { return spAll('/me/albums?limit=50', 300, function (i) { return album(i.album); }); }) : Promise.resolve(Library.saved()); },
    following: function () {
      if (!isSp()) return Promise.resolve(Library.following());
      return memo('following', 600000, function () {
        var out = [];
        function page(url) { return SpotifyApi.get(url).then(function (j) { out = out.concat(clean(j.artists.items.map(artist))); return j.artists.next && out.length < 300 ? page(j.artists.next) : out; }); }
        return page('/me/following?type=artist&limit=50');
      });
    },
    topArtists: function () { return isSp() ? memo('topA', 600000, function () { return SpotifyApi.get('/me/top/artists?limit=20&time_range=medium_term').then(function (j) { return clean(j.items.map(artist)); }); }) : Promise.resolve([]); },
    topTracks: function () { return isSp() ? memo('topT', 600000, function () { return SpotifyApi.get('/me/top/tracks?limit=30&time_range=short_term').then(function (j) { return clean(j.items.map(function (t) { return track(t); })); }); }) : Promise.resolve([]); },
    recent: function () {
      if (!isSp()) return Promise.resolve(Library.recent());
      return memo('recent', 300000, function () {
        return SpotifyApi.get('/me/player/recently-played?limit=50').then(function (j) {
          var seen = {}, out = [];
          (j.items || []).forEach(function (i) {
            var c = i.context, t = i.track;
            if (c && /^spotify:(album|playlist|artist):/.test(c.uri)) { if (!seen[c.uri]) { seen[c.uri] = 1; out.push({ kind: c.type, id: c.uri.split(':')[2], uri: c.uri, pending: true, art: t && t.album ? imgs(t.album.images) : '' }); } }
            else if (t && t.album && !seen[t.album.uri]) { seen[t.album.uri] = 1; out.push(album(t.album)); }
          });
          // Contexts only come back as URIs: their names and covers are looked up once and kept for a week.
          // At most 8 new lookups per visit; the rest fill in on later visits.
          var known = Store.get('ctxCache', {}), now = Date.now(), budget = 8;
          return Promise.all(out.slice(0, 16).map(function (x) {
            if (!x.pending) return x;
            var k = known[x.uri];
            if (k && now - k.t < 7 * 864e5) return k.v;
            if (budget-- <= 0) return null;
            return lookupContext(x).then(function (v) { if (v) { known[x.uri] = { t: now, v: v }; Store.set('ctxCache', known); } return v; });
          })).then(clean);
        });
      });
    },
    // Newest releases from the artists you listen to most (Spotify's "new releases" endpoint is gone in dev mode).
    // One artist at a time, stopping when Spotify says slow down, and kept for 12 hours: this endpoint is
    // rate-limited hard, and asking for eight artists at once at every start was refused every time.
    newFromArtists: function () {
      if (!isSp()) return Promise.resolve([]);
      return memo('newrel', 3600000, function () {
        var kept = Store.get('newrel', null);
        if (kept && Date.now() - kept.t < 43200000) return Promise.resolve(kept.v);
        return this.topArtists().then(function (as) {
          var lists = [], stop = false;
          return as.slice(0, 8).reduce(function (p, a) {
            return p.then(function () {
              if (stop) return;
              return SpotifyApi.get('/artists/' + a.id + '/albums?include_groups=album,single&limit=3').then(function (j) { lists.push(j.items.map(album)); }, function (e) { if (e.code === 429) stop = true; });
            });
          }, Promise.resolve()).then(function () {
            var all = [].concat.apply([], lists); all.sort(function (a, b) { return b.year.localeCompare(a.year); });
            all = clean(all).slice(0, 20);
            if (!stop && all.length) Store.set('newrel', { t: Date.now(), v: all });
            return all;
          });
        });
      }.bind(this));
    },
    clear: function () { cache = {}; likedLoaded = null; likedSet = {}; }
  };
})();
