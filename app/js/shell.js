// Persistent chrome, laid out like Spotify desktop with a Spicetify glass theme: blurred-art backdrop, top bar
// (now playing, home, search pill, account), Your Library panel, main view, Now Playing view, player bar.
// Also the full-screen player (cover / lyrics, each toggleable), dialogs, toasts and the router.
var UI = (function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var els = {}, history = [], views = {}, current = null, npvOpen = true, libFilter = 'all';
  var lyr = { lines: [], idx: -2, req: 0, result: null };

  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(ms) { var s = Math.floor((ms || 0) / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function ago(t) { if (!t) return 'never'; var m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; }
  function count(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); }

  // ---------- images: lazy, over a music-note fallback ----------
  function artCss(url) { return url ? 'url("' + url + '"), url("assets/note.svg")' : ''; }
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { var el = e.target; el.style.backgroundImage = artCss(el.getAttribute('data-bg')); el.removeAttribute('data-bg'); io.unobserve(el); } });
  }, { rootMargin: '700px' }) : null;
  function lazy(scope) {
    $$('[data-bg]', scope).forEach(function (el) {
      if (io) io.observe(el); else { el.style.backgroundImage = artCss(el.getAttribute('data-bg')); el.removeAttribute('data-bg'); }
    });
  }
  function bg(url) { return url ? ' data-bg="' + esc(url) + '"' : ''; }
  function setArt(el, url) { if (el) el.style.backgroundImage = artCss(url); }

  // ---------- building blocks ----------
  function itemSub(it) {
    if (it.sub) return it.sub;
    if (it.kind === 'artist') return 'Artist';
    if (it.kind === 'album') return (it.type === 'single' ? 'Single' : 'Album') + (it.year ? ' · ' + it.year : '') + ' · ' + it.owner;
    if (it.kind === 'playlist') return 'Playlist · ' + it.owner;
    return it.artist_names ? it.artist_names.join(', ') : '';
  }
  function cover(it) { return it.kind === 'artist' ? it.avatar : (it.cover || it.album_cover_url); }
  function open(it, list, i, ctx) {
    if (it.kind === 'artist') return go('artist', it.id);
    if (it.kind === 'album' || it.kind === 'playlist') return go('collection', { kind: it.kind, id: it.id });
    if (it.kind === 'mine') return go(it.view, it.arg);
    Playback.play(list, i, ctx);
  }
  function card(it, onClick) {
    var c = h('button', 'card f' + (it.kind === 'artist' ? ' artist' : ''));
    c.innerHTML = '<div class="art' + (it.liked ? ' liked-cover' : '') + '"' + bg(cover(it)) + '>' + (it.liked ? Icon('heartFill', 72) : '') + '</div>' +
      '<div class="t">' + esc(it.name) + '</div><div class="s">' + esc(itemSub(it)) + '</div>' +
      '<div class="play-badge">' + Icon('play', 28) + '</div>';
    c.onclick = onClick; return c;
  }
  function tile(it, onClick) {
    var t = h('button', 'tile f');
    t.innerHTML = '<div class="tart' + (it.liked ? ' liked-cover' : '') + '"' + bg(cover(it)) + '>' + (it.liked ? Icon('heartFill', 34) : '') + '</div><div class="tname">' + esc(it.name) + '</div>';
    t.onclick = onClick; return t;
  }
  // A titled horizontal row of cards. items may be a promise (shows placeholders until it lands).
  function shelf(parent, title, items, opts) {
    opts = opts || {};
    var s = h('section', 'shelf');
    s.innerHTML = '<div class="shelf-head">' + (opts.over ? '<div class="over">' + esc(opts.over) + '</div>' : '') + '<h2>' + esc(title) + '</h2></div><div class="hs"><div class="in"></div></div>';
    parent.appendChild(s);
    var row = $('.in', s);
    function fill(list) {
      row.innerHTML = '';
      if (!list || !list.length) { if (opts.empty) row.appendChild(h('p', 'dim pad', esc(opts.empty))); else if (s.parentNode) s.parentNode.removeChild(s); return; }
      list.forEach(function (it, i) { row.appendChild(card(it, function () { open(it, list, i, opts.ctx); })); });
      if (opts.more) { var m = h('button', 'card more f', '<div class="art">' + Icon('plus', 48) + '</div><div class="t">Show all</div>'); m.onclick = opts.more; row.appendChild(m); }
      lazy(row);
    }
    if (items && items.then) {
      for (var i = 0; i < 6; i++) row.appendChild(h('div', 'card ghost', '<div class="art"></div><div class="t"></div>'));
      items.then(fill, function (e) { row.innerHTML = ''; row.appendChild(h('p', 'dim pad', esc(e.message))); });
    } else fill(items);
    return s;
  }
  // Track rows rendered a page at a time; focusing the last rendered row appends the next page.
  function trackList(parent, tracks, opts) {
    opts = opts || {};
    var noAlbum = !opts.col && tracks.every(function (t) { return !t.album_name; });
    var list = h('div', 'tracks' + (opts.compact ? ' compact' : '') + (noAlbum || opts.noAlbum ? ' no-al' : '')), shown = 0, PAGE = 60;
    list.innerHTML = '<div class="th"><span class="i">#</span><span class="n">Title</span><span class="al">' + (opts.albumCol || 'Album') + '</span><span class="len">' + Icon('clock', 22) + '</span></div>';
    parent.appendChild(list);
    function more() {
      var end = Math.min(tracks.length, shown + PAGE), page = tracks.slice(shown, end);
      for (var i = shown; i < end; i++) list.appendChild(row(tracks[i], i, end));
      shown = end; lazy(list); markPlaying();
      if (!opts.noLike) Cat.checkLikedMany(page).then(function () { page.forEach(function (t) { if (t._paint) t._paint(Cat.isLiked(t)); }); });
    }
    function row(t, i, end) {
      var r = h('div', 'trow' + (t.missing ? ' missing' : ''));
      var b = h('button', 'tmain f');
      b.innerHTML = '<span class="i"><span class="num">' + (i + 1) + '</span><span class="eq">' + Icon('play', 20) + '</span></span>' + (opts.noCover ? '' : '<span class="tc"' + bg(t.cover_small || t.album_cover_url) + '></span>') +
        '<span class="n"><span class="tt">' + esc(t.name) + (t.explicit ? ' <span class="ex">E</span>' : '') + '</span><span class="ta">' + esc((t.artist_names || []).join(', ')) + '</span></span>' +
        '<span class="al">' + esc(opts.col ? opts.col(t) : (t.album_name || '')) + '</span><span class="len">' + fmt(t.duration) + '</span>';
      b.setAttribute('data-uri', t.uri || '');
      b.onclick = function () { opts.onPick(i); };
      if (i === end - 1 && end < tracks.length) b._more = true;
      r.appendChild(b);
      if (t.src && !opts.noLike) {
        var like = h('button', 'ico-btn f like-' + i), add = h('button', 'ico-btn f', Icon('plus', 26));
        function paint(on) { like.classList.toggle('on', on); like.innerHTML = Icon(on ? 'heartFill' : 'heart', 26); }
        paint(Cat.isLiked(t)); t._paint = paint;
        like.onclick = function () {
          var on = !like.classList.contains('on'); paint(on);
          Cat.toggleLike(t).then(function () { toast(on ? 'Added to Liked Songs' : 'Removed from Liked Songs'); syncLikeIcons(); }, function (e) { paint(!on); toast(e.message); });
        };
        add.onclick = function () { addToPlaylist(t); };
        r.appendChild(like); r.appendChild(add);
      }
      t._row = r;
      return r;
    }
    list.more = function (el) { if (el._more) { el._more = false; more(); } };
    list.mark = function (i, missing) { var t = tracks[i]; if (t && t._row) t._row.classList.toggle('missing', missing); };
    more();
    return list;
  }
  function markPlaying() {
    var u = Playback.state.track && Playback.state.track.uri;
    $$('.tmain').forEach(function (b) { b.classList.toggle('playing', !!u && b.getAttribute('data-uri') === u); });
  }
  function pageHeader(parent, o) {
    var hd = h('header', 'phead' + (o.round ? ' round' : ''));
    hd.innerHTML = '<div class="pcover' + (o.liked ? ' liked-cover' : '') + '"' + bg(o.cover) + '>' + (o.liked ? Icon('heartFill', 120) : '') + '</div>' +
      '<div class="pmeta"><div class="over">' + esc(o.over) + '</div><h1 class="ptitle">' + esc(o.title) + '</h1>' +
      (o.desc ? '<p class="pdesc">' + esc(o.desc) + '</p>' : '') + '<div class="psub">' + o.sub + '</div><div class="pactions"></div></div>';
    parent.appendChild(hd); lazy(hd);
    if (o.cover && o.tint !== false) tintFrom(o.cover, hd);
    return $('.pactions', hd);
  }
  function actionBtn(parent, icon, label, onClick, cls) {
    var b = h('button', 'abtn f ' + (cls || ''), Icon(icon, cls && cls.indexOf('primary') >= 0 ? 40 : 30) + (label ? '<span>' + esc(label) + '</span>' : ''));
    b.onclick = onClick; parent.appendChild(b); return b;
  }

  // ---------- router ----------
  var TOP = ['home', 'search', 'library', 'market', 'settings', 'queue'];
  function go(id, arg, noPush) {
    if (!views[id]) id = 'home';
    if (!noPush) {
      // Main sections sit directly on top of Home, so Back from any of them goes Home.
      if (TOP.indexOf(id) >= 0) history = id === 'home' ? [['home', arg]] : [['home', null], [id, arg]];
      else history.push([id, arg]);
      if (history.length > 40) history.splice(1, 1);
    }
    if (current) document.body.classList.remove('page-' + current);
    current = id; document.body.classList.add('page-' + id);
    if (els.npv) syncNpv();
    $$('.topnav').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-id') === id); });
    var vs = els.view, root = vs.firstElementChild;
    if (root._cleanup) root._cleanup();
    root._cleanup = null; root.innerHTML = ''; Focus.resetScroll(vs);
    els.main.style.removeProperty('--tint');
    views[id](root, arg);
    lazy(vs);
    setTimeout(function () { if (!Focus.inLayer()) Focus.first(vs); }, 0);
  }
  function back() {
    if (history.length > 1) { history.pop(); var p = history[history.length - 1]; go(p[0], p[1], true); return; }
    if (current !== 'home') return go('home');
    confirmExit();
  }
  function refresh() { var p = history[history.length - 1]; if (p) go(p[0], p[1], true); }

  // ---------- layers & dialogs ----------
  function layer(cls, html, opts) {
    opts = opts || {};
    var el = h('div', 'layer ' + cls, html);
    document.body.appendChild(el);
    var pop = Focus.push({ el: el, back: function () { close(); if (opts.onBack) opts.onBack(); }, key: opts.key });
    function close() { if (!el.parentNode) return; pop(); el.parentNode.removeChild(el); if (opts.onClose) opts.onClose(); }
    lazy(el);
    setTimeout(function () { Focus.first(el); }, 0);
    return { el: el, close: close };
  }
  function dialog(title, body, buttons) {
    var d = layer('dialog-layer', '<div class="dialog"><h2>' + esc(title) + '</h2><div class="dbody">' + (body || '') + '</div><div class="dbtns"></div></div>');
    (buttons || []).forEach(function (b, i) {
      var e = h('button', 'pill f' + (i === 0 ? ' primary default' : ''), esc(b.label));
      e.onclick = function () { if (b.keep !== true) d.close(); if (b.onClick) b.onClick(d); };
      $('.dbtns', d.el).appendChild(e);
    });
    return d;
  }
  function confirmExit() { dialog('Leave TuneDeck?', '<p class="dim">Music stops when you leave.</p>', [{ label: 'Stay' }, { label: 'Exit', onClick: function () { window.close(); } }]); }
  function qr(text, size) {
    var q = qrcode(0, 'M'); q.addData(text); q.make();
    return '<div class="qr">' + q.createSvgTag({ cellSize: Math.max(4, Math.floor((size || 300) / (q.getModuleCount() + 4))), margin: 2, scalable: false }) + '</div>';
  }
  function addToPlaylist(t) {
    var d = layer('dialog-layer', '<div class="dialog"><h2>Add to playlist</h2><div class="dlist vs"><div class="in"></div></div></div>');
    var list = $('.dlist .in', d.el);
    var nb = h('button', 'drow f default', '<span class="dcov new">' + Icon('plus', 30) + '</span><span>New playlist</span>');
    nb.onclick = function () { d.close(); askText('Name your playlist', 'My playlist', 'Create', function (name) { Lib.createPlaylist(name, t).then(function () { toast('Added to ' + name); buildLibrary(); }, function (e) { toast(e.message); }); }); };
    list.appendChild(nb);
    Lib.editablePlaylists().then(function (pls) {
      pls.forEach(function (p) {
        var b = h('button', 'drow f', '<span class="dcov"' + bg(p.cover) + '></span><span>' + esc(p.name) + '</span>');
        b.onclick = function () { d.close(); Lib.addToPlaylist(p, t).then(function () { toast('Added to ' + p.name); }, function (e) { toast(e.message); }); };
        list.appendChild(b);
      });
      lazy(list);
    });
  }
  function askText(title, value, doneLabel, onDone) {
    var d = layer('dialog-layer', '<div class="dialog wide"><h2>' + esc(title) + '</h2><div class="kbd-field"></div><div class="kbd-host"></div></div>');
    var field = $('.kbd-field', d.el); field.textContent = value || '';
    var kb = Keyboard.create({ value: value || '', onChange: function (v) { field.textContent = v; }, onDone: function (v) { if (!v.trim()) return toast('Type a name first'); d.close(); onDone(v.trim()); }, doneLabel: doneLabel });
    $('.kbd-host', d.el).appendChild(kb);
    setTimeout(function () { Focus.first(kb); }, 0);
  }

  var toastT;
  function toast(msg) {
    els.toast = els.toast || $('#toast');
    els.toast.textContent = msg; els.toast.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { els.toast.classList.remove('show'); }, 3000);
  }

  // ---------- top bar ----------
  function buildTop() {
    var t = els.top, prof = Profiles.current();
    t.innerHTML = '<button class="tnow f"><span class="tnc"></span><span class="tnm"><span class="tnt">TuneDeck</span><span class="tna">Nothing playing</span></span></button>' +
      '<div class="tcenter"><button class="hbtn topnav f" data-id="home">' + Icon('home', 30) + '</button>' +
      '<button class="spill topnav f" data-id="search">' + Icon('search', 28) + '<span>What do you want to play?</span></button></div>' +
      '<div class="tright"><button class="tico topnav f" data-id="market">' + Icon('store', 28) + '<span class="tip">Marketplace</span></button>' +
      '<button class="tico topnav f" data-id="settings">' + Icon('settings', 28) + '<span class="tip">Settings</span></button>' +
      '<button class="tav f"><span class="av" style="background:' + prof.color + '"' + bg(prof.avatar) + '>' + (prof.avatar ? '' : esc(prof.name.charAt(0).toUpperCase())) + '</span><span class="tip">' + esc(prof.name) + ' · switch</span></button></div>';
    $$('.topnav', t).forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-id')); }; });
    $('.tav', t).onclick = function () { Profiles.pick(); };
    $('.tnow', t).onclick = openPlayer;
    lazy(t);
  }

  // ---------- Your Library panel ----------
  function buildLibrary() {
    var p = els.lib;
    p.innerHTML = '<div class="lib-top"><h2>Your Library</h2><button class="ico-btn f lib-new">' + Icon('plus', 28) + '</button></div><div class="lchips"></div><div class="llist vs"><div class="in"></div></div>';
    $('.lib-new', p).onclick = function () { askText('Name your playlist', 'My playlist', 'Create', function (n) { Lib.createPlaylist(n).then(function () { toast('Created ' + n); buildLibrary(); }, function (e) { toast(e.message); }); }); };
    var chips = $('.lchips', p);
    [['all', 'All'], ['playlists', 'Playlists'], ['albums', 'Albums'], ['artists', 'Artists']].forEach(function (c) {
      var b = h('button', 'chip small f' + (libFilter === c[0] ? ' on' : ''), c[1]);
      b.onclick = function () { libFilter = c[0]; buildLibrary(); setTimeout(function () { Focus.set($('.lchips .on', els.lib)); }, 0); };
      chips.appendChild(b);
    });
    var list = $('.llist .in', p);
    Lib.libraryItems(libFilter).then(function (items) {
      list.innerHTML = '';
      items.forEach(function (it) {
        var r = h('button', 'lrow f' + (it.kind === 'artist' ? ' round' : ''), '<span class="lc' + (it.liked ? ' liked-cover' : '') + '"' + bg(cover(it)) + '>' + (it.liked ? Icon('heartFill', 26) : '') + '</span><span class="lm"><span class="lt">' + esc(it.name) + '</span><span class="ls">' + esc(it.libSub || itemSub(it)) + '</span></span>');
        r.onclick = function () { open(it); };
        list.appendChild(r);
      });
      if (!items.length) list.appendChild(h('p', 'dim small pad', 'Nothing here yet.'));
      lazy(list);
    }, function (e) { list.innerHTML = '<p class="dim small pad">' + esc(e.message) + '</p>'; });
  }

  // ---------- player bar ----------
  function seekKeys(el) {
    el._key = function (k) {
      if (k === 'left') { Playback.skipBy(-10000); return true; }
      if (k === 'right') { Playback.skipBy(10000); return true; }
      if (k === 'enter') { Playback.toggle(); return true; }
      return false;
    };
  }
  function ctlBtn(parent, icon, fn, cls, size) { var e = h('button', 'ico-btn f ' + (cls || ''), Icon(icon, size || 28)); e.onclick = fn; parent.appendChild(e); return e; }
  function controls(parent, big) {
    var s = big ? 40 : 28;
    ctlBtn(parent, 'shuffle', function () { Playback.setShuffle(!Playback.state.shuffle); toast(Playback.state.shuffle ? 'Shuffle on' : 'Shuffle off'); }, 'c-shuffle', s);
    ctlBtn(parent, 'prev', Playback.prev, '', s);
    ctlBtn(parent, 'play', Playback.toggle, 'c-play' + (big ? ' big default' : ''), big ? 48 : 32);
    ctlBtn(parent, 'next', Playback.next, '', s);
    ctlBtn(parent, 'repeat', cycleRepeat, 'c-repeat', s);
  }
  function seekRow(parent) {
    var r = h('div', 'seek', '<span class="cur">0:00</span><button class="seekbar f"><span class="sbar"><span class="sfill"></span></span><span class="shint">Left / right: 10s</span></button><span class="dur">0:00</span>');
    parent.appendChild(r); seekKeys($('.seekbar', r)); return r;
  }
  function buildBar() {
    var b = els.bar;
    b.innerHTML = '<div class="bleft"><button class="bnow f"><span class="bcover"></span><span class="bmeta"><span class="btitle">Nothing playing</span><span class="bartist">Pick something to play</span></span></button>' +
      '<button class="ico-btn f c-like">' + Icon('heart', 28) + '</button></div><div class="bcenter"><div class="bctl"></div></div><div class="bright"></div>';
    controls($('.bctl', b), false);
    seekRow($('.bcenter', b));
    var right = $('.bright', b);
    ctlBtn(right, 'lyrics', function () { openPlayer('lyrics'); }, 'tipb').setAttribute('data-tip', 'Lyrics');
    ctlBtn(right, 'queue', function () { go('queue'); });
    els.npvBtn = ctlBtn(right, 'panel', function () { setNpv(!npvOpen); });
    ctlBtn(right, 'expand', function () { openPlayer(); });
    Ext.topbar().forEach(function (t) { ctlBtn(right, 'star', t.onClick); });
    $('.bnow', b).onclick = function () { openPlayer(); };
    $('.c-like', b).onclick = likeCurrent;
  }
  function cycleRepeat() {
    var order = ['off', 'all', 'track'], n = order[(order.indexOf(Playback.state.repeat) + 1) % 3];
    Playback.setRepeat(n); toast(n === 'off' ? 'Repeat off' : n === 'all' ? 'Repeat all' : 'Repeat this song');
  }
  function likeCurrent() {
    var t = Playback.state.track; if (!t) return;
    var on = !Cat.isLiked(t);
    paintLikes(on);
    Cat.toggleLike(t).then(function () { toast(on ? 'Added to Liked Songs' : 'Removed from Liked Songs'); }, function (e) { paintLikes(!on); toast(e.message); });
  }
  function paintLikes(on) { $$('.c-like').forEach(function (e) { e.classList.toggle('on', on); e.innerHTML = Icon(on ? 'heartFill' : 'heart', e.classList.contains('big') ? 40 : 28); }); }
  function syncLikeIcons() { paintLikes(Cat.isLiked(Playback.state.track)); }

  function onState(s) {
    $$('.c-play').forEach(function (e) { e.innerHTML = Icon(s.paused ? 'play' : 'pause', e.classList.contains('big') ? 48 : 32); });
    $$('.c-shuffle').forEach(function (e) { e.classList.toggle('on', s.shuffle); });
    $$('.c-repeat').forEach(function (e) { e.classList.toggle('on', s.repeat !== 'off'); e.classList.toggle('one', s.repeat === 'track'); });
    document.body.classList.toggle('buffering', !!s.buffering && !s.paused);
  }
  function onTrack(t) {
    $('.btitle').textContent = t ? t.name : 'Nothing playing';
    $('.bartist').textContent = t ? t.artist_names.join(', ') : 'Pick something to play';
    setArt($('.bcover'), t && (t.cover_small || t.album_cover_url));
    $('.tnt', els.top).textContent = t ? t.name : 'TuneDeck';
    $('.tna', els.top).textContent = t ? t.artist_names.join(', ') : 'Nothing playing';
    setArt($('.tnc', els.top), t && (t.cover_small || t.album_cover_url));
    setBackground(t);
    syncLikeIcons();
    if (t) Cat.checkLiked(t).then(function () { if (Playback.state.track === t) syncLikeIcons(); });
    fillNpv(t);
    if (els.player) fillPlayer();
    loadLyrics(t);
    markPlaying();
    syncNpv();
  }

  // Backdrop: the smallest cover scaled up is naturally blurred, so no CSS filter is needed on this GPU.
  var bgFlip = 0;
  function setBackground(t) {
    var layers = $$('#bg .bgimg'), next = layers[bgFlip ^ 1], prev = layers[bgFlip], url = t && (t.cover_small || t.album_cover_url);
    if (!url) { prev.style.opacity = 0; next.style.opacity = 0; return; }
    var img = new Image();
    img.onload = function () { next.style.backgroundImage = 'url("' + url + '")'; next.style.opacity = 1; prev.style.opacity = 0; bgFlip ^= 1; };
    img.src = url;
    tintFrom(url, document.documentElement, '--accent-art');
  }
  // Dominant colour of an image (needs CORS). Used for the lyrics card, the player and page header tints.
  function tintFrom(url, el, prop) {
    var img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var c = document.createElement('canvas'); c.width = c.height = 12; var x = c.getContext('2d'); x.drawImage(img, 0, 0, 12, 12);
        var d = x.getImageData(0, 0, 12, 12).data, r = 0, g = 0, b = 0, n = 0;
        for (var i = 0; i < d.length; i += 4) { var mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx - mn > 28) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } }
        if (!n) for (i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        r /= n; g /= n; b /= n;
        var l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2, k = l > 105 ? 105 / l : l < 50 ? 60 / Math.max(l, 1) : 1;
        var col = 'rgb(' + Math.round(r * k) + ',' + Math.round(g * k) + ',' + Math.round(b * k) + ')';
        if (prop) el.style.setProperty(prop, col); else { el.style.setProperty('--tint', col); els.main.style.setProperty('--tint', col); }
      } catch (e) {}
    };
    img.src = url;
  }

  // ---------- Now Playing view (right panel) ----------
  function setNpv(on) { npvOpen = on; syncNpv(); els.npvBtn.classList.toggle('on', on); }
  // The panel fades out rather than leaving the page, so mark it hidden for the remote too.
  function syncNpv() {
    var shown = npvOpen && !!Playback.state.track;
    document.body.classList.toggle('npv', shown);
    els.npv.setAttribute('aria-hidden', shown && current !== 'search' ? 'false' : 'true');
    if (!shown && Focus.current && els.npv.contains(Focus.current)) Focus.first(els.view);
  }
  function fillNpv(t) {
    var p = els.npv;
    if (!t) { p.innerHTML = ''; return; }
    var ctx = Playback.context();
    p.innerHTML = '<div class="vs npv-scroll"><div class="in">' +
      '<div class="npv-head"><span>' + esc(ctx && ctx.name ? ctx.name : 'Now playing') + '</span><button class="ico-btn f npv-close">' + Icon('close', 26) + '</button></div>' +
      '<button class="npv-art f"' + bg(t.cover_big || t.album_cover_url) + '></button>' +
      '<div class="npv-row"><div class="npv-meta"><div class="npv-title">' + esc(t.name) + '</div><div class="npv-artist">' + esc(t.artist_names.join(', ')) + '</div></div>' +
      '<button class="ico-btn f c-like">' + Icon('heart', 28) + '</button><button class="ico-btn f npv-add">' + Icon('plus', 28) + '</button></div>' +
      '<button class="npv-card lyr-card f"><div class="card-head"><span>Lyrics</span><span class="card-act">Show</span></div><div class="lyr-mini"><p class="lm-msg">Looking for lyrics…</p></div></button>' +
      '<div class="npv-card next-card"><div class="card-head"><span>Next in queue</span></div><div class="next-body"></div></div>' +
      '<button class="npv-card about f"><div class="card-head"><span>About the artist</span></div><div class="about-body"><div class="about-name">' + esc(t.artist_names[0]) + '</div></div></button>' +
      '</div></div>';
    lazy(p);
    $('.npv-close', p).onclick = function () { setNpv(false); };
    $('.npv-art', p).onclick = function () { openPlayer(); };
    $('.c-like', p).onclick = likeCurrent;
    $('.npv-add', p).onclick = function () { addToPlaylist(t); };
    $('.lyr-card', p).onclick = function () { openPlayer('lyrics'); };
    $('.about', p).onclick = function () { if (t.artist_id) go('artist', t.artist_id); };
    syncLikeIcons(); fillNext(); renderMiniLyrics();
    if (t.artist_id) Cat.artistInfo(t.artist_id).then(function (a) {
      if (Playback.state.track !== t) return;
      $('.about-body', p).innerHTML = '<div class="about-img"' + bg(a.avatar_big || a.avatar) + '></div><div class="about-name">' + esc(a.name) + '</div>' +
        '<div class="dim small">' + (a.genres && a.genres.length ? esc(a.genres.slice(0, 3).join(' · ')) : a.followers ? count(a.followers) + ' followers' : 'Artist') + '</div>';
      lazy(p);
    }, function () {});
  }
  function fillNext() {
    var nb = $('.next-body', els.npv); if (!nb) return;
    var q = Playback.queue(), n = q[Playback.index() + 1];
    nb.innerHTML = n ? '<div class="next-item"><span class="tc"' + bg(n.cover_small || n.album_cover_url) + '></span><span class="nm"><span class="tt">' + esc(n.name) + '</span><span class="ta">' + esc(n.artist_names.join(', ')) + '</span></span></div>' : '<p class="dim small">Nothing up next</p>';
    lazy(nb);
  }

  // ---------- lyrics ----------
  function loadLyrics(t) {
    lyr.lines = []; lyr.idx = -2; lyr.result = null;
    var req = ++lyr.req;
    renderMiniLyrics(); if (els.player) renderPlayerLyrics();
    if (!t) return;
    var o = t.orig;
    var meta = o ? { uri: t.uri, name: o.name, artist_names: [o.artist.split(',')[0]], album_name: o.album, duration: t.duration } : t;
    Lyrics.load(meta).then(function (r) {
      if (req !== lyr.req) return;
      lyr.lines = r.lines; lyr.result = r;
      renderMiniLyrics(); if (els.player) renderPlayerLyrics();
    });
  }
  function renderMiniLyrics() {
    var mini = $('.lyr-mini', els.npv); if (!mini) return;
    var r = lyr.result;
    mini.innerHTML = !Playback.state.track ? '' : !r ? '<p class="lm-msg">Looking for lyrics…</p>' : r.synced ? '<div class="lm prev"></div><div class="lm cur">• • •</div><div class="lm nxt"></div>' :
      '<p class="lm-msg">' + (r.plain ? 'Lyrics aren’t synced for this song. Open to read them.' : 'No lyrics found for this song.') + '</p>';
    lyr.idx = -2;
  }
  function lyricTick(p) {
    if (!lyr.lines.length) return;
    var t = Playback.state.track, i = Lyrics.indexAt(lyr.lines, p + Lyrics.offset(t.uri) + 150);
    if (i === lyr.idx) return;
    lyr.idx = i;
    var mini = $('.lyr-mini', els.npv);
    if (mini && $('.cur', mini)) {
      $('.prev', mini).textContent = i > 0 ? lyr.lines[i - 1].text : '';
      $('.cur', mini).textContent = i >= 0 ? (lyr.lines[i].text || '• • •') : '• • •';
      $('.nxt', mini).textContent = lyr.lines[i + 1] ? lyr.lines[i + 1].text : '';
    }
    var box = els.player && $('.pl-lines', els.player);
    if (box && box.children.length === lyr.lines.length) {
      var old = $('.ln.on', box); if (old) old.classList.remove('on');
      for (var n = 0; n < box.children.length; n++) box.children[n].classList.toggle('past', n < i);
      var now = box.children[i], view = box.parentNode;
      if (now) now.classList.add('on');
      var y = now ? Math.round(view.clientHeight * 0.38 - now.offsetTop) : Math.round(view.clientHeight * 0.38);
      box.style.transform = 'translate3d(0,' + y + 'px,0)';
    }
  }

  // ---------- full-screen player: cover and lyrics, each toggleable ----------
  function prefs() { var p = Store.get('player', null) || {}; return { cover: p.cover !== false, lyrics: p.lyrics !== false, info: p.info !== false, dark: !!p.dark }; }
  function openPlayer(mode) {
    if (!Playback.state.track) return toast('Play something first');
    if (mode === 'lyrics') { var p = prefs(); if (!p.lyrics) { p.lyrics = true; Store.set('player', p); } }
    if (els.player) { applyPlayerMode(); return; }
    var L = layer('full player', '<div class="pl-bg"></div><div class="pl-shade"></div>' +
      '<div class="pl-top"><button class="pill f pl-back">' + Icon('back', 28) + '<span>Back</span></button><div class="pl-from"></div><div class="pl-now"><span class="pn-c"></span><span><b class="pn-t"></b><span class="pn-a"></span></span></div>' +
      '<div class="pl-toggles"><button class="tog f t-cover">' + Icon('image', 26) + '<span>Cover</span></button><button class="tog f t-lyrics">' + Icon('lyrics', 26) + '<span>Lyrics</span></button>' +
      '<button class="tog f t-info">' + Icon('text', 26) + '<span>Info</span></button>' +
      '<button class="tog f t-dark">' + Icon('moon', 26) + '<span>Dark</span></button>' +
      '<span class="pl-sync"><button class="tog f t-early">Earlier</button><span class="pl-off">0.0s</span><button class="tog f t-late">Later</button></span></div></div>' +
      '<div class="pl-body"><div class="pl-left"><div class="pl-art"></div><div class="pl-meta"><div class="pl-title"></div><div class="pl-artist"></div></div></div>' +
      '<div class="pl-lyrics"><div class="pl-view"><div class="pl-lines"></div></div><div class="pl-empty"></div></div></div>' +
      '<div class="pl-foot"><div class="pl-ctl"></div><div class="pl-extra"></div></div>', { onClose: function () { els.player = null; } });
    els.player = L.el;
    $('.pl-back', L.el).onclick = L.close;
    controls($('.pl-ctl', L.el), true);
    var ex = $('.pl-extra', L.el);
    var lk = ctlBtn(ex, 'heart', likeCurrent, 'c-like big', 40);
    ctlBtn(ex, 'queue', function () { L.close(); go('queue'); }, '', 34);
    ctlBtn(ex, 'user', function () { var t = Playback.state.track; L.close(); if (t && t.artist_id) go('artist', t.artist_id); }, '', 34);
    seekRow($('.pl-foot', L.el));
    $('.t-cover', L.el).onclick = function () { toggle('cover'); };
    $('.t-lyrics', L.el).onclick = function () { toggle('lyrics'); };
    $('.t-dark', L.el).onclick = function () { toggle('dark'); };
    $('.t-info', L.el).onclick = function () { toggle('info'); };
    // Holding OK on these repeats (the remote sends repeated key presses), for big corrections.
    $('.t-early', L.el).onclick = function () { nudge(100); };
    $('.t-late', L.el).onclick = function () { nudge(-100); };
    fillPlayer(); onState(Playback.state); syncLikeIcons();
    setTimeout(function () { Focus.set($('.c-play.big', L.el)); }, 0);
  }
  function toggle(what) {
    var p = prefs(); p[what] = !p[what];
    Store.set('player', p); applyPlayerMode();
  }
  function applyPlayerMode() {
    var P = els.player; if (!P) return;
    var p = prefs();
    P.classList.toggle('no-cover', !p.cover); P.classList.toggle('no-lyrics', !p.lyrics); P.classList.toggle('dark', p.dark); P.classList.toggle('no-info', !p.info);
    $('.t-info', P).classList.toggle('on', p.info);
    $('.t-cover', P).classList.toggle('on', p.cover); $('.t-lyrics', P).classList.toggle('on', p.lyrics); $('.t-dark', P).classList.toggle('on', p.dark);
    lyr.idx = -2;
  }
  function fillPlayer() {
    var P = els.player, t = Playback.state.track; if (!P || !t) return;
    setArt($('.pl-art', P), t.cover_big || t.album_cover_url);
    $('.pl-bg', P).style.backgroundImage = 'url("' + (t.cover_small || t.album_cover_url) + '")';
    $('.pl-title', P).textContent = t.name; $('.pl-artist', P).textContent = t.artist_names.join(', ');
    setArt($('.pn-c', P), t.cover_small || t.album_cover_url); $('.pn-t', P).textContent = t.name; $('.pn-a', P).textContent = t.artist_names.join(', ');
    var ctx = Playback.context();
    $('.pl-from', P).innerHTML = ctx && ctx.name ? '<span class="dim">Playing from</span> ' + esc(ctx.name) : '';
    $('.pl-off', P).textContent = syncLabel(t);
    applyPlayerMode(); renderPlayerLyrics();
  }
  function renderPlayerLyrics() {
    var P = els.player; if (!P) return;
    var r = lyr.result, box = $('.pl-lines', P), empty = $('.pl-empty', P), t = Playback.state.track;
    P.classList.remove('lyr-none', 'lyr-plain', 'lyr-loading');
    box.innerHTML = ''; empty.innerHTML = ''; box.style.transform = '';
    if (!r) { P.classList.add('lyr-loading'); box.innerHTML = '<div class="ln sk"></div><div class="ln sk s2"></div><div class="ln sk s3"></div>'; return; }
    if (r.synced) { box.innerHTML = r.lines.map(function (l) { return '<div class="ln' + (l.text ? '' : ' gap') + '">' + esc(l.text || '• • •') + '</div>'; }).join(''); lyr.idx = -2; return; }
    if (r.plain) {
      P.classList.add('lyr-plain');
      box.innerHTML = '<div class="plain">' + esc(r.plain).replace(/\n/g, '<br>') + '</div>';
      // Unsynced lyrics: up/down on the lyrics area scrolls them.
      var view = $('.pl-view', P), y = 0;
      view.className = 'pl-view f';
      view._key = function (k) {
        if (k !== 'up' && k !== 'down') return false;
        var max = Math.max(0, box.scrollHeight - view.clientHeight + 80);
        if ((k === 'up' && y <= 0) || (k === 'down' && y >= max)) return false;
        y = Math.max(0, Math.min(max, y + (k === 'down' ? 240 : -240))); box.style.transform = 'translate3d(0,' + (-y) + 'px,0)'; return true;
      };
      return;
    }
    P.classList.add('lyr-none');
    empty.innerHTML = '<div class="em-icon">' + Icon('lyrics', 56) + '</div><h3>No lyrics for this one</h3><p class="dim">We couldn’t find lyrics for “' + esc(t ? t.name : '') + '”.</p>';
  }
  function syncLabel(t) { var o = Lyrics.songOffset(t.uri); return (o > 0 ? '+' : o < 0 ? '−' : '') + (Math.abs(o) / 1000).toFixed(1) + 's'; }
  function nudge(ms) {
    var t = Playback.state.track; if (!t) return;
    Lyrics.setOffset(t.uri, Lyrics.songOffset(t.uri) + ms); lyr.idx = -2;
    var o = Lyrics.songOffset(t.uri), s = o === 0 ? 'Lyrics timing reset' : 'Lyrics ' + (Math.abs(o) / 1000).toFixed(1) + 's ' + (o > 0 ? 'earlier' : 'later') + ' for this song';
    if (els.player) $('.pl-off', els.player).textContent = syncLabel(t);
    toast(s);
  }

  // ---------- clock ----------
  // Live collections: no document queries per frame. The bar only moves when it changes by a visible amount.
  var lastSec = -1, lastF = -1, fills = document.getElementsByClassName('sfill'), curs = document.getElementsByClassName('cur'), durs = document.getElementsByClassName('dur');
  function tick() {
    var t = Playback.state.track;
    if (t) {
      var p = Playback.position(), d = Playback.duration(), f = d ? Math.min(1, p / d) : 0, sec = Math.floor(p / 1000), i;
      if (sec !== lastSec) { lastSec = sec; for (i = 0; i < curs.length; i++) curs[i].textContent = fmt(p); for (i = 0; i < durs.length; i++) durs[i].textContent = fmt(d); }
      if (Math.abs(f - lastF) > 0.0007) { lastF = f; for (i = 0; i < fills.length; i++) fills[i].style.transform = 'scaleX(' + f + ')'; }
      lyricTick(p);
    }
    requestAnimationFrame(tick);
  }

  function init() {
    els.top = $('#top'); els.lib = $('#lib'); els.main = $('#main'); els.view = $('#view'); els.npv = $('#npv'); els.bar = $('#bar'); els.toast = $('#toast');
    buildTop(); buildLibrary(); buildBar();
    Playback.on('track', onTrack);
    Playback.on('state', onState);
    Playback.on('queue', function () { fillNext(); if (current === 'queue') refresh(); });
    Playback.on('played', function (e) { if (e.context && e.context.id && !SpotifyApi.linked()) Library.addRecent(e.context); });
    Playback.on('error', function (e) { toast(e.message + (e.track ? ': ' + e.track.name : '')); });
    Playback.on('engine', function (sp) { if (sp.status === 'error') toast(sp.error); });
    Library.onChange(function (what) { if (what === 'playlists' || what === 'saved' || what === 'following') buildLibrary(); });
    Focus.on('focus', function (el) { var l = el.closest('.tracks'); if (l && l.more) l.more(el); });
    Focus.on('back', back);
    Focus.on('play', Playback.resume); Focus.on('pause', Playback.pause);
    Focus.on('ff', function () { Playback.skipBy(10000); }); Focus.on('rw', function () { Playback.skipBy(-10000); });
    Focus.on('chup', Playback.next); Focus.on('chdown', Playback.prev);
    Focus.on('yellow', function () { openPlayer('lyrics'); });
    Focus.on('blue', function () { openPlayer(); });
    Focus.on('any', function (k) { if (k === 'red' || k === 'green') { nudge(k === 'red' ? 100 : -100); return true; } return false; });
    onState(Playback.state);
    setNpv(true);
    requestAnimationFrame(tick);
  }

  return {
    init: init, go: go, back: back, refresh: refresh, register: function (id, fn) { views[id] = fn; }, buildLibrary: buildLibrary, buildTop: buildTop,
    h: h, esc: esc, fmt: fmt, ago: ago, count: count, bg: bg, lazy: lazy, card: card, tile: tile, shelf: shelf, open: open,
    trackList: trackList, pageHeader: pageHeader, actionBtn: actionBtn, layer: layer, dialog: dialog, askText: askText, qr: qr,
    toast: toast, addToPlaylist: addToPlaylist, openPlayer: openPlayer, current: function () { return current; }
  };
})();
