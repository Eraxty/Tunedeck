// Pages rendered into the main panel. Each receives the scroll container's inner element and an argument.
(function () {
  var h = UI.h, esc = UI.esc, $ = function (s, r) { return (r || document).querySelector(s); };

  function greeting() { var hr = new Date().getHours(); return hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; }
  function mine(p) {
    var n = p.songs ? p.songs.length : (p.tracks || []).length;
    return { kind: 'mine', view: 'playlist', arg: p.id, id: p.id, name: p.name, cover: p.cover || (p.tracks && p.tracks[0] && p.tracks[0].album_cover_url) || '', sub: (Library.ORIGIN[p.origin] || 'Playlist') + ' · ' + n + ' songs' };
  }
  var LIKED = function () { return { kind: 'mine', view: 'liked', id: 'liked', name: 'Liked Songs', icon: 'heartFill', cover: '', sub: Library.liked().length + ' songs' }; };
  function uniqArtists(tracks) {
    var seen = {}, out = [];
    tracks.forEach(function (t) { if (t.artist_id && !seen[t.artist_id]) { seen[t.artist_id] = 1; out.push(t.artist_id); } });
    return out;
  }
  function chips(parent, list, active, onPick) {
    var row = h('div', 'chips');
    list.forEach(function (c) { var b = h('button', 'chip f' + (c[0] === active ? ' on' : ''), esc(c[1])); b.onclick = function () { onPick(c[0]); }; row.appendChild(b); });
    parent.appendChild(row); return row;
  }

  // ---------------- Home ----------------
  UI.register('home', function (root, filter) {
    filter = filter || 'all';
    var top = h('div', 'home-top'); root.appendChild(top);
    top.appendChild(h('h1', 'greet', greeting() + ', ' + esc(Profiles.current().name)));
    chips(top, [['all', 'All'], ['music', 'Music'], ['playlists', 'Playlists'], ['artists', 'Artists']], filter, function (f) { UI.go('home', f, true); });

    // Quick tiles (2 x 4): liked songs, recents, your playlists, then trending playlists to fill.
    var quick = [LIKED()].concat(Library.recent().map(function (r) { return r.view ? r : r; }), Library.playlists().map(mine));
    var tiles = h('div', 'tiles'); root.appendChild(tiles);
    function fillTiles(extra) {
      tiles.innerHTML = '';
      var seen = {}, list = quick.concat(extra || []).filter(function (it) { var k = it.kind + it.id; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 8);
      list.forEach(function (it) { tiles.appendChild(UI.tile(it, function () { UI.open(it); })); });
      UI.lazy(tiles);
    }
    fillTiles();
    var trendingPl = Sources.trendingPlaylists(16);
    if (quick.length < 8) trendingPl.then(fillTiles, function () {});

    var show = function (k) { return filter === 'all' || filter === k; };
    if (Library.recent().length && show('playlists')) UI.shelf(root, 'Jump back in', Library.recent(), { over: 'Recents' });
    if (show('playlists')) {
      var pl = Library.playlists().map(mine);
      if (pl.length) UI.shelf(root, 'Your playlists', pl, { more: function () { UI.go('library', 'playlists'); } });
    }
    var trending = Sources.trending(null, 20);
    if (show('music')) UI.shelf(root, 'Trending this week', trending, { over: 'Made for ' + Profiles.current().name, ctx: { name: 'Trending this week' } });
    if (show('artists')) UI.shelf(root, 'Popular artists', trending.then(function (ts) { return Promise.all(uniqArtists(ts).slice(0, 12).map(function (id) { return Sources.artist(id).catch(function () { return null; }); })); }).then(function (a) { return a.filter(Boolean); }));
    if (show('playlists')) UI.shelf(root, 'Trending playlists', trendingPl);
    if (show('music')) UI.shelf(root, 'Underground', Sources.underground(20), { over: 'Fresh finds' });
    if (Library.following().length && show('artists')) UI.shelf(root, 'Artists you follow', Library.following());
    if (show('music')) CFG.genres.slice(0, 6).forEach(function (g) { UI.shelf(root, g, Sources.trending(g, 16), { over: 'Genre' }); });
  });

  // ---------------- Search ----------------
  var lastQuery = '';
  UI.register('search', function (root) {
    var wrap = h('div', 'search-wrap'); root.appendChild(wrap);
    var left = h('div', 'search-left'), right = h('div', 'search-right');
    wrap.appendChild(left); wrap.appendChild(right);
    left.appendChild(h('h1', null, 'Search'));
    var field = h('div', 'search-field', Icon('search', 30) + '<span class="sq"></span><span class="caret"></span>'); left.appendChild(field);
    var qEl = $('.sq', field), timer = null, seq = 0;
    function set(v) { lastQuery = v; qEl.textContent = v || ''; field.classList.toggle('empty', !v); clearTimeout(timer); timer = setTimeout(function () { run(v); }, 400); }
    var kb = Keyboard.create({ value: lastQuery, onChange: set });
    kb.firstElementChild.firstElementChild.classList.add('default');
    left.appendChild(kb);
    document.onkeydown = function (e) { if (UI.current() === 'search' && !Focus.inLayer() && kb.typeKey(e)) e.preventDefault(); };
    function browse() {
      right.innerHTML = '<h2 class="rh">Browse all</h2>';
      var g = h('div', 'genres'); right.appendChild(g);
      var COL = ['#e13300', '#1e3264', '#8d67ab', '#e8115b', '#148a08', '#bc5900', '#503750', '#0d73ec', '#27856a'];
      CFG.genres.forEach(function (name, i) {
        var b = h('button', 'genre f', '<span>' + esc(name) + '</span>'); b.style.background = COL[i % COL.length];
        b.onclick = function () { UI.go('genre', name); }; g.appendChild(b);
      });
    }
    function run(v) {
      var my = ++seq;
      if (!v.trim()) return browse();
      right.innerHTML = '<p class="dim pad">Searching “' + esc(v) + '”…</p>';
      Promise.all([Sources.searchTracks(v, 20), Sources.searchArtists(v, 10), Sources.searchPlaylists(v, 12)]).then(function (r) {
        if (my !== seq) return;
        right.innerHTML = '';
        var tracks = r[0], artists = r[1], cols = r[2];
        if (!tracks.length && !artists.length && !cols.length) { right.appendChild(h('p', 'dim pad', 'No results for “' + esc(v) + '”')); return; }
        if (tracks.length) {
          var sec = h('section', 'shelf'); sec.innerHTML = '<div class="shelf-head"><h2>Songs</h2></div>'; right.appendChild(sec);
          UI.trackList(sec, tracks.slice(0, 8), { compact: true, onPick: function (i) { Playback.play(tracks, i, { name: 'Search: ' + v }); } });
        }
        if (artists.length) UI.shelf(right, 'Artists', artists);
        if (cols.length) UI.shelf(right, 'Playlists & albums', cols);
        UI.lazy(right);
      }, function (e) { if (my === seq) right.innerHTML = '<p class="dim pad">' + esc(e.message) + '</p>'; });
    }
    set(lastQuery);
  });

  UI.register('genre', function (root, name) {
    root.appendChild(h('h1', 'page-title', esc(name)));
    UI.shelf(root, 'Trending in ' + name, Sources.trending(name, 30), { ctx: { kind: 'mine', view: 'genre', arg: name, id: 'genre:' + name, name: name, cover: '' } });
    var more = Sources.searchPlaylists(name, 16);
    UI.shelf(root, name + ' playlists', more);
  });

  // ---------------- Library ----------------
  UI.register('library', function (root, tab) {
    tab = tab || 'playlists';
    var head = h('div', 'lib-head', '<h1>Your Library</h1>'); root.appendChild(head);
    var nb = h('button', 'pill f', Icon('plus', 26) + '<span>Create</span>');
    nb.onclick = function () { UI.askText('Name your playlist', 'My playlist #' + (Library.playlists().filter(function (p) { return p.origin === 'local'; }).length + 1), 'Create', function (n) { var p = Library.createPlaylist(n); UI.go('playlist', p.id); }); };
    head.appendChild(nb);
    chips(root, [['playlists', 'Playlists'], ['albums', 'Saved'], ['artists', 'Artists'], ['imported', 'Imported']], tab, function (t) { UI.go('library', t, true); });
    var grid = h('div', 'grid'); root.appendChild(grid);
    var items;
    if (tab === 'playlists') items = [LIKED()].concat(Library.playlists().filter(function (p) { return p.origin === 'local' || p.origin === 'spotify'; }).map(mine));
    else if (tab === 'albums') items = Library.saved();
    else if (tab === 'artists') items = Library.following();
    else items = Library.playlists().filter(function (p) { return p.origin !== 'local'; }).map(mine);
    if (!items.length) {
      var msg = { albums: 'Save albums and playlists with the + button on their page.', artists: 'Follow artists from their page.', imported: 'Nothing imported yet. Open Settings → Import from your phone.' }[tab];
      grid.appendChild(h('p', 'dim pad', esc(msg || '')));
      if (tab === 'imported') { var go = h('button', 'pill primary f', 'Open import settings'); go.onclick = function () { UI.go('settings'); }; grid.appendChild(go); }
      return;
    }
    items.forEach(function (it) { grid.appendChild(UI.card(it, function () { UI.open(it); })); });
  });

  // ---------------- Liked songs ----------------
  UI.register('liked', function (root) {
    var tracks = Library.liked();
    var act = UI.pageHeader(root, { over: 'Playlist', title: 'Liked Songs', icon: 'heartFill', sub: esc(Profiles.current().name) + ' · ' + tracks.length + ' songs' });
    $('.pcover', root).classList.add('liked-cover');
    var ctx = { kind: 'mine', view: 'liked', id: 'liked', name: 'Liked Songs', cover: '' };
    if (!tracks.length) { root.appendChild(h('p', 'dim pad', 'Songs you like will appear here. Press the heart on any song.')); return; }
    UI.actionBtn(act, 'play', '', function () { Playback.play(tracks, 0, ctx); }, 'primary default');
    UI.actionBtn(act, 'shuffle', '', function () { Playback.setShuffle(true); Playback.play(tracks, null, ctx); });
    UI.trackList(root, tracks, { onPick: function (i) { Playback.play(tracks, i, ctx); } });
  });

  // ---------------- Your / imported playlist ----------------
  UI.register('playlist', function (root, id) {
    var p = Library.getPlaylist(id);
    if (!p) { root.appendChild(h('p', 'dim pad', 'This playlist no longer exists.')); return; }
    var local = p.origin === 'local', songs = p.songs || [];
    var tracks = local ? p.tracks : songs.map(function (s) { return { name: s.name, artist_names: [s.artist], album_name: s.album, duration: s.duration, cover_small: s.cover }; });
    var ctx = { kind: 'mine', view: 'playlist', arg: p.id, id: p.id, name: p.name, cover: p.cover || '' };
    var act = UI.pageHeader(root, { over: Library.ORIGIN[p.origin] || 'Playlist', title: p.name, cover: p.cover || (tracks[0] && tracks[0].album_cover_url), sub: esc(Profiles.current().name) + ' · ' + tracks.length + ' songs' + (local ? '' : ' · <span class="found">finding playable versions…</span>') });
    var found = local ? tracks : songs.map(function (s) { var t = Library.cached(s); return t ? withOrig(t, s) : t; });
    function playFrom(i) {
      var q = found.filter(Boolean);
      if (!q.length) return UI.toast(local ? 'This playlist is empty' : 'No playable versions found yet');
      var start = found[i] ? q.indexOf(found[i]) : 0;
      Playback.play(q, Math.max(0, start), ctx);
      if (!found[i]) UI.toast('That song isn’t available, playing the next one');
    }
    UI.actionBtn(act, 'play', '', function () { playFrom(0); }, 'primary default');
    UI.actionBtn(act, 'shuffle', '', function () { Playback.setShuffle(true); var q = found.filter(Boolean); if (q.length) Playback.play(q, null, ctx); });
    UI.actionBtn(act, 'trash', '', function () {
      UI.dialog('Remove “' + p.name + '”?', '<p class="dim">' + (local ? 'This deletes the playlist.' : 'It comes back the next time you sync or import.') + '</p>', [{ label: 'Remove', onClick: function () { Library.removePlaylist(p.id); UI.go('library'); } }, { label: 'Cancel' }]);
    });
    if (!tracks.length) { root.appendChild(h('p', 'dim pad', 'Add songs with the + button next to any song.')); return; }
    var list = UI.trackList(root, local ? tracks : tracks, { onPick: playFrom, noLike: !local, col: function (t) { return t.album_name || ''; }, albumCol: 'Album' });
    if (local) return;
    found.forEach(function (t, i) { if (t === null) list.mark(i, true); });
    var job = Library.resolve(songs, function (i, t) { found[i] = t ? withOrig(t, songs[i]) : null; list.mark(i, !t); });
    job.then(function () {
      var ok = found.filter(Boolean).length, el = $('.found', root);
      if (el) el.textContent = ok + ' of ' + songs.length + ' playable';
    });
    root._cleanup = job.stop;
  });
  function withOrig(t, s) { var c = {}; for (var k in t) c[k] = t[k]; c.orig = s; return c; }

  // ---------------- Album / playlist (catalogue) ----------------
  UI.register('collection', function (root, id) {
    root.appendChild(h('p', 'dim pad', 'Loading…'));
    Promise.all([Sources.collection(id), Sources.collectionTracks(id)]).then(function (r) {
      var c = r[0], tracks = r[1], ctx = { kind: c.kind, id: c.id, name: c.name, cover: c.cover, owner: c.owner };
      root.innerHTML = '';
      var total = tracks.reduce(function (a, t) { return a + t.duration; }, 0);
      var act = UI.pageHeader(root, { over: c.kind === 'album' ? 'Album' : 'Playlist', title: c.name, cover: c.cover_big || c.cover, desc: c.description.slice(0, 180),
        sub: '<b>' + esc(c.owner) + '</b> · ' + tracks.length + ' songs · ' + Math.round(total / 60000) + ' min' });
      UI.actionBtn(act, 'play', '', function () { Playback.play(tracks, 0, ctx); }, 'primary default');
      UI.actionBtn(act, 'shuffle', '', function () { Playback.setShuffle(true); Playback.play(tracks, null, ctx); });
      var sv = UI.actionBtn(act, Library.isSaved(c.kind, c.id) ? 'check' : 'plus', Library.isSaved(c.kind, c.id) ? 'Saved' : 'Save', function () {
        var on = Library.toggleSaved({ kind: c.kind, id: c.id, name: c.name, cover: c.cover, owner: c.owner, owner_id: c.owner_id, count: c.count });
        sv.innerHTML = Icon(on ? 'check' : 'plus', 30) + '<span>' + (on ? 'Saved' : 'Save') + '</span>'; UI.toast(on ? 'Saved to Your Library' : 'Removed from Your Library');
      });
      if (c.owner_id) UI.actionBtn(act, 'user', esc(c.owner), function () { UI.go('artist', c.owner_id); });
      UI.trackList(root, tracks, { onPick: function (i) { Playback.play(tracks, i, ctx); } });
      UI.lazy(root); Focus.first(root);
    }, function (e) { root.innerHTML = '<p class="dim pad">' + esc(e.message) + '</p>'; });
  });

  // ---------------- Artist ----------------
  UI.register('artist', function (root, id) {
    root.appendChild(h('p', 'dim pad', 'Loading…'));
    Promise.all([Sources.artist(id), Sources.artistTracks(id, 10)]).then(function (r) {
      var a = r[0], top = r[1], ctx = { kind: 'artist', id: a.id, name: a.name, cover: a.avatar };
      root.innerHTML = '';
      var act = UI.pageHeader(root, { over: a.verified ? 'Verified artist' : 'Artist', title: a.name, cover: a.avatar, round: true, icon: 'user',
        sub: UI.count(a.followers) + ' followers · ' + a.tracks + ' tracks', desc: a.bio.slice(0, 160) });
      UI.actionBtn(act, 'play', '', function () { if (top.length) Playback.play(top, 0, ctx); }, 'primary default');
      var fb = UI.actionBtn(act, Library.isSaved('artist', a.id) ? 'check' : 'plus', Library.isSaved('artist', a.id) ? 'Following' : 'Follow', function () {
        var on = Library.toggleSaved({ kind: 'artist', id: a.id, name: a.name, avatar: a.avatar, followers: a.followers });
        fb.innerHTML = Icon(on ? 'check' : 'plus', 30) + '<span>' + (on ? 'Following' : 'Follow') + '</span>';
      });
      if (top.length) {
        var sec = h('section', 'shelf'); sec.innerHTML = '<div class="shelf-head"><h2>Popular</h2></div>'; root.appendChild(sec);
        UI.trackList(sec, top, { onPick: function (i) { Playback.play(top, i, ctx); } });
      }
      UI.shelf(root, 'Albums', Sources.artistAlbums(id));
      UI.shelf(root, 'Playlists', Sources.artistPlaylists(id));
      UI.lazy(root); Focus.first(root);
    }, function (e) { root.innerHTML = '<p class="dim pad">' + esc(e.message) + '</p>'; });
  });

  // ---------------- Queue ----------------
  UI.register('queue', function (root) {
    root.appendChild(h('h1', 'page-title', 'Queue'));
    var q = Playback.queue(), cur = Playback.index();
    if (!q.length) { root.appendChild(h('p', 'dim pad', 'Nothing queued. Play an album, playlist or song.')); return; }
    root.appendChild(h('h2', 'sub-h', 'Now playing'));
    UI.trackList(root, [q[cur]], { onPick: function () { Playback.toggle(); } });
    var rest = q.slice(cur + 1);
    if (rest.length) {
      root.appendChild(h('h2', 'sub-h', 'Next from: ' + esc(Playback.context() ? Playback.context().name : 'your queue')));
      UI.trackList(root, rest, { onPick: function (i) { Playback.jump(cur + 1 + i); UI.go('queue', null, true); } });
    }
  });

  // ---------------- Marketplace ----------------
  UI.register('market', function (root, tab) {
    tab = tab || 'themes';
    root.appendChild(h('h1', 'page-title', 'Marketplace'));
    root.appendChild(h('p', 'dim lead', 'Themes and extensions from the Spicetify community, installed on this TV for ' + esc(Profiles.current().name) + '.'));
    chips(root, [['themes', 'Themes'], ['extensions', 'Extensions'], ['installed', 'Installed']], tab, function (t) { UI.go('market', t, true); });
    var grid = h('div', 'grid market'); root.appendChild(grid);
    if (tab === 'installed') return installedTab(grid);
    grid.appendChild(h('p', 'dim pad', 'Loading the catalogue…'));
    Ext.catalogue(tab).then(function (repos) {
      grid.innerHTML = '';
      repos.slice(0, 48).forEach(function (r) {
        var c = h('button', 'mcard f', '<div class="mprev"><span class="mph">' + Icon(tab === 'themes' ? 'star' : 'store', 48) + '</span></div><div class="mbody"><div class="t">' + esc(r.name) + '</div>' +
          '<div class="s">' + esc(r.owner) + ' · ★ ' + UI.count(r.stars) + '</div><div class="md">' + esc(r.desc.slice(0, 90)) + '</div></div>');
        c.onclick = function () { detail(r, tab); };
        grid.appendChild(c);
        Ext.manifest(r).then(function (ms) {
          var m = ms[0]; if (!m) { c.classList.add('nomanifest'); return; }
          if (m.preview) { var pv = $('.mprev', c); pv.setAttribute('data-bg', m.preview); UI.lazy(c); }
          if (Ext.installed(m)) c.classList.add('is-installed');
        });
      });
      Focus.first(root);
    }, function (e) { grid.innerHTML = '<p class="dim pad">' + esc(e.message) + '</p>'; });
  });
  function detail(r, kind) {
    Ext.manifest(r).then(function (ms) {
      if (!ms.length) return UI.toast('This repo has no installable manifest');
      var m = ms[0], inst = Ext.installed(m);
      var body = '<div class="mdetail"><div class="mbig"' + UI.bg(m.preview) + '></div><div><p>' + esc(m.desc || r.desc) + '</p><p class="dim">by ' + esc(m.owner) + ' · ★ ' + UI.count(m.stars) + '</p>' +
        (ms.length > 1 ? '<p class="dim">' + ms.length + ' items in this repo; installing the first: ' + esc(m.name) + '</p>' : '') +
        (kind === 'extensions' ? '<p class="dim small">Extensions are written for Spotify desktop. Ones that only use playback controls work here; others are kept off.</p>' : '<p class="dim small">The colour scheme recolours TuneDeck. The theme’s layout CSS is for Spotify desktop and is off unless you enable it in Installed.</p>') + '</div></div>';
      UI.dialog(m.name, body, [
        { label: inst ? 'Reinstall' : 'Install', onClick: function () {
          UI.toast('Installing ' + m.name + '…');
          (kind === 'themes' ? Ext.installTheme(m).then(function (schemes) { UI.toast(m.name + ' applied' + (schemes.length > 1 ? ' · ' + schemes.length + ' colour schemes in Installed' : '')); })
            : Ext.installExtension(m).then(function (ok) { UI.toast(ok ? m.name + ' installed' : m.name + ' needs a newer browser engine than this TV has, kept off'); }))
            .then(function () { UI.refresh(); }, function (e) { UI.toast('Install failed: ' + e.message); });
        } },
        { label: 'Close' }
      ]);
    });
  }
  function installedTab(grid) {
    var d = Ext.db();
    if (!d.themes.length && !d.extensions.length) { grid.appendChild(h('p', 'dim pad', 'Nothing installed yet.')); return; }
    var def = h('button', 'mrow f' + (!d.activeTheme ? ' on' : ''), '<span class="t">Default theme</span><span class="s">' + (!d.activeTheme ? 'Active' : 'Select to use') + '</span>');
    def.onclick = function () { Ext.setTheme(null); UI.refresh(); }; grid.appendChild(def);
    d.themes.forEach(function (t) {
      var active = d.activeTheme === t.id;
      Ext.schemes(t).forEach(function (s) {
        var on = active && (d.scheme === s || (!d.scheme && Ext.schemes(t)[0] === s));
        var b = h('button', 'mrow f' + (on ? ' on' : ''), '<span class="t">' + esc(t.name) + ' · ' + esc(s) + '</span><span class="s">' + (on ? 'Active' : 'Theme') + '</span>');
        b.onclick = function () { Ext.setTheme(t.id, s); UI.refresh(); }; grid.appendChild(b);
      });
      var rm = h('button', 'mrow f', '<span class="t">Remove ' + esc(t.name) + '</span><span class="s">' + Icon('trash', 24) + '</span>');
      rm.onclick = function () { Ext.remove('themes', t.id); UI.refresh(); }; grid.appendChild(rm);
    });
    if (d.themes.length) {
      var css = h('button', 'mrow f' + (d.themeCss ? ' on' : ''), '<span class="t">Apply theme layout CSS</span><span class="s">' + (d.themeCss ? 'On' : 'Off') + ' · made for desktop, may look odd</span>');
      css.onclick = function () { Ext.setThemeCss(!d.themeCss); UI.refresh(); }; grid.appendChild(css);
    }
    d.extensions.forEach(function (x) {
      var b = h('button', 'mrow f' + (x.on ? ' on' : ''), '<span class="t">' + esc(x.name) + '</span><span class="s">' + (!x.compatible ? 'Not compatible with this TV' : x.on ? 'On · restart to apply changes' : 'Off') + '</span>');
      b.onclick = function () {
        if (!x.compatible) return UI.dialog(x.name, '<p class="dim">This extension uses JavaScript newer than the TV’s browser engine supports, so it can’t run here.</p>', [{ label: 'Remove', onClick: function () { Ext.remove('extensions', x.id); UI.refresh(); } }, { label: 'Keep' }]);
        Ext.setExtension(x.id, !x.on); UI.refresh();
      };
      grid.appendChild(b);
    });
  }

  // ---------------- Settings ----------------
  UI.register('settings', function (root) {
    root.appendChild(h('h1', 'page-title', 'Settings'));
    var prof = Profiles.current();

    section(root, 'Profile', function (s) {
      row(s, 'user', prof.name, 'Rename this profile', function () { UI.askText('Rename profile', prof.name, 'Save', function (n) { Profiles.rename(n); UI.buildRail(); UI.refresh(); }); });
      row(s, 'user', 'Switch profile', Profiles.all().length + ' profiles on this TV', function () { Profiles.pick(); });
      row(s, 'trash', 'Delete this profile', 'Removes its library, likes and settings from this TV', function () {
        UI.dialog('Delete ' + prof.name + '?', '<p class="dim">Its library, likes, history and Spotify link are removed from this TV.</p>', [{ label: 'Delete', onClick: function () { Profiles.remove(prof.id); } }, { label: 'Cancel' }]);
      });
    });

    section(root, 'Import from your phone', function (s) {
      var box = h('div', 'qr-box', '<div class="qr-slot"><p class="dim">Starting…</p></div><div class="qr-text"><h3>Scan with your phone</h3>' +
        '<p class="dim">Upload your Spotify “Download your data” zip or Google Takeout (YouTube / YouTube Music) export. Re-upload a newer export any time to sync.</p><p class="imp-status">Last import: ' + UI.ago(Library.importedAt()) + '</p></div>');
      s.appendChild(box);
      helperInfo().then(function (i) { $('.qr-slot', box).innerHTML = UI.qr(i.phoneUrl, 300) + '<div class="qr-url">' + esc(i.phoneUrl) + '</div>'; },
        function (e) { $('.qr-slot', box).innerHTML = '<p class="dim">' + esc(e.message) + '</p>'; });
    });

    section(root, 'Spotify', function (s) {
      if (Spotify.linked()) {
        row(s, 'link', 'Sync now', 'Linked ' + UI.ago(Spotify.linkedAt()) + ' · last sync ' + UI.ago(Library.syncedAt()) + ' · syncs every 6 hours', function () { syncNow(); });
        row(s, 'close', 'Disconnect Spotify', 'Your synced playlists stay until you remove them', function () { Spotify.unlink(); UI.toast('Spotify disconnected'); UI.refresh(); });
      } else {
        row(s, 'link', 'Connect Spotify', 'Log in on your phone to sync your playlists and Liked Songs', function () { connectSpotify(); });
      }
    });

    section(root, 'Playback', function (s) {
      row(s, 'music', 'Re-match imported songs', 'Look up playable versions again', function () { Library.clearMatches(); UI.toast('Matches cleared'); });
      row(s, 'lyrics', 'Lyrics timing', 'While lyrics show: red button = earlier, green = later (saved per song)', null);
    });

    section(root, 'About', function (s) {
      s.appendChild(h('p', 'dim about-txt', 'TuneDeck ' + CFG.version + ' · Music streams from Audius, an open music platform. Lyrics from LRCLIB. Themes and extensions from the Spicetify community.'));
    });
    Focus.first(root);
  });
  function section(root, title, fill) { var s = h('section', 'set-sec', '<h2>' + esc(title) + '</h2>'); root.appendChild(s); fill(s); }
  function row(s, icon, title, sub, fn) {
    var b = h(fn ? 'button' : 'div', 'set-row' + (fn ? ' f' : ''), Icon(icon, 30) + '<span><span class="t">' + esc(title) + '</span><span class="s">' + esc(sub) + '</span></span>');
    if (fn) b.onclick = fn; s.appendChild(b); return b;
  }
  function helperInfo() {
    return fetch(CFG.helper + '/api/info').then(function (r) { return r.json(); }, function () { throw new Error('The TuneDeck helper isn’t running on this TV.'); });
  }
  function syncNow() {
    UI.toast('Syncing Spotify…');
    Library.syncSpotify(function (m) { UI.toast(m); }).then(function (r) {
      UI.toast('Synced ' + r.playlists + ' playlists' + (r.skipped ? ' · ' + r.skipped + ' followed playlists skipped (Spotify only shares ones you own)' : ''));
      UI.buildRail(); if (UI.current() === 'settings') UI.refresh();
    }, function (e) { UI.toast(e.message); });
  }
  function connectSpotify() {
    Spotify.startLogin(function (err) {
      if (d) d.close();
      if (err) return UI.toast(err.message);
      UI.toast('Spotify connected'); syncNow();
    }).then(function (info) {
      d = UI.dialog('Connect Spotify', '<div class="qr-box">' + UI.qr(info.phoneUrl, 300) + '<div class="qr-text"><h3>Scan with your phone</h3>' +
        '<p class="dim">Log in to Spotify on your phone. When your browser warns that the connection to the TV isn’t private, choose to continue: that’s the TV’s own certificate.</p>' +
        '<p class="dim small">One-time setup in the Spotify developer dashboard: add <b>' + esc(info.callback) + '</b> as a Redirect URI.</p></div></div>',
        [{ label: 'Cancel', onClick: function () { Spotify.stopLogin(); } }]);
    }, function (e) { UI.toast(e.message); });
    var d = null;
  }

  // Imports from the phone are picked up wherever you are in the app.
  setInterval(function () {
    Library.checkHelper(function (r) {
      if (r.progress) return UI.toast(r.progress);
      if (r.error) return UI.toast('Import failed: ' + r.error);
      var n = r.playlists.length, songs = r.playlists.reduce(function (a, p) { return a + p.songs.length; }, 0);
      UI.toast(n ? 'Imported ' + n + ' playlists (' + songs + ' songs)' : 'Nothing to import in those files');
      UI.buildRail();
      if (UI.current() === 'library' || UI.current() === 'settings') UI.refresh();
    });
  }, 6000);
})();
