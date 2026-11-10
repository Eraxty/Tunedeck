// Marketplace: browses the Spicetify community catalogue (GitHub repos tagged spicetify-extensions /
// spicetify-themes, each with a manifest.json, same source the Spicetify Marketplace uses) and installs
// into the active profile. Themes apply their color.ini scheme through the --spice-* variables the whole
// app is styled with. A theme's user.css restyles Spotify desktop's own screen layout, which TuneDeck doesn't
// have: it can't match anything here and its effects only slow the TV, so it is never downloaded.
// Extensions run against a Spicetify-compatible API subset. Most are written for newer browsers than this TV's
// Chrome 53, so they are converted on the TV with Babel (loaded only while installing) and stored converted.
var Ext = (function () {
  var topbar = [], menus = [], modal = null, muted = 0;
  var GH = 'https://api.github.com/search/repositories?sort=stars&order=desc&per_page=60&q=topic:';
  var VARS = ['text', 'subtext', 'main', 'main-elevated', 'highlight', 'highlight-elevated', 'sidebar', 'player', 'card', 'shadow',
    'selected-row', 'button', 'button-active', 'button-disabled', 'tab-active', 'notification', 'notification-error', 'misc'];

  function db() { return Store.get('ext', { themes: [], extensions: [], activeTheme: null, scheme: null }); }

  // One-press palettes (no download), written in color.ini terms so they go through the same path as themes.
  var FEATURED = [
    { id: 'builtin:catppuccin', name: 'Catppuccin Mocha', c: { text: 'cdd6f4', subtext: 'a6adc8', main: '1e1e2e', sidebar: '181825', player: '11111b', card: '313244', button: 'cba6f7', 'button-active': 'b4befe', highlight: '45475a', 'main-elevated': '262637', 'highlight-elevated': '585b70' } },
    { id: 'builtin:nord', name: 'Nord', c: { text: 'eceff4', subtext: 'd8dee9', main: '2e3440', sidebar: '272c36', player: '242933', card: '3b4252', button: '88c0d0', 'button-active': '8fbcbb', highlight: '434c5e', 'main-elevated': '343b48', 'highlight-elevated': '4c566a' } },
    { id: 'builtin:dracula', name: 'Dracula', c: { text: 'f8f8f2', subtext: 'bfbfbf', main: '282a36', sidebar: '21222c', player: '191a21', card: '343746', button: 'bd93f9', 'button-active': 'ff79c6', highlight: '44475a', 'main-elevated': '2f3141', 'highlight-elevated': '565970' } },
    { id: 'builtin:rosepine', name: 'Rosé Pine', c: { text: 'e0def4', subtext: '908caa', main: '191724', sidebar: '1f1d2e', player: '13111d', card: '26233a', button: 'ebbcba', 'button-active': 'f6c177', highlight: '403d52', 'main-elevated': '1f1d2e', 'highlight-elevated': '524f67' } },
    { id: 'builtin:gruvbox', name: 'Gruvbox', c: { text: 'ebdbb2', subtext: 'a89984', main: '282828', sidebar: '1d2021', player: '1d2021', card: '3c3836', button: 'b8bb26', 'button-active': 'fabd2f', highlight: '504945', 'main-elevated': '32302f', 'highlight-elevated': '665c54' } },
    { id: 'builtin:tokyonight', name: 'Tokyo Night', c: { text: 'c0caf5', subtext: '9aa5ce', main: '1a1b26', sidebar: '16161e', player: '13131a', card: '24283b', button: '7aa2f7', 'button-active': 'bb9af7', highlight: '2f3549', 'main-elevated': '1f2335', 'highlight-elevated': '3b4261' } }
  ];
  function featuredIni(f) { return '[' + f.name + ']\n' + Object.keys(f.c).map(function (k) { return k + ' = ' + f.c[k]; }).join('\n'); }
  function save(d) { Store.set('ext', d); }

  // ---- catalogue ----
  function catalogue(kind) {
    var key = 'market.' + kind, c = Store.gget(key, null);
    if (c && Date.now() - c.t < 24 * 3600 * 1000 && c.items.length) return Promise.resolve(c.items);
    return fetch(GH + (kind === 'themes' ? 'spicetify-themes' : 'spicetify-extensions')).then(function (r) {
      if (r.status === 403) throw new Error('GitHub is limiting requests right now. Try again in a minute.');
      if (!r.ok) throw new Error('GitHub error ' + r.status);
      return r.json();
    }, function () { throw new Error('Cannot reach GitHub'); }).then(function (j) {
      var items = (j.items || []).filter(function (r) { return !r.archived; }).map(function (r) {
        return { repo: r.full_name, name: r.name, owner: r.owner.login, stars: r.stargazers_count, branch: r.default_branch, desc: r.description || '' };
      });
      Store.gset(key, { t: Date.now(), items: items });
      return items;
    });
  }
  function raw(repo, branch, path) { return 'https://raw.githubusercontent.com/' + repo + '/' + branch + '/' + path.replace(/^\.?\//, ''); }
  function abs(repo, branch, p) { return !p ? '' : /^https?:/.test(p) ? p : raw(repo, branch, p); }
  // A repo's manifest may list several items.
  var manifests = {};
  function manifest(it) {
    if (manifests[it.repo]) return manifests[it.repo];
    var p = fetch(raw(it.repo, it.branch, 'manifest.json')).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
      if (!m) return [];
      return (Array.isArray(m) ? m : [m]).map(function (x) {
        return { repo: it.repo, branch: x.branch || it.branch, name: x.name || it.name, desc: x.description || it.desc, owner: it.owner, stars: it.stars,
          preview: abs(it.repo, x.branch || it.branch, x.preview), main: x.main, usercss: x.usercss, schemes: x.schemes, readme: x.readme };
      });
    }).catch(function () { return []; });
    manifests[it.repo] = p;
    return p;
  }
  // Every installable item (theme or extension) across the most-starred repos; packs with many items
  // (like spicetify/spicetify-themes) become one card per item.
  function items(kind) {
    return catalogue(kind).then(function (repos) {
      if (kind === 'themes' && !repos.some(function (r) { return r.repo === 'spicetify/spicetify-themes'; }))
        repos.unshift({ repo: 'spicetify/spicetify-themes', name: 'spicetify-themes', owner: 'spicetify', stars: 0, branch: 'master', desc: '' });
      var out = [], i = 0, list = repos.slice(0, 30);
      return new Promise(function (done) {
        var active = 0;
        function next() {
          if (i >= list.length && !active) return done(out);
          while (active < 6 && i < list.length) {
            active++;
            manifest(list[i++]).then(function (ms) {
              ms.forEach(function (m) { if (kind === 'themes' ? m.schemes || m.usercss : m.main) out.push(m); });
              active--; next();
            });
          }
        }
        next();
      }).then(function (all) { all.sort(function (a, b) { return b.stars - a.stars; }); return all; });
    });
  }
  function text(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error('Download failed (' + r.status + ')'); return r.text(); }); }

  // ---- themes ----
  function parseIni(txt) {
    var out = {}, cur = null;
    txt.split(/\r?\n/).forEach(function (l) {
      l = l.replace(/[;#].*$/, '').trim();
      var s = /^\[(.+)\]$/.exec(l); if (s) { cur = s[1].trim(); out[cur] = {}; return; }
      var m = /^([a-z0-9-]+)\s*=\s*#?([0-9a-f]{6})/i.exec(l);
      if (m && cur) out[cur]['--spice-' + m[1]] = m[2];
    });
    return out;
  }
  function hexRgb(h) { return parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16); }
  function applyTheme() {
    var d = db(), el = document.getElementById('theme-css'), t = d.themes.filter(function (x) { return x.id === d.activeTheme; })[0];
    var f = FEATURED.filter(function (x) { return x.id === d.activeTheme; })[0];
    if (f) t = { ini: featuredIni(f), css: '' };
    // body.themed makes a theme clearly visible: firmer panels in its colours and its accent on key controls.
    document.body.classList.toggle('themed', !!t);
    if (!t) { el.textContent = ''; return; }
    var schemes = parseIni(t.ini || ''), name = d.scheme && schemes[d.scheme] ? d.scheme : Object.keys(schemes)[0], vars = schemes[name] || {};
    var css = ':root{' + Object.keys(vars).map(function (k) { return k + ':#' + vars[k] + ';' + k.replace('--spice-', '--spice-rgb-') + ':' + hexRgb(vars[k]); }).join(';') + '}';
    el.textContent = css;
  }
  // Downloads a theme's color.ini and returns its schemes ({ name: { --spice-x: hex } }) for previews.
  function themeSchemes(m) {
    if (!m.schemes) return Promise.resolve({});
    return text(abs(m.repo, m.branch, m.schemes)).then(function (ini) { m._ini = ini; return parseIni(ini); });
  }
  function installTheme(m, scheme) {
    return (m._ini ? Promise.resolve(m._ini) : m.schemes ? text(abs(m.repo, m.branch, m.schemes)) : Promise.resolve('')).then(function (ini) {
      if (!ini) throw new Error('This theme only changes Spotify desktop’s layout, so it can’t restyle TuneDeck');
      var d = db(), id = m.repo + '#' + m.name;
      d.themes = d.themes.filter(function (x) { return x.id !== id; });
      d.themes.push({ id: id, name: m.name, author: m.owner, preview: m.preview, ini: ini });
      d.activeTheme = id; d.scheme = scheme || null; save(d); applyTheme();
      return Object.keys(parseIni(ini));
    });
  }
  // ---- extensions ----
  // Parts of the Spicetify API this app provides (see shim below). Anything else an extension touches only
  // exists in Spotify desktop's interface, so that part of it does nothing here.
  var PROVIDED = ['Player', 'showNotification', 'Config', 'LocalStorage', 'Menu', 'Topbar', 'Playbar', 'URI', 'Platform', 'Mousetrap',
    'CosmosAsync', 'PopupModal', 'ContextMenu', 'Queue', 'Keyboard', 'SVGIcons', 'colorExtractor'];
  var DESKTOP = { React: 'its interface (React)', ReactDOM: 'its interface (React)', ReactComponent: 'Spotify’s interface parts', Panel: 'side panels',
    GraphQL: 'Spotify’s private data API', Locale: 'translations', ReactHook: 'its interface (React)', Tippy: 'tooltips', AppTitle: 'the window title' };
  // Which parts of the Spicetify API (and of Spicetify.Player / Spicetify.Platform) the code touches.
  function members(code, prefix) {
    var seen = {}, m, re = new RegExp(prefix + '\\??\\.\\s*([A-Za-z_$][\\w$]*)', 'g');
    while ((m = re.exec(code))) seen[m[1]] = 1;
    // const { Player, React } = Spicetify (but not "= Spicetify.Something")
    var d = new RegExp('\\{([^{}]{1,300})\\}\\s*=\\s*(?:window\\.)?' + prefix + '\\b(?!\\s*\\??\\.)', 'g');
    while ((m = d.exec(code))) m[1].split(',').forEach(function (p) { var k = p.split(':')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(k)) seen[k] = 1; });
    return Object.keys(seen);
  }
  function missing(code) {
    var out = [];
    function add(w) { if (out.indexOf(w) < 0) out.push(w); }
    members(code, 'Spicetify').forEach(function (k) { if (PROVIDED.indexOf(k) < 0) add(DESKTOP[k] || 'other Spotify desktop features'); });
    members(code, 'Spicetify\\.Platform').forEach(function (k) { if (k !== 'version' && k !== 'History') add('Spotify desktop’s internals'); });
    if (!window.Spicetify) shim();
    var P = Object.keys(window.Spicetify.Player);
    members(code, 'Spicetify\\.Player').forEach(function (k) { if (P.indexOf(k) < 0) add('some player controls'); });
    return out;
  }
  function compiles(code) { try { new Function('Spicetify', code); return true; } catch (e) { return !(e instanceof SyntaxError); } }

  // Babel is 3 MB, so it is loaded on first use and released a minute after the last conversion.
  var babel = null, babelFree = null;
  function loadBabel() {
    clearTimeout(babelFree);
    babelFree = setTimeout(function () { babel = null; try { delete window.Babel; } catch (e) { window.Babel = undefined; } }, 60000);
    if (babel) return babel;
    babel = new Promise(function (res, rej) {
      if (window.Babel) return res(window.Babel);
      var s = document.createElement('script'); s.src = 'js/vendor/babel.min.js';
      s.onload = function () { s.parentNode.removeChild(s); window.Babel ? res(window.Babel) : rej(new Error('The converter didn’t load')); };
      s.onerror = function () { babel = null; rej(new Error('The converter didn’t load')); };
      document.head.appendChild(s);
    });
    return babel;
  }
  // Code this TV can run: unchanged when it already parses, otherwise converted (to Chrome 51, a margin below
  // the TV's 53).
  function convert(code) {
    if (compiles(code)) return Promise.resolve(code);
    return loadBabel().then(function (B) {
      var out = B.transform(code, { presets: [['env', { targets: { chrome: '51' }, modules: false }]], sourceType: 'script', compact: true, comments: false }).code;
      if (!compiles(out)) throw new Error('still not runnable');
      return out;
    }).catch(function (e) { Log.add('convert fail', e.message); throw new Error('This extension couldn’t be converted for this TV (' + e.message.split('\n')[0].slice(0, 80) + ')'); });
  }
  // Downloads, converts and checks an extension before installing: { code, missing }.
  function checkExtension(m) {
    if (!m.main) return Promise.reject(new Error('This extension has no script'));
    if (m._check) return m._check;
    m._check = text(abs(m.repo, m.branch, m.main)).then(function (src) {
      return convert(src).then(function (code) { return { code: code, missing: missing(src) }; });
    });
    m._check.catch(function () { m._check = null; });
    return m._check;
  }
  function run(x) {
    try { new Function('Spicetify', x.code)(window.Spicetify); }
    catch (e) { console.error('extension', x.name, e); Log.add('extension', x.name, e.message); UI.toast(x.name + ' hit a problem: ' + e.message); }
  }
  function installExtension(m) {
    return checkExtension(m).then(function (r) {
      var d = db(), id = m.repo + '#' + m.name;
      d.extensions = d.extensions.filter(function (x) { return x.id !== id; });
      d.extensions.push({ id: id, name: m.name, author: m.owner, preview: m.preview, code: r.code, on: true, compatible: true, missing: r.missing });
      save(d);
      run(d.extensions[d.extensions.length - 1]);
      return r;
    });
  }
  function remove(kind, id) {
    var d = db(); d[kind] = d[kind].filter(function (x) { return x.id !== id; });
    if (kind === 'themes' && d.activeTheme === id) d.activeTheme = null;
    save(d); applyTheme();
  }
  function installed(m) {
    var d = db(), id = m.repo + '#' + m.name;
    return d.themes.some(function (x) { return x.id === id; }) || d.extensions.some(function (x) { return x.id === id; });
  }

  // ---- Spicetify-compatible API subset ----
  function shim() {
    var Player = {
      get data() { var t = Playback.state.track; return t && { item: { uri: t.uri, name: t.name, metadata: { title: t.name, artist_name: t.artist_names.join(', '), album_title: t.album_name, image_url: t.album_cover_url } }, track: { uri: t.uri, metadata: { title: t.name, artist_name: t.artist_names.join(', '), image_url: t.album_cover_url } }, isPaused: Playback.state.paused, duration: Playback.duration() }; },
      getProgress: Playback.position, getDuration: Playback.duration, getProgressPercent: function () { var d = Playback.duration(); return d ? Playback.position() / d : 0; },
      isPlaying: function () { return !!Playback.state.track && !Playback.state.paused; },
      togglePlay: Playback.toggle, play: Playback.resume, pause: Playback.pause, next: Playback.next, back: Playback.prev, seek: Playback.seek,
      setVolume: Playback.volume, getVolume: function () { return Playback.volume(); },
      getShuffle: function () { return Playback.state.shuffle; }, setShuffle: Playback.setShuffle, toggleShuffle: function () { Playback.setShuffle(!Playback.state.shuffle); },
      getHeart: function () { return Cat.isLiked(Playback.state.track); }, toggleHeart: function () { if (Playback.state.track) Cat.toggleLike(Playback.state.track); },
      getRepeat: function () { return ['off', 'all', 'track'].indexOf(Playback.state.repeat); }, setRepeat: function (n) { Playback.setRepeat(['off', 'all', 'track'][n] || 'off'); },
      toggleRepeat: function () { Player.setRepeat((Player.getRepeat() + 1) % 3); },
      skipBack: function (ms) { Playback.skipBy(-(ms || 15000)); }, skipForward: function (ms) { Playback.skipBy(ms || 15000); },
      getMute: function () { return Playback.volume() === 0; }, setMute: function (on) { if (on) { muted = Playback.volume(); Playback.volume(0); } else Playback.volume(muted || 0.8); },
      toggleMute: function () { Player.setMute(!Player.getMute()); },
      increaseVolume: function () { Playback.volume(Playback.volume() + 0.1); }, decreaseVolume: function () { Playback.volume(Playback.volume() - 0.1); },
      playUri: function (uri) { return /^spotify:(album|playlist|artist):/.test(uri) ? Playback.playContext({ uri: uri }) : Promise.reject(new Error('Not available in TuneDeck')); },
      formatTime: UI.fmt,
      addEventListener: function (type, fn) {
        if (type === 'songchange') Playback.on('track', function () { fn({ type: type, data: Player.data }); });
        else if (type === 'onplaypause') Playback.on('state', function () { fn({ type: type, data: Player.data }); });
        else if (type === 'onprogress') setInterval(function () { fn({ type: type, data: Playback.position() }); }, 1000);
      },
      removeEventListener: function () {}
    };
    window.Spicetify = {
      Player: Player, showNotification: function (m) { UI.toast(String(m)); },
      Config: { version: CFG.version, current_theme: (db().activeTheme || ''), color_scheme: db().scheme || '' },
      LocalStorage: { get: function (k) { return Store.get('sp.' + k, null); }, set: function (k, v) { Store.set('sp.' + k, v); }, remove: function (k) { Store.set('sp.' + k, null); } },
      Menu: { Item: function (label, active, onClick) { this.register = function () { menus.push({ label: label, onClick: onClick }); }; this.deregister = function () {}; }, SubMenu: function () { this.register = function () {}; } },
      Topbar: { Button: function (label, icon, onClick) { topbar.push({ label: label, onClick: onClick }); this.element = document.createElement('button'); } },
      URI: { fromString: function (s) { var p = String(s).split(':'); return { type: p[1], id: p[2], uri: s, toString: function () { return s; } }; } },
      Playbar: { Button: function (label, icon, onClick) { var b = { label: label, onClick: function () { onClick(b); } }; this.register = function () { topbar.push(b); }; this.deregister = function () {}; this.element = document.createElement('button'); } },
      ContextMenu: { Item: function (name, onClick) { this.register = function () { menus.push({ label: name, onClick: onClick }); }; this.deregister = function () {}; }, SubMenu: function () { this.register = function () {}; } },
      // Spotify Web API calls go through this app's sign-in; Spotify desktop's private endpoints don't exist here.
      CosmosAsync: (function () {
        function req(method) {
          return function (url, body) {
            var m = /^https:\/\/api\.spotify\.com\/v1(\/.*)$/.exec(url || '');
            if (!m || !SpotifyApi.linked()) return Promise.reject(new Error('Not available in TuneDeck: ' + url));
            return SpotifyApi.call(method, m[1], body == null ? null : body);
          };
        }
        return { get: req('GET'), post: req('POST'), put: req('PUT'), del: req('DELETE') };
      })(),
      PopupModal: {
        display: function (o) {
          o = o || {};
          var body = typeof o.content === 'string' ? o.content : '';
          var d = UI.dialog(o.title || '', body, [{ label: 'Close', back: true }]);
          if (o.content && o.content.nodeType) d.el.querySelector('.dbody').appendChild(o.content);
          modal = d;
        },
        hide: function () { if (modal) modal.close(); modal = null; }
      },
      Queue: { get nextTracks() { return Playback.queue().slice(Playback.index() + 1).map(function (t) { return { contextTrack: { uri: t.uri, metadata: { title: t.name } } }; }); } },
      Keyboard: { registerShortcut: function () {}, _deregisterShortcut: function () {} },
      SVGIcons: {},
      colorExtractor: function () { var c = getComputedStyle(document.getElementById('npv')).getPropertyValue('--accent-art').trim() || '#3d3360'; return Promise.resolve({ VIBRANT: c, PROMINENT: c, DESATURATED: c, LIGHT_VIBRANT: c, DARK_VIBRANT: c, VIBRANT_NON_ALARMING: c }); },
      Platform: { version: CFG.version, History: { push: function () {}, listen: function () {} } },
      Mousetrap: { bind: function () {} }, React: null, ReactDOM: null
    };
  }

  function boot() {
    var d = db();
    if (d.themes.some(function (t) { return t.css; }) || 'themeCss' in d) { d.themes.forEach(function (t) { delete t.css; }); delete d.themeCss; save(d); }
    shim(); applyTheme();
    db().extensions.forEach(function (x) { if (x.on && x.compatible) run(x); });
  }

  return {
    boot: boot, db: db, catalogue: catalogue, manifest: manifest, items: items, featured: function () { return FEATURED; },
    themeSchemes: themeSchemes, installTheme: installTheme, checkExtension: checkExtension, installExtension: installExtension, remove: remove, installed: installed,
    schemes: function (t) { return Object.keys(parseIni(t.ini || '')); }, parseIni: parseIni,
    setTheme: function (id, scheme) { var d = db(); d.activeTheme = id; d.scheme = scheme || null; save(d); applyTheme(); },
    setExtension: function (id, on) { var d = db(); d.extensions.forEach(function (x) { if (x.id === id) x.on = on && x.compatible; }); save(d); },
    topbar: function () { return topbar; }, menus: function () { return menus; }
  };
})();
