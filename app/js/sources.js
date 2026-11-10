// Audius catalogue (free, open streaming API). Normalised shapes:
//   track:      { uri, id, name, artist_names, artist_id, album_name, album_cover_url, cover_small, duration (ms), src }
//   collection: { kind: 'playlist'|'album', id, name, owner, owner_id, cover, count, description }
//   artist:     { kind: 'artist', id, name, avatar, followers, tracks, verified }
var Sources = (function () {
  var cache = {};
  var q = 'app_name=' + CFG.appName;

  function json(path, ttl) {
    var url = CFG.audius + path + (path.indexOf('?') < 0 ? '?' : '&') + q;
    var hit = cache[url];
    if (hit && Date.now() - hit.t < (ttl || 300000)) return hit.p;
    var p = fetch(url).then(function (r) {
      if (!r.ok) throw new Error('Audius error ' + r.status);
      return r.json();
    }, function () { throw new Error('Cannot reach Audius. Check the TV is online.'); }).then(function (j) { return j.data; });
    cache[url] = { t: Date.now(), p: p };
    p.catch(function () { delete cache[url]; });
    return p;
  }

  function art(a, big) { a = a || {}; return big ? (a['1000x1000'] || a['480x480'] || a['150x150'] || '') : (a['480x480'] || a['150x150'] || ''); }

  function track(t) {
    return {
      uri: 'audius:' + t.id, id: t.id, name: t.title, artist_names: [t.user ? t.user.name : ''], artist_id: t.user ? t.user.id : null,
      album_name: '', album_cover_url: art(t.artwork), cover_big: art(t.artwork, true), cover_small: (t.artwork || {})['150x150'] || art(t.artwork),
      duration: (t.duration || 0) * 1000, genre: t.genre || '', src: { source: 'audius', id: t.id }
    };
  }
  function playable(t) { return t && t.is_streamable !== false && !t.is_stream_gated && !t.is_delete && t.duration > 0; }
  function tracks(list) { return (list || []).filter(playable).map(track); }

  function collection(p) {
    return {
      kind: p.is_album ? 'album' : 'playlist', id: p.id, name: p.playlist_name, owner: p.user ? p.user.name : '', owner_id: p.user ? p.user.id : null,
      cover: art(p.artwork), cover_big: art(p.artwork, true), count: p.track_count || 0, description: p.description || ''
    };
  }
  function artist(u) {
    var pic = u.profile_picture || {};
    return { kind: 'artist', id: u.id, name: u.name, avatar: pic['480x480'] || pic['150x150'] || '', followers: u.follower_count || 0, tracks: u.track_count || 0, verified: !!u.is_verified, bio: u.bio || '' };
  }
  function visible(p) { return p && !p.is_private && !p.is_delete && p.track_count > 0; }

  return {
    trending: function (genre, n) { return json('/tracks/trending?time=week&limit=' + (n || 20) + (genre ? '&genre=' + encodeURIComponent(genre) : '')).then(tracks); },
    underground: function (n) { return json('/tracks/trending/underground?limit=' + (n || 20)).then(tracks); },
    trendingPlaylists: function (n) { return json('/playlists/trending?time=week&limit=' + (n || 20)).then(function (l) { return (l || []).filter(visible).map(collection); }); },
    searchTracks: function (s, n) { return json('/tracks/search?limit=' + (n || 20) + '&query=' + encodeURIComponent(s), 60000).then(tracks); },
    searchPlaylists: function (s, n) { return json('/playlists/search?limit=' + (n || 12) + '&query=' + encodeURIComponent(s), 60000).then(function (l) { return (l || []).filter(visible).map(collection); }); },
    searchArtists: function (s, n) { return json('/users/search?limit=' + (n || 12) + '&query=' + encodeURIComponent(s), 60000).then(function (l) { return (l || []).filter(function (u) { return u.track_count > 0; }).map(artist); }); },
    collection: function (id) { return json('/playlists/' + id).then(function (l) { return collection(l[0] || l); }); },
    collectionTracks: function (id) { return json('/playlists/' + id + '/tracks').then(tracks); },
    artist: function (id) { return json('/users/' + id).then(artist); },
    artistTracks: function (id, n) { return json('/users/' + id + '/tracks?sort=plays&limit=' + (n || 20)).then(tracks); },
    artistAlbums: function (id) { return json('/users/' + id + '/albums?limit=20').then(function (l) { return (l || []).filter(visible).map(collection); }); },
    artistPlaylists: function (id) { return json('/users/' + id + '/playlists?limit=20').then(function (l) { return (l || []).filter(visible).map(collection); }); },
    url: function (src) { return CFG.audius + '/tracks/' + src.id + '/stream?' + q; }
  };
})();
