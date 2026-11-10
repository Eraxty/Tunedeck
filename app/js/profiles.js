// Local profiles ("Who's listening?"). Each profile has its own Spotify sign-in (or none, for free Audius
// music), library, likes, history, theme and extensions; storage is namespaced by profile id (see Store).
var Profiles = (function () {
  var COLORS = ['#1ed760', '#f573a0', '#509bf5', '#ff6437', '#b49bc8', '#ffc864', '#2d46b9', '#e8115b'];
  var started = false, onReady = null;

  function all() { return Store.gget('profiles', []); }
  function save(list) { Store.gset('profiles', list); }
  function current() { var id = Store.profile(); return all().filter(function (p) { return p.id === id; })[0] || { name: '?', color: COLORS[0] }; }
  function update(fn) { var id = Store.profile(); save(all().map(function (p) { if (p.id === id) fn(p); return p; })); }

  function activate(p) {
    Store.use(p.id); Store.gset('lastProfile', p.id);
    try { sessionStorage.setItem('picked', '1'); } catch (e) {}
    if (!started) { started = true; onReady(); } else location.reload();
  }
  function make(name) {
    var list = all(), p = { id: 'u' + Date.now().toString(36), name: name, color: COLORS[list.length % COLORS.length], created: Date.now() };
    list.push(p); save(list); return p;
  }

  // Both ways in: a Spotify sign-in (the profile takes the account's name and picture) or free music.
  // onCancel runs when the sign-in is abandoned.
  function signIn(onCancel) {
    var p = make('New profile');
    Store.use(p.id);
    Account.signIn(function (err) {
      if (err) { removeQuiet(p.id); return onCancel(); }
      activate(p);
    });
  }
  function free(onCancel) { UI.askText('What’s your name?', '', 'Next', function (name) { activate(make(name)); }, onCancel); }

  function add() {
    return UI.dialog('Add a profile', '<p class="dim">Sign in with Spotify to play your own music, playlists and Liked Songs (Spotify Premium). Or use TuneDeck with free music.</p>', [
      { label: 'Sign in with Spotify', onClick: function () { signIn(pick); } },
      { label: 'Continue without Spotify', onClick: function () { free(pick); } },
      { label: 'Cancel', back: true, onClick: pick }
    ]);
  }

  // First launch: straight to signing in with Spotify.
  function welcome() {
    var L = UI.layer('full profiles-screen', '<div class="prof-wrap welcome"><div class="logo-big">' + Icon('music', 52) + '<span>TuneDeck</span></div>' +
      '<h1>Your Spotify, made for the TV</h1><p class="dim lead">Sign in with your Spotify Premium account to play your music, playlists and Liked Songs here.</p>' +
      '<div class="wbtns"><button class="pill primary big f default w-sp">Sign in with Spotify</button><button class="pill f w-free">Use free music instead</button></div></div>', {
      onBack: function () { if (!started) welcome(); }
    });
    L.el.querySelector('.w-sp').onclick = function () { L.close(); signIn(welcome); };
    L.el.querySelector('.w-free').onclick = function () { L.close(); free(welcome); };
  }

  function pick() {
    var list = all();
    if (!list.length && !started) return welcome();
    var L = UI.layer('full profiles-screen', '<div class="prof-wrap"><div class="logo-big">' + Icon('music', 52) + '<span>TuneDeck</span></div><h1>Who’s listening?</h1><div class="prof-row"></div></div>', {
      onBack: function () { if (!started) pick(); }
    });
    var row = L.el.querySelector('.prof-row');
    list.forEach(function (p) {
      var b = UI.h('button', 'prof f' + (p.id === Store.profile() ? ' default' : ''), '<span class="pav" style="background-color:' + p.color + '"' + UI.bg(p.avatar) + '>' + (p.avatar ? '' : UI.esc(p.name.charAt(0).toUpperCase())) + '</span><span class="pname">' + UI.esc(p.name) + '</span>' +
        '<span class="ptag">' + (p.spotify ? 'Spotify' : 'Free') + '</span>');
      b.onclick = function () { L.close(); activate(p); };
      row.appendChild(b);
    });
    if (list.length < 8) {
      var a = UI.h('button', 'prof add f' + (list.length ? '' : ' default'), '<span class="pav">' + Icon('plus', 64) + '</span><span class="pname">Add profile</span>');
      a.onclick = function () { L.close(); add(); };
      row.appendChild(a);
    }
    UI.lazy(L.el);
  }

  function removeQuiet(id) { Store.wipeProfile(id); save(all().filter(function (p) { return p.id !== id; })); }
  function remove(id) { removeQuiet(id); Store.gset('lastProfile', null); try { sessionStorage.removeItem('picked'); } catch (e) {} location.reload(); }
  function rename(name) { update(function (p) { p.name = name; }); }
  // Takes the Spotify display name and picture for the profile (or clears the link on sign-out).
  function linkSpotify(me) {
    update(function (p) {
      p.spotify = !!me;
      if (me) { if (!p.name || p.name === 'New profile') p.name = me.name.split(' ')[0]; p.avatar = me.avatar || p.avatar; }
      else p.avatar = '';
    });
  }

  // Starts the app: reuses the last profile within a session or when there is only one, otherwise asks.
  function start(ready) {
    onReady = ready;
    var list = all(), last = Store.gget('lastProfile', null), picked = false;
    try { picked = !!sessionStorage.getItem('picked'); } catch (e) {}
    if (!list.length) return welcome();
    if (list.length === 1) return activate(list[0]);
    var lp = list.filter(function (p) { return p.id === last; })[0];
    if (lp && picked) return activate(lp);
    pick();
  }

  return { all: all, current: current, pick: pick, start: start, remove: remove, rename: rename, linkSpotify: linkSpotify, started: function () { return started; } };
})();
