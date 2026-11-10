// Persistent chrome: background art, left rail, main panel, right Now Playing panel, bottom player bar,
// full-screen layers (Now Playing, lyrics, dialogs), toasts and the router.
var UI = (function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var els = {}, history = [], views = {}, current = null, npvOpen = true, lyricLines = [], lyricIdx = -2, lyricsReq = 0, accent = null, lastLyrics = null;

  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(ms) { var s = Math.floor((ms || 0) / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function ago(t) { if (!t) return 'never'; var m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; }
  function count(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); }

  // ---------- lazy images: data-bg is applied when the element comes near the screen ----------
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { var el = e.target; el.style.backgroundImage = artCss(el.getAttribute('data-bg')); el.removeAttribute('data-bg'); io.unobserve(el); } });
  }, { rootMargin: '700px' }) : null;
  function lazy(scope) {
    [].forEach.call((scope || document).querySelectorAll('[data-bg]'), function (el) {
      if (io) io.observe(el); else { el.style.backgroundImage = artCss(el.getAttribute('data-bg')); el.removeAttribute('data-bg'); }
    });
  }
  function bg(url) { return url ? ' data-bg="' + esc(url) + '"' : ''; }
  // Cover art over a music-note fallback: if the image fails to load, the note underneath shows.
  function artCss(url) { return url ? 'url("' + url + '"), url("assets/note.svg")' : ''; }

  // ---------- building blocks ----------
  function itemSub(it) {
    if (it.kind === 'artist') return 'Artist';
    if (it.kind === 'album') return 'Album · ' + it.owner;
    if (it.kind === 'playlist') return 'Playlist · ' + it.owner;
    if (it.kind === 'mine') return it.sub;
    return it.artist_names ? it.artist_names.join(', ') : '';
  }
  function open(it, list, i, ctx) {
    if (it.kind === 'artist') return go('artist', it.id);
    if (it.kind === 'album' || it.kind === 'playlist') return go('collection', it.id);
    if (it.kind === 'mine') return go(it.view, it.arg);
    Playback.play(list, i, ctx);
  }
  function card(it, onClick) {
    var round = it.kind === 'artist', c = h('button', 'card f' + (round ? ' artist' : ''));
    var img = it.kind === 'artist' ? it.avatar : (it.cover || it.album_cover_url);
    c.innerHTML = '<div class="art"' + bg(img) + '>' + (!img && it.icon ? Icon(it.icon, 64) : '') + '</div>' +
      '<div class="t">' + esc(it.name) + '</div><div class="s">' + esc(itemSub(it)) + '</div>' +
      (it.kind === 'track' || it.src ? '<div class="play-badge">' + Icon('play', 28) + '</div>' : '');
    c.onclick = onClick; return c;
  }
  function tile(it, onClick) {
    var img = it.kind === 'artist' ? it.avatar : (it.cover || it.album_cover_url), t = h('button', 'tile f');
    t.innerHTML = '<div class="tart' + (it.icon === 'heartFill' ? ' liked-cover' : '') + '"' + bg(img) + '>' + (!img && it.icon ? Icon(it.icon, 34) : '') + '</div><div class="tname">' + esc(it.name) + '</div>';
    t.onclick = onClick; return t;
  }
  // A titled horizontal row of cards. items may be a promise; the row shows a placeholder until it lands.
  function shelf(parent, title, items, opts) {
    opts = opts || {};
    var s = h('section', 'shelf');
    s.innerHTML = '<div class="shelf-head">' + (opts.over ? '<div class="over">' + esc(opts.over) + '</div>' : '') + '<h2>' + esc(title) + '</h2></div>' +
      '<div class="hs"><div class="in"></div></div>';
    parent.appendChild(s);
    var row = $('.in', s);
    function fill(list) {
      row.innerHTML = '';
      if (!list || !list.length) { if (opts.empty) row.appendChild(h('p', 'dim pad', esc(opts.empty))); else s.parentNode && s.parentNode.removeChild(s); return; }
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
    var list = h('div', 'tracks' + (opts.compact ? ' compact' : '') + (noAlbum ? ' no-al' : '')), shown = 0, PAGE = 60;
    list.innerHTML = '<div class="th"><span class="i">#</span><span class="n">Title</span><span class="al">' + (opts.albumCol || 'Album') + '</span><span class="len">' + Icon('music', 20) + '</span></div>';
    parent.appendChild(list);
    function more() {
      var end = Math.min(tracks.length, shown + PAGE);
      for (var i = shown; i < end; i++) list.appendChild(row(tracks[i], i, end));
      shown = end; lazy(list);
    }
    function row(t, i, end) {
      var r = h('div', 'trow' + (t && t.missing ? ' missing' : ''));
      var b = h('button', 'tmain f');
      b.innerHTML = '<span class="i">' + (i + 1) + '</span><span class="tc"' + bg(t.cover_small || t.album_cover_url) + '></span>' +
        '<span class="n"><span class="tt">' + esc(t.name) + '</span><span class="ta">' + esc((t.artist_names || []).join(', ')) + '</span></span>' +
        '<span class="al">' + esc(opts.col ? opts.col(t) : (t.album_name || '')) + '</span><span class="len">' + fmt(t.duration) + '</span>';
      b.onclick = function () { opts.onPick(i); };
      if (i === end - 1 && end < tracks.length) b._more = true;
      r.appendChild(b);
      if (t.src && !opts.noLike) {
        var like = h('button', 'ico-btn f' + (Library.isLiked(t) ? ' on' : ''), Icon(Library.isLiked(t) ? 'heartFill' : 'heart', 26));
        like.onclick = function () { var on = Library.toggleLike(t); like.className = 'ico-btn f focus' + (on ? ' on' : ''); like.innerHTML = Icon(on ? 'heartFill' : 'heart', 26); toast(on ? 'Added to Liked Songs' : 'Removed from Liked Songs'); };
        var add = h('button', 'ico-btn f', Icon('plus', 26)); add.onclick = function () { addToPlaylist(t); };
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
  function pageHeader(parent, o) {
    var hd = h('header', 'phead' + (o.round ? ' round' : ''));
    hd.innerHTML = '<div class="pcover"' + bg(o.cover) + '>' + (!o.cover && o.icon ? Icon(o.icon, 120) : '') + '</div>' +
      '<div class="pmeta"><div class="over">' + esc(o.over) + '</div><h1 class="ptitle">' + esc(o.title) + '</h1>' +
      (o.desc ? '<p class="pdesc">' + esc(o.desc) + '</p>' : '') + '<div class="psub">' + o.sub + '</div><div class="pactions"></div></div>';
    parent.appendChild(hd); lazy(hd);
    return $('.pactions', hd);
  }
  function actionBtn(parent, icon, label, onClick, cls) {
    var b = h('button', 'abtn f ' + (cls || ''), Icon(icon, cls === 'primary' ? 40 : 30) + (label ? '<span>' + esc(label) + '</span>' : ''));
    b.onclick = onClick; parent.appendChild(b); return b;
  }

  // ---------- router ----------
  function go(id, arg, noPush) {
    if (!views[id]) id = 'home';
    if (!noPush) { history.push([id, arg]); if (history.length > 40) history.shift(); }
    current = id;
    [].forEach.call(document.querySelectorAll('#rail .nav'), function (b) { b.classList.toggle('active', b.getAttribute('data-id') === id); });
    var vs = els.view; vs.firstElementChild.innerHTML = ''; Focus.resetScroll(vs);
    views[id](vs.firstElementChild, arg);
    lazy(vs);
    setTimeout(function () { if (!Focus.inLayer()) Focus.first(vs); }, 0);
  }
  function back() {
    if (history.length > 1) { history.pop(); var p = history[history.length - 1]; go(p[0], p[1], true); return; }
    if (current !== 'home') return go('home');
    confirmExit();
  }
  function refresh() { var p = history[history.length - 1]; if (p) go(p[0], p[1], true); }

  // ---------- dialogs & layers ----------
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
  function confirmExit() {
    dialog('Exit TuneDeck?', '<p class="dim">Music stops when you leave.</p>', [{ label: 'Exit', onClick: function () { window.close(); } }, { label: 'Stay' }]);
  }
  function qr(text, size) {
    var q = qrcode(0, 'M'); q.addData(text); q.make();
    return '<div class="qr">' + q.createSvgTag({ cellSize: Math.max(4, Math.floor((size || 300) / (q.getModuleCount() + 4))), margin: 2, scalable: false }) + '</div>';
  }
  function addToPlaylist(t) {
    var mine = Library.playlists().filter(function (p) { return p.origin === 'local'; });
    var d = layer('dialog-layer', '<div class="dialog"><h2>Add to playlist</h2><div class="dlist"></div><div class="dbtns"></div></div>');
    var list = $('.dlist', d.el);
    var nb = h('button', 'drow f default', Icon('plus', 28) + '<span>New playlist</span>');
    nb.onclick = function () { d.close(); askText('Name your playlist', 'My playlist #' + (mine.length + 1), 'Create', function (name) { var p = Library.createPlaylist(name); Library.addToPlaylist(p.id, t); toast('Added to ' + name); }); };
    list.appendChild(nb);
    mine.forEach(function (p) {
      var b = h('button', 'drow f', '<span class="dcov"' + bg(p.cover) + '></span><span>' + esc(p.name) + '</span>');
      b.onclick = function () { Library.addToPlaylist(p.id, t); d.close(); toast('Added to ' + p.name); };
      list.appendChild(b);
    });
    lazy(list);
  }
  function askText(title, value, doneLabel, onDone) {
    var d = layer('dialog-layer', '<div class="dialog wide"><h2>' + esc(title) + '</h2><div class="kbd-field"></div><div class="kbd-host"></div></div>', {
      key: function (k, e) { return false; }
    });
    var field = $('.kbd-field', d.el); field.textContent = value || '';
    var kb = Keyboard.create({ value: value || '', onChange: function (v) { field.textContent = v; }, onDone: function (v) { if (!v.trim()) return toast('Type a name first'); d.close(); onDone(v.trim()); }, doneLabel: doneLabel });
    $('.kbd-host', d.el).appendChild(kb);
    setTimeout(function () { Focus.first(kb); }, 0);
  }

  // ---------- toast ----------
  var toastT;
  function toast(msg) {
    els.toast = els.toast || $('#toast');
    els.toast.textContent = msg; els.toast.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { els.toast.classList.remove('show'); }, 2800);
  }

  // ---------- rail ----------
  var NAV = [['home', 'home', 'Home'], ['search', 'search', 'Search'], ['library', 'library', 'Your Library'], ['market', 'store', 'Marketplace']];
  function buildRail() {
    var r = els.rail; r.innerHTML = '';
    var top = h('div', 'rail-top');
    NAV.forEach(function (n) {
      var b = h('button', 'nav f', Icon(n[1], 34) + '<span class="tip">' + n[2] + '</span>'); b.setAttribute('data-id', n[0]);
      b.onclick = function () { go(n[0]); }; top.appendChild(b);
    });
    r.appendChild(top);
    r.appendChild(h('div', 'rail-sep'));
    var pins = h('div', 'rail-pins vs', '<div class="in"></div>'), pin = pins.firstElementChild;
    var items = [{ name: 'Liked Songs', cover: '', liked: true }].concat(Library.saved().slice(0, 4), Library.playlists().slice(0, 8));
    items.forEach(function (p) {
      var img = p.cover;
      var b = h('button', 'pin f' + (p.liked ? ' liked' : ''), '<span class="pinart"' + bg(img) + '>' + (p.liked ? Icon('heartFill', 30) : '') + '</span><span class="tip">' + esc(p.name) + '</span>');
      b.onclick = function () { if (p.liked) go('liked'); else if (p.kind) go('collection', p.id); else go('playlist', p.id); };
      pin.appendChild(b);
    });
    r.appendChild(pins);
    var bottom = h('div', 'rail-bottom');
    var set = h('button', 'nav f', Icon('settings', 32) + '<span class="tip">Settings</span>'); set.setAttribute('data-id', 'settings'); set.onclick = function () { go('settings'); };
    var prof = Profiles.current();
    var me = h('button', 'avatar f', '<span style="background:' + prof.color + '">' + esc(prof.name.charAt(0).toUpperCase()) + '</span><span class="tip">' + esc(prof.name) + ' · switch profile</span>');
    me.onclick = function () { Profiles.pick(); };
    bottom.appendChild(set); bottom.appendChild(me); r.appendChild(bottom);
    lazy(r);
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
  function buildBar() {
    var b = els.bar;
    b.innerHTML =
      '<div class="bleft"><button class="bnow f"><span class="bcover"></span><span class="bmeta"><span class="btitle">Nothing playing</span><span class="bartist">Pick something to play</span></span></button>' +
      '<button class="ico-btn f blike">' + Icon('heart', 28) + '</button></div>' +
      '<div class="bcenter"><div class="bctl"></div><div class="bseek"><span class="bcur">0:00</span><button class="seekbar f"><span class="sbar"><span class="sfill"></span></span><span class="shint">◀ ▶ 10s</span></button><span class="bdur">0:00</span></div></div>' +
      '<div class="bright"></div>';
    var ctl = $('.bctl', b);
    els.shuffle = ctlBtn(ctl, 'shuffle', function () { Playback.setShuffle(!Playback.state.shuffle); toast(Playback.state.shuffle ? 'Shuffle on' : 'Shuffle off'); });
    ctlBtn(ctl, 'prev', Playback.prev);
    els.play = ctlBtn(ctl, 'play', Playback.toggle, 'bplay');
    ctlBtn(ctl, 'next', Playback.next);
    els.repeat = ctlBtn(ctl, 'repeat', cycleRepeat);
    var right = $('.bright', b);
    els.lyrBtn = ctlBtn(right, 'lyrics', function () { openLyrics(); });
    ctlBtn(right, 'queue', function () { go('queue'); });
    els.npvBtn = ctlBtn(right, 'panel', function () { setNpv(!npvOpen); });
    ctlBtn(right, 'expand', function () { openNowPlaying(); });
    Ext.topbar().forEach(function (t) { ctlBtn(right, 'star', t.onClick); });
    $('.bnow', b).onclick = openNowPlaying;
    els.blike = $('.blike', b); els.blike.onclick = likeCurrent;
    seekKeys($('.seekbar', b));
    els.bcur = $('.bcur', b); els.bdur = $('.bdur', b); els.sfill = $('.sfill', b);
  }
  function ctlBtn(parent, icon, fn, cls) { var e = h('button', 'ico-btn f ' + (cls || ''), Icon(icon, cls === 'bplay' ? 34 : 28)); e.onclick = fn; parent.appendChild(e); return e; }
  function cycleRepeat() {
    var order = ['off', 'all', 'track'], n = order[(order.indexOf(Playback.state.repeat) + 1) % 3];
    Playback.setRepeat(n); toast(n === 'off' ? 'Repeat off' : n === 'all' ? 'Repeat all' : 'Repeat this song');
  }
  function likeCurrent() {
    var t = Playback.state.track; if (!t) return;
    var on = Library.toggleLike(t); toast(on ? 'Added to Liked Songs' : 'Removed from Liked Songs'); setLikeIcons();
  }
  function setLikeIcons() {
    var on = Library.isLiked(Playback.state.track);
    [].forEach.call(document.querySelectorAll('.blike, .like-now'), function (e) { e.classList.toggle('on', on); e.innerHTML = Icon(on ? 'heartFill' : 'heart', e.classList.contains('like-now') ? 32 : 28); });
  }

  function onState(s) {
    [].forEach.call(document.querySelectorAll('.bplay, .fplay'), function (e) { e.innerHTML = Icon(s.paused ? 'play' : 'pause', e.classList.contains('fplay') ? 44 : 34); });
    [].forEach.call(document.querySelectorAll('.is-shuffle'), function (e) { e.classList.toggle('on', s.shuffle); });
    els.shuffle.classList.toggle('on', s.shuffle);
    els.repeat.classList.toggle('on', s.repeat !== 'off');
    els.repeat.classList.toggle('one', s.repeat === 'track');
    document.body.classList.toggle('buffering', !!s.buffering && !s.paused);
  }

  function onTrack(t) {
    $('.btitle').textContent = t ? t.name : 'Nothing playing';
    $('.bartist').textContent = t ? t.artist_names.join(', ') : 'Pick something to play';
    var bc = $('.bcover'); bc.style.backgroundImage = t ? artCss(t.cover_small) : '';
    setBackground(t);
    setLikeIcons();
    fillNpv(t);
    if (els.fullNp) fillFull(t);
    loadLyrics(t);
    if (t && npvOpen) document.body.classList.add('npv');
  }

  // Background: the small cover scaled up is naturally soft, so no CSS blur is needed on this GPU.
  var bgFlip = 0;
  function setBackground(t) {
    var layers = document.querySelectorAll('#bg .bgimg'), next = layers[bgFlip ^ 1], prev = layers[bgFlip];
    if (!t || !t.cover_small) { prev.style.opacity = 0; next.style.opacity = 0; return; }
    var img = new Image();
    img.onload = function () { next.style.backgroundImage = 'url("' + t.cover_small + '")'; next.style.opacity = 1; prev.style.opacity = 0; bgFlip ^= 1; };
    img.src = t.cover_small;
    extractColor(t.cover_small);
  }
  // Dominant colour for the lyrics screen. Needs CORS on the image; falls back to a calm default.
  function extractColor(url) {
    var img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var c = document.createElement('canvas'); c.width = c.height = 16; var x = c.getContext('2d'); x.drawImage(img, 0, 0, 16, 16);
        var d = x.getImageData(0, 0, 16, 16).data, r = 0, g = 0, b = 0, n = 0;
        for (var i = 0; i < d.length; i += 4) { var mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx - mn > 30) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } }
        if (!n) { for (i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } }
        r /= n; g /= n; b /= n;
        var l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2, k = l > 110 ? 110 / l : l < 50 ? 60 / Math.max(l, 1) : 1;
        accent = 'rgb(' + Math.round(r * k) + ',' + Math.round(g * k) + ',' + Math.round(b * k) + ')';
      } catch (e) { accent = null; }
      document.documentElement.style.setProperty('--accent-art', accent || '#4a3b6b');
    };
    img.onerror = function () { document.documentElement.style.setProperty('--accent-art', '#4a3b6b'); };
    img.src = url;
  }

  // ---------- right Now Playing panel ----------
  function setNpv(on) {
    npvOpen = on;
    document.body.classList.toggle('npv', on && !!Playback.state.track);
    els.npvBtn.classList.toggle('on', on);
  }
  function fillNpv(t) {
    var p = els.npv;
    if (!t) { p.innerHTML = ''; return; }
    p.innerHTML = '<div class="vs npv-scroll"><div class="in">' +
      '<div class="npv-head"><span class="over">' + esc(Playback.context() ? Playback.context().name : 'Now playing') + '</span></div>' +
      '<div class="npv-art"' + bg(t.cover_big || t.album_cover_url) + '></div>' +
      '<div class="npv-row"><div class="npv-meta"><div class="npv-title">' + esc(t.name) + '</div><div class="npv-artist">' + esc(t.artist_names.join(', ')) + '</div></div>' +
      '<button class="ico-btn f like-now">' + Icon('heart', 32) + '</button><button class="ico-btn f npv-add">' + Icon('plus', 32) + '</button></div>' +
      '<button class="npv-card lyr-card f"><div class="card-title">Lyrics</div><div class="lyr-mini"><p class="dim">Loading lyrics…</p></div></button>' +
      '<div class="npv-card next-card"><div class="card-title">Next in queue</div><div class="next-body"></div></div>' +
      '<button class="npv-card about f"><div class="card-title">About the artist</div><div class="about-body"><p class="dim">' + esc(t.artist_names[0]) + '</p></div></button>' +
      '</div></div>';
    lazy(p);
    $('.like-now', p).onclick = likeCurrent;
    $('.npv-add', p).onclick = function () { addToPlaylist(t); };
    $('.lyr-card', p).onclick = function () { openLyrics(); };
    $('.about', p).onclick = function () { if (t.artist_id) go('artist', t.artist_id); };
    setLikeIcons(); fillNext();
    if (t.artist_id) Sources.artist(t.artist_id).then(function (a) {
      if (Playback.state.track !== t) return;
      $('.about-body', p).innerHTML = '<div class="about-av"' + bg(a.avatar) + '></div><div><div class="about-name">' + esc(a.name) + (a.verified ? ' <span class="badge">✓</span>' : '') + '</div>' +
        '<div class="dim">' + count(a.followers) + ' followers · ' + a.tracks + ' tracks</div>' + (a.bio ? '<p class="about-bio">' + esc(a.bio.slice(0, 160)) + '</p>' : '') + '</div>';
      lazy(p);
    }, function () {});
  }
  function fillNext() {
    var nb = $('.next-body', els.npv); if (!nb) return;
    var q = Playback.queue(), n = q[Playback.index() + 1];
    nb.innerHTML = n ? '<div class="next-item"><span class="tc"' + bg(n.cover_small) + '></span><span><span class="tt">' + esc(n.name) + '</span><span class="ta">' + esc(n.artist_names.join(', ')) + '</span></span></div>' : '<p class="dim">Nothing up next</p>';
    lazy(nb);
  }

  // ---------- lyrics ----------
  function loadLyrics(t) {
    lyricLines = []; lyricIdx = -2; lastLyrics = null;
    var req = ++lyricsReq;
    renderLyricViews(null);
    if (!t) return;
    var o = t.orig;
    var meta = o ? { uri: t.uri, name: o.name, artist_names: [o.artist.split(',')[0]], album_name: o.album, duration: t.duration } : t;
    Lyrics.load(meta).then(function (r) { if (req !== lyricsReq) return; lyricLines = r.lines; lastLyrics = r; renderLyricViews(r); });
  }
  function renderLyricViews(r) {
    var mini = $('.lyr-mini', els.npv);
    if (mini) mini.innerHTML = !r ? '<p class="dim">Loading lyrics…</p>' : r.synced ? '<div class="lm prev"></div><div class="lm cur">♪</div><div class="lm nxt"></div>' : '<p class="dim">' + (r.plain ? 'Lyrics aren’t synced for this song' : 'No lyrics for this song') + '</p>';
    if (els.fullLyr) fillLyricsScreen(r);
  }
  function lyricTick(p) {
    if (!lyricLines.length) return;
    var t = Playback.state.track, i = Lyrics.indexAt(lyricLines, p + Lyrics.offset(t.uri) + 150);
    if (i === lyricIdx) return;
    lyricIdx = i;
    var mini = $('.lyr-mini', els.npv);
    if (mini && $('.cur', mini)) {
      $('.prev', mini).textContent = i > 0 ? lyricLines[i - 1].text : '';
      $('.cur', mini).textContent = i >= 0 ? (lyricLines[i].text || '♪') : '♪';
      $('.nxt', mini).textContent = lyricLines[i + 1] ? lyricLines[i + 1].text : '';
    }
    if (els.fullLyr) {
      var box = $('.lyr-lines', els.fullLyr); if (!box) return;
      var old = $('.ln.on', box); if (old) old.classList.remove('on');
      [].forEach.call(box.children, function (c, n) { c.classList.toggle('past', n < i); });
      var now = box.children[i];
      if (now) { now.classList.add('on'); box.style.transform = 'translate3d(0,' + Math.round(340 - now.offsetTop) + 'px,0)'; }
      else box.style.transform = 'translate3d(0,340px,0)';
    }
  }
  function openLyrics() {
    if (!Playback.state.track) return toast('Play something first');
    if (els.fullLyr) return;
    var L = layer('full lyrics-screen', '<div class="lyr-top"><div class="lyr-cover"></div><div><div class="lyr-t"></div><div class="lyr-a"></div></div>' +
      '<div class="lyr-hint">' + Icon('back', 22) + ' Back · <b class="kr">●</b> earlier · <b class="kg">●</b> later</div></div><div class="lyr-view"><div class="lyr-lines"></div></div>' +
      '<div class="lyr-foot"><button class="ico-btn f fplay default">' + Icon('pause', 44) + '</button><button class="seekbar f wide"><span class="sbar"><span class="sfill"></span></span></button></div>', {
      onClose: function () { els.fullLyr = null; }
    });
    els.fullLyr = L.el;
    $('.fplay', L.el).onclick = Playback.toggle;
    seekKeys($('.seekbar', L.el));
    var t = Playback.state.track;
    $('.lyr-cover', L.el).style.backgroundImage = artCss(t.cover_small);
    $('.lyr-t', L.el).textContent = t.name; $('.lyr-a', L.el).textContent = t.artist_names.join(', ');
    fillLyricsScreen(lastLyrics);
    onState(Playback.state);
  }
  function fillLyricsScreen(r) {
    var box = $('.lyr-lines', els.fullLyr); if (!box) return;
    lyricIdx = -2;
    box.innerHTML = !r ? '<div class="ln on">Loading lyrics…</div>' : r.synced ? r.lines.map(function (l) { return '<div class="ln">' + esc(l.text || '♪') + '</div>'; }).join('') :
      r.plain ? '<div class="plain">' + esc(r.plain).replace(/\n/g, '<br>') + '</div>' : '<div class="ln on">No lyrics for this song</div>';
    box.style.transform = r && r.plain && !r.synced ? 'translate3d(0,40px,0)' : 'translate3d(0,340px,0)';
    var t = Playback.state.track;
    if (t && els.fullLyr) { $('.lyr-cover', els.fullLyr).style.backgroundImage = artCss(t.cover_small); $('.lyr-t', els.fullLyr).textContent = t.name; $('.lyr-a', els.fullLyr).textContent = t.artist_names.join(', '); }
  }

  // ---------- full-screen Now Playing ----------
  function openNowPlaying() {
    if (!Playback.state.track) return toast('Play something first');
    if (els.fullNp) return;
    var F = layer('full np-screen', '<div class="np-bg"></div><div class="np-shade"></div><div class="np-body"><div class="np-art"></div><div class="np-side">' +
      '<div class="over np-ctx"></div><div class="np-title"></div><div class="np-artist"></div>' +
      '<div class="np-seek"><span class="fcur">0:00</span><button class="seekbar f wide"><span class="sbar"><span class="sfill"></span></span><span class="shint">◀ ▶ 10s</span></button><span class="fdur">0:00</span></div>' +
      '<div class="np-ctl"></div><div class="np-extra"></div></div></div>', { onClose: function () { els.fullNp = null; } });
    els.fullNp = F.el;
    var ctl = $('.np-ctl', F.el), ex = $('.np-extra', F.el);
    var sh = ctlBtn(ctl, 'shuffle', function () { Playback.setShuffle(!Playback.state.shuffle); }); sh.classList.add('is-shuffle');
    ctlBtn(ctl, 'prev', Playback.prev);
    var pl = ctlBtn(ctl, 'play', Playback.toggle, 'fplay default'); pl.innerHTML = Icon('play', 44);
    ctlBtn(ctl, 'next', Playback.next);
    ctlBtn(ctl, 'repeat', cycleRepeat);
    var lk = ctlBtn(ex, 'heart', likeCurrent); lk.classList.add('like-now');
    actionBtn(ex, 'lyrics', 'Lyrics', function () { openLyrics(); });
    actionBtn(ex, 'queue', 'Queue', function () { F.close(); go('queue'); });
    actionBtn(ex, 'user', 'Artist', function () { var t = Playback.state.track; F.close(); if (t && t.artist_id) go('artist', t.artist_id); });
    seekKeys($('.seekbar', F.el));
    fillFull(Playback.state.track); onState(Playback.state); setLikeIcons();
  }
  function fillFull(t) {
    var F = els.fullNp; if (!F || !t) return;
    $('.np-art', F).style.backgroundImage = artCss(t.cover_big || t.album_cover_url);
    $('.np-bg', F).style.backgroundImage = 'url("' + t.cover_small + '")';
    $('.np-title', F).textContent = t.name; $('.np-artist', F).textContent = t.artist_names.join(', ');
    $('.np-ctx', F).textContent = Playback.context() ? 'Playing from ' + Playback.context().name : 'Now playing';
  }

  // ---------- clock ----------
  var lastSec = -1;
  function tick() {
    var t = Playback.state.track;
    if (t) {
      var p = Playback.position(), d = Playback.duration(), f = d ? Math.min(1, p / d) : 0, sec = Math.floor(p / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        els.bcur.textContent = fmt(p); els.bdur.textContent = fmt(d);
        if (els.fullNp) { $('.fcur', els.fullNp).textContent = fmt(p); $('.fdur', els.fullNp).textContent = fmt(d); }
      }
      [].forEach.call(document.querySelectorAll('.sfill'), function (e) { e.style.transform = 'scaleX(' + f + ')'; });
      lyricTick(p);
    }
    requestAnimationFrame(tick);
  }

  function init() {
    els.rail = $('#rail'); els.view = $('#view'); els.npv = $('#npv'); els.bar = $('#bar'); els.toast = $('#toast');
    buildRail(); buildBar();
    Playback.on('track', onTrack);
    Playback.on('state', onState);
    Playback.on('queue', fillNext);
    Playback.on('played', function (e) { if (e.context) Library.addRecent(e.context); });
    Playback.on('error', function (e) { toast(e.message + (e.track ? ': ' + e.track.name : '')); });
    Library.onChange(function (what) { if (what === 'playlists' || what === 'saved') buildRail(); });
    Focus.on('focus', function (el) { var l = el.closest('.tracks'); if (l && l.more) l.more(el); });
    Focus.on('back', back);
    Focus.on('play', Playback.resume); Focus.on('pause', Playback.pause);
    Focus.on('ff', function () { Playback.skipBy(10000); }); Focus.on('rw', function () { Playback.skipBy(-10000); });
    Focus.on('chup', Playback.next); Focus.on('chdown', Playback.prev);
    Focus.on('yellow', function () { if (els.fullLyr) return; openLyrics(); });
    Focus.on('blue', openNowPlaying);
    Focus.on('red', function () { nudge(-250); }); Focus.on('green', function () { nudge(250); });
    Focus.on('any', function (k) {
      if ((k === 'red' || k === 'green') && Focus.inLayer()) { nudge(k === 'red' ? -250 : 250); return true; }
      return false;
    });
    onState(Playback.state);
    setNpv(true);
    requestAnimationFrame(tick);
  }
  function nudge(ms) {
    var t = Playback.state.track; if (!t) return;
    Lyrics.setOffset(t.uri, Lyrics.offset(t.uri) + ms); lyricIdx = -2;
    toast('Lyrics ' + (Lyrics.offset(t.uri) >= 0 ? '+' : '') + (Lyrics.offset(t.uri) / 1000).toFixed(2) + 's');
  }

  return {
    init: init, go: go, back: back, refresh: refresh, register: function (id, fn) { views[id] = fn; }, buildRail: buildRail,
    h: h, esc: esc, fmt: fmt, ago: ago, count: count, bg: bg, lazy: lazy, card: card, tile: tile, shelf: shelf, open: open,
    trackList: trackList, pageHeader: pageHeader, actionBtn: actionBtn, layer: layer, dialog: dialog, askText: askText, qr: qr,
    toast: toast, addToPlaylist: addToPlaylist, openLyrics: openLyrics, openNowPlaying: openNowPlaying, current: function () { return current; }
  };
})();
