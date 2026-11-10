// Marketplace: browses the Spicetify community catalogue (GitHub repos tagged spicetify-extensions /
// spicetify-themes, each with a manifest.json, same source the Spicetify Marketplace uses) and installs
// into the active profile. Themes apply their color.ini scheme through the --spice-* variables the whole
// app is styled with; a theme's user.css targets the desktop client, so it is optional.
// Extensions run against a Spicetify-compatible API subset; ones built for newer browsers than this TV's
// engine are detected at install and kept disabled.
var Ext = (function () {
  var topbar = [], menus = [];
  var GH = 'https://api.github.com/search/repositories?sort=stars&order=desc&per_page=60&q=topic:';
  var VARS = ['text', 'subtext', 'main', 'main-elevated', 'highlight', 'highlight-elevated', 'sidebar', 'player', 'card', 'shadow',
    'selected-row', 'button', 'button-active', 'button-disabled', 'tab-active', 'notification', 'notification-error', 'misc'];

  function db() { return Store.get('ext', { themes: [], extensions: [], activeTheme: null, scheme: null, themeCss: false }); }
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
    if (!t) { el.textContent = ''; return; }
    var schemes = parseIni(t.ini || ''), name = d.scheme && schemes[d.scheme] ? d.scheme : Object.keys(schemes)[0], vars = schemes[name] || {};
    var css = ':root{' + Object.keys(vars).map(function (k) { return k + ':#' + vars[k] + ';' + k.replace('--spice-', '--spice-rgb-') + ':' + hexRgb(vars[k]); }).join(';') + '}';
    el.textContent = css + (d.themeCss ? t.css : '');
  }
  function installTheme(m) {
    return Promise.all([m.usercss ? text(abs(m.repo, m.branch, m.usercss)) : Promise.resolve(''), m.schemes ? text(abs(m.repo, m.branch, m.schemes)) : Promise.resolve('')]).then(function (r) {
      if (!r[1]) throw new Error('This theme has no colour schemes to apply');
      var d = db(), id = m.repo + '#' + m.name;
      d.themes = d.themes.filter(function (x) { return x.id !== id; });
      d.themes.push({ id: id, name: m.name, author: m.owner, preview: m.preview, css: r[0], ini: r[1] });
      d.activeTheme = id; d.scheme = null; save(d); applyTheme();
      return Object.keys(parseIni(r[1]));
    });
  }

  // ---- extensions ----
  function compiles(code) { try { new Function('Spicetify', code); return true; } catch (e) { return !(e instanceof SyntaxError); } }
  function run(x) {
    try { new Function('Spicetify', x.code)(window.Spicetify); }
    catch (e) { console.error('extension', x.name, e); UI.toast(x.name + ' failed: ' + e.message); }
  }
  function installExtension(m) {
    if (!m.main) return Promise.reject(new Error('This extension has no script'));
    return text(abs(m.repo, m.branch, m.main)).then(function (code) {
      var ok = compiles(code), d = db(), id = m.repo + '#' + m.name;
      d.extensions = d.extensions.filter(function (x) { return x.id !== id; });
      d.extensions.push({ id: id, name: m.name, author: m.owner, preview: m.preview, code: code, on: ok, compatible: ok });
      save(d);
      if (ok) run(d.extensions[d.extensions.length - 1]);
      return ok;
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
      getHeart: function () { return Library.isLiked(Playback.state.track); }, toggleHeart: function () { if (Playback.state.track) Library.toggleLike(Playback.state.track); },
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
      Platform: { version: CFG.version, History: { push: function () {}, listen: function () {} } },
      Mousetrap: { bind: function () {} }, React: null, ReactDOM: null
    };
  }

  function boot() {
    shim(); applyTheme();
    db().extensions.forEach(function (x) { if (x.on && x.compatible) run(x); });
  }

  return {
    boot: boot, db: db, catalogue: catalogue, manifest: manifest, installTheme: installTheme, installExtension: installExtension, remove: remove, installed: installed,
    schemes: function (t) { return Object.keys(parseIni(t.ini || '')); },
    setTheme: function (id, scheme) { var d = db(); d.activeTheme = id; d.scheme = scheme || null; save(d); applyTheme(); },
    setThemeCss: function (on) { var d = db(); d.themeCss = on; save(d); applyTheme(); },
    setExtension: function (id, on) { var d = db(); d.extensions.forEach(function (x) { if (x.id === id) x.on = on && x.compatible; }); save(d); },
    topbar: function () { return topbar; }, menus: function () { return menus; }
  };
})();
