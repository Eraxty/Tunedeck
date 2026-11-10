// Marketplace, Settings and the Spotify sign-in dialog.
var Account = (function () {
  var h = UI.h, esc = UI.esc;
  function helperInfo() {
    return fetch(CFG.helper + '/api/info').then(function (r) { return r.json(); }, function () { throw new Error('The TuneDeck helper isn’t running on this TV. Reinstall TuneDeck.'); });
  }
  // Sign in to Spotify from the TV: a QR code opens the login on the phone; the TV helper relays the result.
  function signIn(done) {
    var d = null;
    Spotify.startLogin(function (err) {
      if (d) d.close();
      if (err) { UI.toast(err.message); Log.add('login fail', err.message); return done && done(err); }
      Cat.clear();
      Spotify.me().then(function (m) { Profiles.linkSpotify(m); UI.toast('Signed in as ' + m.name); if (done) done(null, m); },
        function (e) { UI.toast(e.message); if (done) done(e); });
    }).then(function (info) {
      d = UI.dialog('Sign in with Spotify',
        '<div class="signin">' + UI.qr(info.phoneUrl, 320) + '<div class="si-steps">' +
        '<div class="step"><b>1</b><span>Scan the code with your phone’s camera</span></div>' +
        '<div class="step"><b>2</b><span>Your phone warns the TV’s connection isn’t private. Tap <i>Advanced → Continue</i>: it’s your TV’s own certificate</span></div>' +
        '<div class="step"><b>3</b><span>Log in to Spotify and tap <i>Agree</i>. The TV signs in by itself.</span></div>' +
        '<p class="dim small">Waiting for your phone…</p></div></div>' +
        '<p class="dim small setup">First time only: in the Spotify developer dashboard, add <b>' + esc(info.callback) + '</b> as a Redirect URI, and add each person’s Spotify email under Users and Access.</p>',
        [{ label: 'Cancel', onClick: function () { Spotify.stopLogin(); if (done) done(new Error('cancelled')); } }]);
    }, function (e) { UI.toast(e.message); if (done) done(e); });
  }
  return { signIn: signIn, helperInfo: helperInfo };
})();

