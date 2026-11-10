// Pages rendered into the main view. Each receives the scroll container's inner element and an argument.
(function () {
  var h = UI.h, esc = UI.esc, $ = function (s, r) { return (r || document).querySelector(s); };
  function sp() { return SpotifyApi.linked(); }
  function greeting() { var hr = new Date().getHours(); return hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; }
  function chips(parent, list, active, onPick) {
    var row = h('div', 'chips');
    list.forEach(function (c) { var b = h('button', 'chip f' + (c[0] === active ? ' on' : ''), esc(c[1])); b.onclick = function () { onPick(c[0]); }; row.appendChild(b); });
    parent.appendChild(row); return row;
  }
  function empty(root, title, text, btn) {
    var e = h('div', 'empty', '<h2>' + esc(title) + '</h2><p class="dim">' + esc(text) + '</p>');
    if (btn) { var b = h('button', 'pill primary f', esc(btn.label)); b.onclick = btn.onClick; e.appendChild(b); }
    root.appendChild(e);
  }
  function trackCtx(name) { return { name: name }; }

  // ---------------- Home ----------------
  UI.register('home', function (root, filter) {
    filter = filter || 'all';
    var show = function (k) { return filter === 'all' || filter === k; };
    var top = h('div', 'home-top'); root.appendChild(top);
    top.appendChild(h('h1', 'greet', greeting()));
    chips(top, [['all', 'All'], ['music', 'Music'], ['playlists', 'Playlists'], ['artists', 'Artists']], filter, function (f) { UI.go('home', f, true); });
    var tiles = h('div', 'tiles'); root.appendChild(tiles);
    function fillTiles(list) {
      tiles.innerHTML = '';
      list.slice(0, 8).forEach(function (it) { tiles.appendChild(UI.tile(it, function () { UI.open(it); })); });
      UI.lazy(tiles);
    }
    if (sp()) {
      var recent = Cat.recent();
      recent.then(function (r) {
        return Cat.playlists().then(function (pls) { fillTiles([Lib.liked()].concat(r, pls)); });
      }).catch(function (e) { fillTiles([Lib.liked()]); UI.toast(e.message); });
      if (show('playlists')) UI.shelf(root, 'Jump back in', recent, { over: 'Recents' });
      if (show('music')) UI.shelf(root, 'Your top songs', Cat.topTracks(), { over: 'On repeat', ctx: trackCtx('Your top songs') });
      if (show('artists')) UI.shelf(root, 'Your favourite artists', Cat.topArtists());
      if (show('music')) UI.shelf(root, 'New from artists you love', Cat.newFromArtists(), { over: 'Fresh releases' });
      if (show('playlists')) UI.shelf(root, 'Your playlists', Cat.playlists(), { more: function () { UI.go('library', 'playlists'); } });
      if (show('music')) UI.shelf(root, 'Saved albums', Cat.albums(), { more: function () { UI.go('library', 'albums'); } });
      if (show('artists')) UI.shelf(root, 'Artists you follow', Cat.following());
      return;
    }
    var quick = [Lib.liked(Library.liked().length)].concat(Library.recent(), Library.playlists().map(Lib.mineLocal));
    fillTiles(quick);
    var trendingPl = Sources.trendingPlaylists(16);
    if (quick.length < 8) trendingPl.then(function (l) { fillTiles(quick.concat(l)); }, function () {});
    if (Library.recent().length && show('playlists')) UI.shelf(root, 'Jump back in', Library.recent(), { over: 'Recents' });
    if (show('playlists') && Library.playlists().length) UI.shelf(root, 'Your playlists', Library.playlists().map(Lib.mineLocal));
    var trending = Sources.trending(null, 20);
    if (show('music')) UI.shelf(root, 'Trending this week', trending, { over: 'On Audius', ctx: trackCtx('Trending this week') });
    if (show('playlists')) UI.shelf(root, 'Trending playlists', trendingPl);
    if (show('music')) UI.shelf(root, 'Underground', Sources.underground(20), { over: 'Fresh finds', ctx: trackCtx('Underground') });
    if (show('music')) CFG.genres.slice(0, 5).forEach(function (g) { UI.shelf(root, g, Sources.trending(g, 16), { over: 'Genre', ctx: trackCtx(g) }); });
  });

  // ---------------- Search ----------------
  var lastQuery = '';
  UI.register('search', function (root) {
    var wrap = h('div', 'search-wrap'); root.appendChild(wrap);
    var left = h('div', 'search-left'), right = h('div', 'search-right');
    wrap.appendChild(left); wrap.appendChild(right);
    var field = h('div', 'search-field', Icon('search', 30) + '<span class="sq"></span><span class="caret"></span>'); left.appendChild(field);
    var qEl = $('.sq', field), timer = null, seq = 0;
    function set(v) { lastQuery = v; qEl.textContent = v || ''; field.classList.toggle('empty', !v); clearTimeout(timer); timer = setTimeout(function () { run(v); }, 450); }
    var kb = Keyboard.create({ value: lastQuery, onChange: set });
    kb.querySelector('.key').classList.add('default');
    left.appendChild(kb);
    left.appendChild(h('p', 'dim small hint', 'Tip: the number keys on your remote type too.'));
    document.onkeydown = function (e) { if (UI.current() === 'search' && !Focus.inLayer() && kb.typeKey(e)) e.preventDefault(); };
    function browse() {
      right.innerHTML = '<h2 class="rh">Browse all</h2>';
      var g = h('div', 'genres'); right.appendChild(g);
      var COL = ['#dc148c', '#006450', '#8400e7', '#1e3264', '#e8115b', '#148a08', '#bc5900', '#503750', '#0d73ec'];
      CFG.genres.forEach(function (name, i) {
        var b = h('button', 'genre f', '<span>' + esc(name) + '</span>'); b.style.backgroundColor = COL[i % COL.length];
        b.onclick = function () { UI.go('genre', name); }; g.appendChild(b);
      });
    }
    function run(v) {
      var my = ++seq;
      if (!v.trim()) return browse();
      right.innerHTML = '<p class="dim pad">Searching for “' + esc(v) + '”…</p>';
      Cat.search(v).then(function (r) {
        if (my !== seq) return;
        right.innerHTML = '';
        if (!r.tracks.length && !r.artists.length && !r.albums.length && !r.playlists.length) { right.appendChild(h('p', 'dim pad', 'No results for “' + esc(v) + '”. Check the spelling, or try fewer words.')); return; }
        var lead = h('div', 'lead-row'); right.appendChild(lead);
        var best = r.artists[0] && (r.artists[0].name.toLowerCase() === v.toLowerCase().trim() || !r.tracks[0]) ? r.artists[0] : r.tracks[0] || r.albums[0];
        if (best) {
          var tb = h('button', 'top-result f', '<div class="tr-art' + (best.kind === 'artist' ? ' round' : '') + '"' + UI.bg(best.avatar || best.cover || best.album_cover_url) + '></div><div class="tr-name">' + esc(best.name) + '</div>' +
            '<div class="tr-sub"><span class="chip-sm">' + (best.kind === 'artist' ? 'Artist' : best.kind === 'album' ? 'Album' : 'Song') + '</span> ' + esc(best.kind === 'artist' ? '' : best.artist_names ? best.artist_names.join(', ') : best.owner) + '</div><div class="play-badge">' + Icon('play', 28) + '</div>');
          tb.onclick = function () { if (best.kind) UI.open(best); else Playback.play(r.tracks, 0, trackCtx('Search: ' + v)); };
          var lw = h('div', 'lead-left', '<h2>Top result</h2>'); lw.appendChild(tb); lead.appendChild(lw);
        }
        if (r.tracks.length) {
          var sw = h('div', 'lead-songs', '<h2>Songs</h2>'); lead.appendChild(sw);
          UI.trackList(sw, r.tracks.slice(0, 4), { compact: true, onPick: function (i) { Playback.play(r.tracks, i, trackCtx('Search: ' + v)); } });
        }
        if (r.tracks.length > 4) {
          var more = h('section', 'shelf', '<div class="shelf-head"><h2>More songs</h2></div>'); right.appendChild(more);
          UI.trackList(more, r.tracks.slice(4), { compact: true, onPick: function (i) { Playback.play(r.tracks, i + 4, trackCtx('Search: ' + v)); } });
        }
        if (r.artists.length) UI.shelf(right, 'Artists', r.artists);
        if (r.albums.length) UI.shelf(right, 'Albums', r.albums);
        if (r.playlists.length) UI.shelf(right, 'Playlists', r.playlists);
        UI.lazy(right);
      }, function (e) { if (my === seq) right.innerHTML = '<p class="dim pad">' + esc(e.message) + '</p>'; });
    }
    set(lastQuery);
  });

  UI.register('genre', function (root, name) {
    root.appendChild(h('h1', 'page-title', esc(name)));
    if (sp()) {
      Cat.search(name).then(function (r) {
        UI.shelf(root, name + ' playlists', r.playlists);
        UI.shelf(root, 'Albums', r.albums);
        UI.shelf(root, 'Artists', r.artists);
        if (r.tracks.length) { var s = h('section', 'shelf', '<div class="shelf-head"><h2>Songs</h2></div>'); root.appendChild(s); UI.trackList(s, r.tracks, { onPick: function (i) { Playback.play(r.tracks, i, trackCtx(name)); } }); }
        UI.lazy(root); Focus.first(root);
      }, function (e) { root.appendChild(h('p', 'dim pad', esc(e.message))); });
      return;
    }
    UI.shelf(root, 'Trending in ' + name, Sources.trending(name, 30), { ctx: trackCtx(name) });
    UI.shelf(root, name + ' playlists', Sources.searchPlaylists(name, 16));
  });

  // ---------------- Library ----------------
  UI.register('library', function (root, tab) {
    tab = tab || 'all';
    var head = h('div', 'lib-head', '<h1>Your Library</h1>'); root.appendChild(head);
    var nb = h('button', 'pill f', Icon('plus', 26) + '<span>Create playlist</span>');
    nb.onclick = function () { UI.askText('Name your playlist', 'My playlist', 'Create', function (n) { Lib.createPlaylist(n).then(function () { UI.toast('Created ' + n); UI.buildLibrary(); UI.refresh(); }, function (e) { UI.toast(e.message); }); }); };
    head.appendChild(nb);
    chips(root, [['all', 'All'], ['playlists', 'Playlists'], ['albums', 'Albums'], ['artists', 'Artists']], tab, function (t) { UI.go('library', t, true); });
    var grid = h('div', 'grid'); root.appendChild(grid);
    grid.appendChild(h('p', 'dim pad', 'Loading…'));
    Lib.libraryItems(tab).then(function (items) {
      grid.innerHTML = '';
      if (!items.length) return grid.appendChild(h('p', 'dim pad', 'Nothing here yet. Save albums, follow artists or create a playlist.'));
      items.forEach(function (it) { grid.appendChild(UI.card(it, function () { UI.open(it); })); });
      UI.lazy(grid);
    }, function (e) { grid.innerHTML = '<p class="dim pad">' + esc(e.message) + '</p>'; });
  });

  // ---------------- Liked songs ----------------
  UI.register('liked', function (root) {
    var act = UI.pageHeader(root, { over: 'Playlist', title: 'Liked Songs', liked: true, sub: esc(Profiles.current().name), tint: false });
    $('.phead', root).style.setProperty('--tint', '#3f2a8c');
    var body = h('div'); root.appendChild(body);
    body.appendChild(h('p', 'dim pad', 'Loading…'));
    Cat.liked().then(function (tracks) {
      body.innerHTML = '';
      $('.psub', root).innerHTML = '<b>' + esc(Profiles.current().name) + '</b> · ' + tracks.length + ' songs';
      var ctx = { name: 'Liked Songs', kind: 'mine', view: 'liked', id: 'liked' };
      if (!tracks.length) return empty(body, 'Songs you like will appear here', 'Save songs by pressing the heart.');
      UI.actionBtn(act, 'play', '', function () { Playback.play(tracks, 0, ctx); }, 'primary default');
      UI.shuffleBtn(act);
      UI.trackList(body, tracks, { onPick: function (i) { Playback.play(tracks, i, ctx); } });
      Focus.first(root);
    }, function (e) { body.innerHTML = '<p class="dim pad">' + esc(e.message) + '</p>'; });
  });

  // ---------------- Audius profiles: local / imported playlist ----------------
  UI.register('playlist', function (root, id) {
    var p = Library.getPlaylist(id);
    if (!p) return empty(root, 'Playlist not found', 'It may have been removed.');
    var local = p.origin === 'local', songs = p.songs || [];
    var tracks = local ? p.tracks : songs.map(function (s) { return { name: s.name, artist_names: [s.artist], album_name: s.album, duration: s.duration, cover_small: s.cover }; });
    var ctx = { kind: 'mine', view: 'playlist', arg: p.id, id: p.id, name: p.name, cover: p.cover || '' };
    var act = UI.pageHeader(root, { over: Library.ORIGIN[p.origin] || 'Playlist', title: p.name, cover: p.cover || (tracks[0] && tracks[0].album_cover_url), sub: '<b>' + esc(Profiles.current().name) + '</b> · ' + tracks.length + ' songs' + (local ? '' : ' · <span class="found">finding playable versions…</span>') });
    var found = local ? tracks : songs.map(function (s) { var t = Library.cached(s); return t ? withOrig(t, s) : t; });
    function playFrom(i) {
      var q = found.filter(Boolean);
      if (!q.length) return UI.toast(local ? 'This playlist is empty' : 'No playable versions found yet');
      Playback.play(q, Math.max(0, found[i] ? q.indexOf(found[i]) : 0), ctx);
      if (!found[i]) UI.toast('That song isn’t available, playing the next one');
    }
    UI.actionBtn(act, 'play', '', function () { playFrom(0); }, 'primary default');
    UI.shuffleBtn(act);
    UI.actionBtn(act, 'trash', 'Remove', function () {
      UI.dialog('Remove “' + p.name + '”?', '<p class="dim">' + (local ? 'This deletes the playlist.' : 'It comes back the next time you import.') + '</p>', [{ label: 'Cancel' }, { label: 'Remove', onClick: function () { Library.removePlaylist(p.id); UI.go('library'); } }]);
    });
    if (!tracks.length) return empty(root, 'Nothing here yet', 'Add songs with the + button next to any song.');
    var list = UI.trackList(root, tracks, { onPick: playFrom, noLike: !local });
    if (local) return;
    found.forEach(function (t, i) { if (t === null) list.mark(i, true); });
    var job = Library.resolve(songs, function (i, t) { found[i] = t ? withOrig(t, songs[i]) : null; list.mark(i, !t); });
    job.then(function () { var el = $('.found', root); if (el) el.textContent = found.filter(Boolean).length + ' of ' + songs.length + ' playable'; });
    root._cleanup = job.stop;
  });
  function withOrig(t, s) { var c = {}; for (var k in t) c[k] = t[k]; c.orig = s; return c; }

  // ---------------- Album / playlist ----------------
  UI.register('collection', function (root, arg) {
    root.appendChild(h('div', 'loading-head'));
    Cat.collection(arg.kind, arg.id).then(function (r) {
      var c = r.item, tracks = r.tracks, ctx = { kind: c.kind, id: c.id, uri: c.uri, name: c.name, cover: c.cover };
      root.innerHTML = '';
      var total = (tracks || []).reduce(function (a, t) { return a + t.duration; }, 0);
      var n = tracks ? tracks.length : c.count, sub = '<b>' + esc(c.owner) + '</b>' + (c.year ? ' · ' + c.year : '') + (n ? ' · ' + n + ' songs' : '') + (total ? ' · ' + Math.round(total / 60000) + ' min' : '');
      var act = UI.pageHeader(root, { over: c.kind === 'album' ? (c.type === 'single' ? 'Single' : 'Album') : 'Playlist', title: c.name, cover: c.cover_big || c.cover, desc: (c.description || '').slice(0, 180), sub: sub });
      UI.actionBtn(act, 'play', '', function () { if (tracks && tracks.length) Playback.play(tracks, null, ctx); else if (c.uri) Playback.playContext(ctx); }, 'primary default');
      UI.shuffleBtn(act);
      var sv = UI.actionBtn(act, 'plus', 'Save', function () {
        Cat.toggleSaved(c).then(function (on) { paintSave(on); UI.toast(on ? 'Saved to Your Library' : 'Removed from Your Library'); UI.buildLibrary(); }, function (e) { UI.toast(e.message); });
      });
      function paintSave(on) { sv.innerHTML = Icon(on ? 'check' : 'plus', 30) + '<span>' + (on ? 'Saved' : 'Save') + '</span>'; sv.classList.toggle('on', on); }
      Cat.loadSavedFlags(c).then(paintSave);
      if (c.owner_id) UI.actionBtn(act, 'user', c.owner, function () { UI.go('artist', c.owner_id); });
      if (!tracks) { empty(root, c.mix ? 'Made for you by Spotify' : 'Songs aren’t listed for this playlist', r.note || ''); }
      else UI.trackList(root, tracks, { onPick: function (i) { Playback.play(tracks, i, ctx); }, noCover: c.kind === 'album', noAlbum: c.kind === 'album' });
      UI.lazy(root); Focus.first(root);
    }, function (e) { root.innerHTML = ''; empty(root, 'Couldn’t open this', e.message, { label: 'Go back', onClick: UI.back }); Focus.first(root); });
  });

  // ---------------- Artist ----------------
  UI.register('artist', function (root, id) {
    root.appendChild(h('div', 'loading-head'));
    Cat.artist(id).then(function (r) {
      var a = r.artist, top = r.top, ctx = { kind: 'artist', id: a.id, uri: a.uri, name: a.name, cover: a.avatar };
      root.innerHTML = '';
      var act = UI.pageHeader(root, { over: 'Artist', title: a.name, cover: a.avatar_big || a.avatar, round: true,
        sub: a.genres && a.genres.length ? esc(a.genres.slice(0, 3).join(' · ')) : a.followers ? UI.count(a.followers) + ' followers' : '', desc: (a.bio || '').slice(0, 160) });
      UI.actionBtn(act, 'play', '', function () { if (a.uri) Playback.playContext(ctx); else if (top.length) Playback.play(top, 0, ctx); }, 'primary default');
      var fb = UI.actionBtn(act, 'plus', 'Follow', function () {
        Cat.toggleSaved(a).then(function (on) { paint(on); UI.toast(on ? 'Following ' + a.name : 'Unfollowed ' + a.name); UI.buildLibrary(); }, function (e) { UI.toast(e.message); });
      });
      function paint(on) { fb.innerHTML = Icon(on ? 'check' : 'plus', 30) + '<span>' + (on ? 'Following' : 'Follow') + '</span>'; fb.classList.toggle('on', on); }
      Cat.loadSavedFlags(a).then(paint);
      if (top.length) {
        var sec = h('section', 'shelf', '<div class="shelf-head"><h2>Popular</h2></div>'); root.appendChild(sec);
        UI.trackList(sec, top.slice(0, 10), { onPick: function (i) { Playback.play(top, i, { name: a.name }); } });
      }
      // Every album and single, newest first, like Spotify's discography.
      var newest = function (l) { return l.slice().sort(function (x, y) { return y.year.localeCompare(x.year); }); };
      if (r.albums.length) UI.shelf(root, 'Albums', newest(r.albums), { over: r.albums.length + ' albums' });
      if (r.singles.length) UI.shelf(root, 'Singles and EPs', newest(r.singles), { over: r.singles.length + ' releases' });
      if (SpotifyApi.linked() && !r.albums.length && !r.singles.length) empty(root, 'Releases didn’t load', 'Spotify is limiting requests right now. Open this artist again in a minute.');
      if (r.playlists.length) UI.shelf(root, 'Playlists', r.playlists);
      UI.lazy(root); Focus.first(root);
    }, function (e) { root.innerHTML = ''; empty(root, 'Couldn’t open this artist', e.message, { label: 'Go back', onClick: UI.back }); Focus.first(root); });
  });

  // ---------------- Queue ----------------
  UI.register('queue', function (root) {
    root.appendChild(h('h1', 'page-title', 'Queue'));
    var body = h('div'); root.appendChild(body);
    body.appendChild(h('p', 'dim pad', 'Loading your queue…'));
    Playback.fullQueue().then(function (q) {
      body.innerHTML = '';
      var cur = Playback.state.engine === 'spotify' ? 0 : Playback.index();
      if (!q.length || !q[cur]) return empty(body, 'Your queue is empty', 'Play an album, playlist or song and it shows up here.', { label: 'Find something to play', onClick: function () { UI.go('search'); } });
      body.appendChild(h('h2', 'sub-h', 'Now playing'));
      UI.trackList(body, [q[cur]], { onPick: function () { Playback.toggle(); } });
      var rest = q.slice(cur + 1);
      if (rest.length) {
        body.appendChild(h('h2', 'sub-h', 'Next up' + (Playback.context() && Playback.context().name ? ' from ' + esc(Playback.context().name) : '') + ' · ' + rest.length + ' songs'));
        UI.trackList(body, rest, { onPick: function (i) { Playback.jump(cur + 1 + i, q); UI.toast('Playing ' + rest[i].name); } });
      }
      UI.lazy(body); Focus.first(root);
    });
  });
})();
