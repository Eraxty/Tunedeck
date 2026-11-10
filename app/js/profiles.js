// Local profiles ("Who's listening?"). Each profile has its own library, likes, history, Spotify link,
// theme and extensions; storage is namespaced by profile id (see Store).
var Profiles = (function () {
  var COLORS = ['#1ed760', '#f573a0', '#509bf5', '#ff6437', '#b49bc8', '#ffc864', '#2d46b9', '#e8115b'];
  var started = false, onReady = null;

  function all() { return Store.gget('profiles', []); }
  function current() { var id = Store.profile(); return all().filter(function (p) { return p.id === id; })[0] || { name: '?', color: COLORS[0] }; }

  function activate(p) {
    Store.use(p.id); Store.gset('lastProfile', p.id);
    if (!started) { started = true; onReady(); }
    else location.reload();
  }

  function create(done) {
    UI.askText('Who’s listening?', '', 'Next', function (name) {
      var list = all(), color = COLORS[list.length % COLORS.length];
      var p = { id: 'u' + Date.now().toString(36), name: name, color: color, created: Date.now() };
      list.push(p); Store.gset('profiles', list);
      done(p);
    });
  }

  function pick() {
    var list = all();
    var L = UI.layer('full profiles-screen', '<div class="prof-wrap"><div class="logo-big">' + Icon('music', 56) + ' TuneDeck</div><h1>Who’s listening?</h1><div class="prof-row"></div></div>', {
      onBack: function () { if (!started) pick(); }
    });
    var row = L.el.querySelector('.prof-row');
    list.forEach(function (p) {
      var b = UI.h('button', 'prof f' + (p.id === Store.profile() ? ' default' : ''), '<span class="pav" style="background:' + p.color + '">' + UI.esc(p.name.charAt(0).toUpperCase()) + '</span><span class="pname">' + UI.esc(p.name) + '</span>');
      b.onclick = function () { L.close(); activate(p); };
      row.appendChild(b);
    });
    if (list.length < 8) {
      var add = UI.h('button', 'prof add f' + (list.length ? '' : ' default'), '<span class="pav">' + Icon('plus', 64) + '</span><span class="pname">Add profile</span>');
      add.onclick = function () { L.close(); create(function (p) { activate(p); }); };
      row.appendChild(add);
    }
  }

  function remove(id) {
    Store.wipeProfile(id);
    Store.gset('profiles', all().filter(function (p) { return p.id !== id; }));
    Store.gset('lastProfile', null);
    location.reload();
  }
  function rename(name) {
    Store.gset('profiles', all().map(function (p) { if (p.id === Store.profile()) p.name = name; return p; }));
  }

  // Starts the app: reuses the last profile when there is only one, otherwise asks.
  function start(ready) {
    onReady = ready;
    var list = all(), last = Store.gget('lastProfile', null);
    if (list.length === 1) return activate(list[0]);
    if (list.length > 1 && last && list.some(function (p) { return p.id === last; }) && sessionStorage.getItem('picked')) {
      return activate(list.filter(function (p) { return p.id === last; })[0]);
    }
    try { sessionStorage.setItem('picked', '1'); } catch (e) {}
    pick();
  }

  return { all: all, current: current, pick: pick, start: start, remove: remove, rename: rename, create: create, started: function () { return started; } };
})();