(function () {
  var h = UI.h, esc = UI.esc, $ = function (s, r) { return (r || document).querySelector(s); };
  function chips(parent, list, active, onPick) {
    var row = h('div', 'chips');
    list.forEach(function (c) { var b = h('button', 'chip f' + (c[0] === active ? ' on' : ''), esc(c[1])); b.onclick = function () { onPick(c[0]); }; row.appendChild(b); });
    parent.appendChild(row);
  }
  function swatches(vars) {
    var keys = ['--spice-main', '--spice-sidebar', '--spice-card', '--spice-button', '--spice-text'];
    return '<span class="sw">' + keys.map(function (k) { return vars[k] ? '<i style="background:#' + vars[k] + '"></i>' : ''; }).join('') + '</span>';
  }

  // ---------------- Marketplace ----------------
  UI.register('market', function (root, tab) {
    tab = tab || 'themes';
    root.appendChild(h('h1', 'page-title', 'Marketplace'));
    root.appendChild(h('p', 'dim lead', 'Themes and extensions from the Spicetify community, downloaded to this TV for ' + esc(Profiles.current().name) + '.'));
    chips(root, [['themes', 'Themes'], ['extensions', 'Extensions'], ['installed', 'Installed']], tab, function (t) { UI.go('market', t, true); });
    if (tab === 'installed') return installedTab(root);
    if (tab === 'themes') {
      var fs = h('section', 'shelf', '<div class="shelf-head"><div class="over">One press, no download</div><h2>Featured palettes</h2></div><div class="hs"><div class="in"></div></div>');
      root.appendChild(fs);
      var row = $('.in', fs), active = Ext.db().activeTheme;
      var def = h('button', 'pal f' + (!active ? ' on' : ''), '<span class="sw"><i style="background:#121214"></i><i style="background:#0c0c0e"></i><i style="background:#1c1c1f"></i><i style="background:#1ed760"></i><i style="background:#fff"></i></span><span class="pn">Spotify</span>');
      def.onclick = function () { Ext.setTheme(null); UI.toast('Default theme'); UI.refresh(); }; row.appendChild(def);
      Ext.featured().forEach(function (f) {
        var vars = {}; Object.keys(f.c).forEach(function (k) { vars['--spice-' + k] = f.c[k]; });
        var b = h('button', 'pal f' + (active === f.id ? ' on' : ''), swatches(vars) + '<span class="pn">' + esc(f.name) + '</span>');
        b.onclick = function () { Ext.setTheme(f.id); UI.toast(f.name + ' applied'); UI.refresh(); };
        row.appendChild(b);
      });
      root.appendChild(h('div', 'shelf-head pad-top', '<div class="over">From GitHub</div><h2>Community themes</h2>'));
    } else root.appendChild(h('div', 'shelf-head pad-top', '<div class="over">From GitHub</div><h2>Community extensions</h2>'));
    var grid = h('div', 'grid market'); root.appendChild(grid);
    grid.appendChild(h('p', 'dim pad', 'Loading the catalogue from GitHub…'));
    Ext.items(tab).then(function (list) {
      grid.innerHTML = '';
      if (!list.length) return grid.appendChild(h('p', 'dim pad', 'Nothing found. GitHub may be limiting requests; try again in a minute.'));
      list.slice(0, 60).forEach(function (m) {
        var c = h('button', 'mcard f' + (Ext.installed(m) ? ' is-installed' : ''), '<div class="mprev"' + UI.bg(m.preview) + '></div><div class="mbody"><div class="t">' + esc(m.name) + '</div>' +
          '<div class="s">' + esc(m.owner) + (m.stars ? ' · ★ ' + UI.count(m.stars) : '') + '</div><div class="md">' + esc((m.desc || '').slice(0, 96)) + '</div></div>');
        c.onclick = function () { (tab === 'themes' ? themeDetail : extDetail)(m); };
        grid.appendChild(c);
      });
      UI.lazy(grid);
    }, function (e) { grid.innerHTML = '<p class="dim pad">' + esc(e.message) + '</p>'; });
  });

  function themeDetail(m) {
    var d = UI.layer('dialog-layer', '<div class="dialog xwide"><div class="mdetail"><div class="mbig"' + UI.bg(m.preview) + '></div><div class="mtext"><h2>' + esc(m.name) + '</h2>' +
      '<p class="dim">by ' + esc(m.owner) + (m.stars ? ' · ★ ' + UI.count(m.stars) : '') + '</p><p>' + esc(m.desc || '') + '</p></div></div>' +
      '<h3 class="sch-h">Colour schemes</h3><div class="schemes"><p class="dim">Downloading…</p></div><div class="dbtns"><button class="pill f close-d">Close</button></div></div>');
    d.el.querySelector('.close-d').onclick = d.close;
    var box = d.el.querySelector('.schemes');
    Ext.themeSchemes(m).then(function (sch) {
      var names = Object.keys(sch);
      box.innerHTML = '';
      if (!names.length) { box.innerHTML = '<p class="dim">This theme only has layout CSS for Spotify desktop and no colour schemes, so it can’t restyle TuneDeck.</p>'; return; }
      names.forEach(function (n, i) {
        var b = h('button', 'scheme f' + (i === 0 ? ' default' : ''), swatches(sch[n]) + '<span>' + esc(n) + '</span>');
        b.onclick = function () {
          UI.toast('Downloading ' + m.name + '…');
          Ext.installTheme(m, n).then(function () { d.close(); UI.toast(m.name + ' · ' + n + ' applied'); UI.refresh(); }, function (e) { UI.toast(e.message); });
        };
        box.appendChild(b);
      });
      UI.lazy(d.el); Focus.first(box);
    }, function (e) { box.innerHTML = '<p class="dim">' + esc(e.message) + '</p>'; });
  }

  function extDetail(m) {
    var d = UI.layer('dialog-layer', '<div class="dialog xwide"><div class="mdetail"><div class="mbig"' + UI.bg(m.preview) + '></div><div class="mtext"><h2>' + esc(m.name) + '</h2>' +
      '<p class="dim">by ' + esc(m.owner) + (m.stars ? ' · ★ ' + UI.count(m.stars) : '') + '</p><p>' + esc(m.desc || '') + '</p><p class="compat dim">Checking whether it runs on this TV…</p></div></div>' +
      '<div class="dbtns"><button class="pill primary f inst" disabled>Install</button><button class="pill f close-d">Close</button></div></div>');
    d.el.querySelector('.close-d').onclick = d.close;
    var inst = d.el.querySelector('.inst'), compat = d.el.querySelector('.compat');
    Ext.checkExtension(m).then(function (ok) {
      compat.innerHTML = ok ? '<span class="ok">✓ Compatible with this TV.</span> Extensions written for Spotify desktop may only partly work here.' : '<span class="bad">✕ Needs a newer browser engine than this TV has.</span> It can be installed but stays off.';
      inst.disabled = false; inst.textContent = ok ? 'Install' : 'Install anyway';
      inst.onclick = function () { Ext.installExtension(m).then(function (on) { d.close(); UI.toast(on ? m.name + ' installed and running' : m.name + ' installed (off: not compatible)'); UI.refresh(); }, function (e) { UI.toast(e.message); }); };
    }, function (e) { compat.textContent = e.message; });
  }

  function installedTab(root) {
    var d = Ext.db(), list = h('div', 'set-sec'); root.appendChild(list);
    function row(title, sub, on, fn, icon) {
      var b = h('button', 'set-row f' + (on ? ' on' : ''), Icon(icon || 'star', 30) + '<span><span class="t">' + esc(title) + '</span><span class="s">' + sub + '</span></span>');
      b.onclick = fn; list.appendChild(b);
    }
    list.appendChild(h('h2', null, 'Themes'));
    row('Spotify (default)', !d.activeTheme ? 'Active' : 'Select to use', !d.activeTheme, function () { Ext.setTheme(null); UI.refresh(); });
    Ext.featured().forEach(function (f) { if (d.activeTheme === f.id) row(f.name, 'Active · featured palette', true, function () {}); });
    d.themes.forEach(function (t) {
      var sch = Ext.parseIni(t.ini || '');
      Object.keys(sch).forEach(function (s) {
        var on = d.activeTheme === t.id && (d.scheme === s || (!d.scheme && Object.keys(sch)[0] === s));
        row(t.name + ' · ' + s, swatches(sch[s]) + (on ? ' Active' : ''), on, function () { Ext.setTheme(t.id, s); UI.refresh(); });
      });
      row('Remove ' + t.name, 'Deletes the download', false, function () { Ext.remove('themes', t.id); UI.refresh(); }, 'trash');
    });
    if (d.themes.length) row('Theme layout CSS', (d.themeCss ? 'On' : 'Off') + ' · written for Spotify desktop, can look odd here', d.themeCss, function () { Ext.setThemeCss(!d.themeCss); UI.refresh(); }, 'settings');
    list.appendChild(h('h2', 'pad-top', 'Extensions'));
    if (!d.extensions.length) list.appendChild(h('p', 'dim pad', 'No extensions installed.'));
    d.extensions.forEach(function (x) {
      row(x.name, !x.compatible ? 'Not compatible with this TV · select to remove' : x.on ? 'On · restart TuneDeck to apply changes' : 'Off', x.on, function () {
        if (!x.compatible) { Ext.remove('extensions', x.id); UI.refresh(); return; }
        Ext.setExtension(x.id, !x.on); UI.refresh();
      }, 'store');
    });
  }

  // ---------------- Settings ----------------
  UI.register('settings', function (root) {
    root.appendChild(h('h1', 'page-title', 'Settings'));
    var prof = Profiles.current();

    section(root, 'Spotify', function (s) {
      if (Spotify.linked()) {
        var me = Spotify.cachedMe() || { name: 'your account' }, st = Playback.spotify();
        row(s, 'user', 'Signed in as ' + me.name, 'Your playlists, Liked Songs and library sync live with Spotify', null);
        row(s, 'music', 'Spotify player on this TV', st.status === 'ready' ? 'Ready · shows up as “' + CFG.deviceName + '” in Spotify Connect' : st.status === 'error' ? st.error : st.status === 'loading' ? 'Starting…' : 'Starts when you play something', function () { Playback.initSpotify().then(function () { UI.toast('Spotify player ready'); UI.refresh(); }, function (e) { UI.toast(e.message); }); });
        row(s, 'close', 'Sign out of Spotify', 'This profile goes back to free Audius music', function () { Spotify.unlink(); Cat.clear(); Profiles.linkSpotify(null); UI.toast('Signed out'); location.reload(); });
      } else {
        row(s, 'link', 'Sign in with Spotify', 'Play your Spotify music, playlists and Liked Songs on this TV (Premium)', function () { Account.signIn(function (err) { if (!err) location.reload(); }); });
      }
    });

    section(root, 'Profile', function (s) {
      row(s, 'user', prof.name, 'Rename this profile', function () { UI.askText('Rename profile', prof.name, 'Save', function (n) { Profiles.rename(n); UI.buildTop(); UI.refresh(); }); });
      row(s, 'user', 'Switch profile', Profiles.all().length + (Profiles.all().length === 1 ? ' profile' : ' profiles') + ' on this TV', function () { Profiles.pick(); });
      row(s, 'trash', 'Delete this profile', 'Removes its library, likes and settings from this TV', function () {
        UI.dialog('Delete ' + prof.name + '?', '<p class="dim">Its library, likes, history and sign-in are removed from this TV.</p>', [{ label: 'Cancel' }, { label: 'Delete', onClick: function () { Profiles.remove(prof.id); } }]);
      });
    });

    if (!Spotify.linked()) section(root, 'Import from your phone', function (s) {
      var box = h('div', 'qr-box', '<div class="qr-slot"><p class="dim">Starting…</p></div><div class="qr-text"><h3>Bring your playlists</h3>' +
        '<p class="dim">Scan with your phone and upload your Spotify “Download your data” zip or a Google Takeout (YouTube / YouTube Music) export.</p><p class="imp-status">Last import: ' + UI.ago(Library.importedAt()) + '</p></div>');
      s.appendChild(box);
      Account.helperInfo().then(function (i) { $('.qr-slot', box).innerHTML = UI.qr(i.phoneUrl, 280) + '<div class="qr-url">' + esc(i.phoneUrl) + '</div>'; },
        function (e) { $('.qr-slot', box).innerHTML = '<p class="dim">' + esc(e.message) + '</p>'; });
    });

    section(root, 'Playback', function (s) {
      row(s, 'lyrics', 'Lyrics timing', 'In the player: the − / + buttons, or the red and green remote buttons, move lyrics earlier or later (saved per song)', null);
      if (!Spotify.linked()) row(s, 'music', 'Re-match imported songs', 'Look up playable versions again', function () { Library.clearMatches(); UI.toast('Matches cleared'); });
    });

    section(root, 'About', function (s) {
      s.appendChild(h('p', 'dim about-txt', 'TuneDeck ' + CFG.version + '. Spotify playback through Spotify’s Web Playback SDK. Free music from Audius. Lyrics from LRCLIB. Themes and extensions from the Spicetify community.'));
    });
    Focus.first(root);
  });
  function section(root, title, fill) { var s = h('section', 'set-sec', '<h2>' + esc(title) + '</h2>'); root.appendChild(s); fill(s); }
  function row(s, icon, title, sub, fn) {
    var b = h(fn ? 'button' : 'div', 'set-row' + (fn ? ' f' : ''), Icon(icon, 30) + '<span><span class="t">' + esc(title) + '</span><span class="s">' + esc(sub) + '</span></span>');
    if (fn) b.onclick = fn; s.appendChild(b); return b;
  }

  // Imports from the phone are picked up wherever you are in the app.
  setInterval(function () {
    if (!Profiles.started() || Spotify.linked()) return;
    Library.checkHelper(function (r) {
      if (r.progress) return UI.toast(r.progress);
      if (r.error) return UI.toast('Import failed: ' + r.error);
      var n = r.playlists.length, songs = r.playlists.reduce(function (a, p) { return a + p.songs.length; }, 0);
      UI.toast(n ? 'Imported ' + n + ' playlists (' + songs + ' songs)' : 'Nothing to import in those files');
      UI.buildLibrary();
      if (UI.current() === 'library' || UI.current() === 'settings') UI.refresh();
    });
  }, 6000);
})();
