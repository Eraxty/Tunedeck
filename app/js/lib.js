// "Your Library" operations for the active profile, the same calls for Spotify and Audius profiles.
var Lib = (function () {
  function liked(n) { return { kind: 'mine', view: 'liked', id: 'liked', liked: true, name: 'Liked Songs', libSub: 'Playlist · ' + (n == null ? '' : n + ' songs') }; }
  function mineLocal(p) {
    var n = p.songs ? p.songs.length : (p.tracks || []).length;
    return { kind: 'mine', view: 'playlist', arg: p.id, id: p.id, name: p.name, cover: p.cover || (p.tracks && p.tracks[0] && p.tracks[0].album_cover_url) || '',
      libSub: (Library.ORIGIN[p.origin] || 'Playlist') + ' · ' + n + ' songs', sub: (Library.ORIGIN[p.origin] || 'Playlist') + ' · ' + n + ' songs' };
  }
  function libraryItems(filter) {
    filter = filter || 'all';
    var want = function (k) { return filter === 'all' || filter === k; };
    if (!Spotify.linked()) {
      var out = want('playlists') ? [liked(Library.liked().length)].concat(Library.playlists().map(mineLocal)) : [];
      if (want('albums')) out = out.concat(Library.saved().map(function (x) { x.libSub = (x.kind === 'album' ? 'Album · ' : 'Playlist · ') + x.owner; return x; }));
      if (want('artists')) out = out.concat(Library.following().map(function (x) { x.libSub = 'Artist'; return x; }));
      return Promise.resolve(out);
    }
    return Promise.all([
      want('playlists') ? Cat.playlists() : [], want('albums') ? Cat.albums() : [], want('artists') ? Cat.following() : []
    ]).then(function (r) {
      var out = want('playlists') ? [liked(null)] : [];
      r[0].forEach(function (p) { p.libSub = 'Playlist · ' + p.owner; out.push(p); });
      r[1].forEach(function (a) { a.libSub = 'Album · ' + a.owner; out.push(a); });
      r[2].forEach(function (a) { a.libSub = 'Artist'; out.push(a); });
      return out;
    });
  }
  function editablePlaylists() {
    if (!Spotify.linked()) return Promise.resolve(Library.playlists().filter(function (p) { return p.origin === 'local'; }).map(function (p) { return { id: p.id, name: p.name, cover: p.cover, local: true }; }));
    return Cat.playlists().then(function (l) { return l.filter(function (p) { return p.own; }); });
  }
  function createPlaylist(name, first) {
    if (!Spotify.linked()) { var p = Library.createPlaylist(name); if (first) Library.addToPlaylist(p.id, first); return Promise.resolve(p); }
    return Spotify.call('POST', '/me/playlists', { name: name, public: false, description: 'Made on TuneDeck' }).then(function (p) {
      Cat.clear(); return first ? addToPlaylist({ id: p.id }, first).then(function () { return p; }) : p;
    });
  }
  function addToPlaylist(p, t) {
    if (!Spotify.linked() || p.local) { Library.addToPlaylist(p.id, t); return Promise.resolve(); }
    if (t.src.source !== 'spotify') return Promise.reject(new Error('Only Spotify songs can go in a Spotify playlist'));
    return Spotify.call('POST', '/playlists/' + p.id + '/items', { uris: [t.uri] });
  }
  return { libraryItems: libraryItems, editablePlaylists: editablePlaylists, createPlaylist: createPlaylist, addToPlaylist: addToPlaylist, liked: liked, mineLocal: mineLocal };
})();
