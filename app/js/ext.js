// Themes and plugins, Spicetify-style. Themes are plain CSS (optionally with a color.ini that maps to
// --spice-* variables). Plugins are JS files run against a Spicetify-compatible API subset.
// Real Spicetify patches the desktop client's internals; this is a shim over our own UI, so extensions
// that reach into Spotify's React tree won't work, but ones using Player/Topbar/Menu/notifications will.
var Ext = (function () {
  var KEY = 'ext.v1';
  var db = { themes: [], plugins: [], activeTheme: null };
  var menus = [], topbar = [], pl = {};

  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
  function load() { try { var d = JSON.parse(localStorage.getItem(KEY)); if (d) db = d; } catch (e) {} }

  function parseIni(txt) {
    var vars = {};
    txt.split('\n').forEach(function (l) {
      var m = /^\s*([a-z0-9-]+)\s*=\s*#?([0-9a-f]{6})\s*$/i.exec(l);
      if (m) vars['--spice-' + m[1]] = '#' + m[2];
    });
    return vars;
  }

  function applyTheme() {
    var el = document.getElementById('theme-css'), t = null;
    db.themes.forEach(function (x) { if (x.id === db.activeTheme) t = x; });
    if (!t) { el.textContent = ''; return; }
    var vars = t.ini ? ':root{' + Object.keys(parseIni(t.ini)).map(function (k) { return k + ':' + parseIni(t.ini)[k]; }).join(';') + '}' : '';
    el.textContent = vars + t.css;
  }

  function fetchText(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); });
  }

  function runPlugin(p) {
    try { new Function('Spicetify', p.code)(window.Spicetify); }
    catch (e) { toast('Plugin ' + p.name + ' failed: ' + e.message); console.error(e); }
  }

  function installTheme(name, cssUrl, iniUrl) {
    return Promise.all([fetchText(cssUrl), iniUrl ? fetchText(iniUrl).catch(function () { return ''; }) : '']).then(function (r) {
      var t = { id: 't' + Date.now(), name: name, css: r[0], ini: r[1] };
      db.themes.push(t); db.activeTheme = t.id; save(); applyTheme(); return t;
    });
  }

  function installPlugin(name, url) {
    return fetchText(url).then(function (code) {
      var p = { id: 'p' + Date.now(), name: name, code: code, on: true };
      db.plugins.push(p); save(); runPlugin(p); return p;
    });
  }

  function remove(kind, id) {
    db[kind] = db[kind].filter(function (x) { return x.id !== id; });
    if (kind === 'themes' && db.activeTheme === id) { db.activeTheme = null; applyTheme(); }
    save();
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast.h); toast.h = setTimeout(function () { t.classList.add('hidden'); }, 2800);
  }

  // Spicetify-compatible subset
  var Player = {
    get data() { var t = Playback.state.track; return t && { track: { uri: t.uri, metadata: { title: t.name, artist_name: t.artist_names.join(', '), album_title: t.album_name, image_url: t.album_cover_url } }, isPaused: Playback.state.paused, duration: Playback.duration() }; },
    getProgress: Playback.position, getDuration: Playback.duration,
    isPlaying: function () { return !!Playback.state.track && !Playback.state.paused; },
    togglePlay: Playback.toggle, play: Playback.resume, pause: Playback.pause, next: Playback.next, back: Playback.prev,
    seek: Playback.seek, setVolume: Playback.volume, getVolume: function () { return Playback.volume(); },
    addEventListener: function (type, fn) {
      if (type === 'songchange') Playback.on('track', fn);
      else if (type === 'onplaypause') Playback.on('state', fn);
    }
  };

  function boot() {
    load();
    window.Spicetify = {
      Player: Player, showNotification: toast,
      Config: { version: CFG.version, current_theme: function () { return db.activeTheme; } },
      LocalStorage: { get: function (k) { return localStorage.getItem('sp.' + k); }, set: function (k, v) { localStorage.setItem('sp.' + k, v); }, remove: function (k) { localStorage.removeItem('sp.' + k); } },
      Menu: { Item: function (label, active, onClick) { var i = { label: label, onClick: onClick }; menus.push(i); this.register = function () {}; this.deregister = function () {}; } },
      Topbar: { Button: function (label, icon, onClick) { var b = { label: label, onClick: onClick }; topbar.push(b); this.element = b; } },
      URI: { fromString: function (s) { var p = s.split(':'); return { type: p[1], id: p[2], uri: s }; } },
      Platform: { version: CFG.version }
    };
    applyTheme();
    db.plugins.forEach(function (p) { if (p.on) runPlugin(p); });
  }

  return { boot: boot, db: function () { return db; }, installTheme: installTheme, installPlugin: installPlugin,
    remove: remove, setTheme: function (id) { db.activeTheme = id; save(); applyTheme(); },
    menus: function () { return menus; }, topbar: function () { return topbar; }, toast: toast };
})();
