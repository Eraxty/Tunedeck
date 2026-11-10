var UI = (function () {
  var $ = function (s) { return document.querySelector(s); };
  var view = $('#view'), side = $('#sidebar'), bar = $('#player'), lyr = $('#lyrics-pane');
  var track = null, paused = true, pos = 0, posAt = 0, lines = [], lyrIdx = -2, lyrOn = false, history = [];

  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function progress() { return paused ? pos : pos + (Date.now() - posAt); }

  var NAV = [['home', 'Home'], ['search', 'Search'], ['library', 'Your Library'], ['ext', 'Themes & Plugins']];

  function buildSide() {
    side.innerHTML = '<div class="logo">TuneDeck</div>';
    NAV.forEach(function (n) {
      var b = h('button', 'nav f', esc(n[1])); b.onclick = function () { go(n[0]); }; b.dataset.id = n[0]; side.appendChild(b);
    });
  }

  function go(id, arg, noPush) {
    if (!noPush) history.push([id, arg]);
    [].forEach.call(side.children, function (b) { b.classList.toggle('active', b.dataset && b.dataset.id === id); });
    view.scrollTop = 0; view.innerHTML = '';
    (VIEWS[id] || VIEWS.home)(arg);
    setTimeout(function () { Focus.first(view); }, 0);
  }

  function back() { if (history.length > 1) { history.pop(); var p = history[history.length - 1]; go(p[0], p[1], true); } }

  function card(title, sub, img, onClick) {
    var c = h('button', 'card f');
    c.innerHTML = '<div class="art" style="background-image:url(' + esc(img || '') + ')"></div><div class="t">' + esc(title) + '</div><div class="s">' + esc(sub) + '</div>';
    c.onclick = onClick; return c;
  }

  var VIEWS = {
    home: function () {
      view.appendChild(h('h1', null, 'Good to see you'));
      var row = h('div', 'cards scroll'); view.appendChild(row);
      Api.get('/status').then(function () {});
      Api.playlists().then(function (r) {
        if (!r) return row.appendChild(h('p', 'dim', 'Waiting for Spotify session…'));
        row.appendChild(card('Liked Songs', 'Your favourites', '', function () { go('playlist', { uri: 'spotify:collection:tracks', name: 'Liked Songs' }); }));
        r.items.forEach(function (p) { row.appendChild(card(p.name, p.length + ' songs', p.image_url, function () { go('playlist', { uri: p.uri, name: p.name }); })); });
        Focus.first(view);
      });
    },
    library: function () {
      view.appendChild(h('h1', null, 'Your Library'));
      var list = h('div', 'list scroll'); view.appendChild(list);
      Api.playlists().then(function (r) {
        if (!r) return;
        r.items.forEach(function (p) {
          var b = h('button', 'row f', '<span class="n">' + esc(p.name) + '</span><span class="d">' + p.length + ' songs</span>');
          b.onclick = function () { go('playlist', { uri: p.uri, name: p.name }); }; list.appendChild(b);
        });
        Focus.first(view);
      });
    },
    playlist: function (p) {
      view.appendChild(h('h1', null, esc(p.name)));
      var play = h('button', 'btn f', 'Play'); play.onclick = function () { Api.play(p.uri); }; view.appendChild(play);
      var list = h('div', 'list scroll'); view.appendChild(list);
      (function poll(n) {
        Api.tracks(p.uri).then(function (r) {
          if (!r) return;
          list.innerHTML = '';
          r.tracks.forEach(function (it, i) {
            var t = it.track;
            var b = h('button', 'row f', '<span class="i">' + (i + 1) + '</span><span class="n">' + esc(t ? t.name : '…') + '</span><span class="d">' + esc(t ? t.artist_names.join(', ') : '') + '</span>');
            b.onclick = function () { Api.play(p.uri, it.uri); }; list.appendChild(b);
          });
          if ((!r.ready || r.cached < r.length) && n < 30) setTimeout(function () { poll(n + 1); }, 1200);
          if (n === 0) Focus.first(view);
        });
      })(0);
    },
    search: function () {
      view.appendChild(h('h1', null, 'Search'));
      var inp = h('input', 'f'); inp.placeholder = 'Songs, artists, albums'; view.appendChild(inp);
      var res = h('div', 'list scroll'); view.appendChild(res);
      inp.onchange = function () {
        res.innerHTML = '<p class="dim">Searching…</p>';
        Api.post('/token').then(function (t) {
          return fetch('https://api.spotify.com/v1/search?type=track&limit=20&q=' + encodeURIComponent(inp.value), { headers: { Authorization: 'Bearer ' + t.token } });
        }).then(function (r) { return r.json(); }).then(function (j) {
          res.innerHTML = '';
          if (!j.tracks) return res.appendChild(h('p', 'dim', 'Search unavailable'));
          j.tracks.items.forEach(function (t) {
            var b = h('button', 'row f', '<span class="n">' + esc(t.name) + '</span><span class="d">' + esc(t.artists.map(function (a) { return a.name; }).join(', ')) + '</span>');
            b.onclick = function () { Api.play(t.uri); }; res.appendChild(b);
          });
        }).catch(function () { res.innerHTML = '<p class="dim">Search failed</p>'; });
      };
    },
    ext: function () {
      var d = Ext.db();
      view.appendChild(h('h1', null, 'Themes & Plugins'));
      view.appendChild(h('p', 'dim', 'Install by URL (raw .css / .js). Spicetify-style themes with color.ini are supported.'));
      function installer(label, fn) {
        var inp = h('input', 'f'); inp.placeholder = label + ' URL'; var b = h('button', 'btn f', 'Install ' + label);
        b.onclick = function () { fn(inp.value).then(function () { Ext.toast(label + ' installed'); go('ext', null, true); }, function (e) { Ext.toast('Failed: ' + e.message); }); };
        view.appendChild(inp); view.appendChild(b);
      }
      installer('theme', function (u) { return Ext.installTheme(u.split('/').slice(-2)[0] || 'theme', u); });
      installer('plugin', function (u) { return Ext.installPlugin(u.split('/').pop(), u); });
      var list = h('div', 'list'); view.appendChild(list);
      d.themes.forEach(function (t) {
        var b = h('button', 'row f', '<span class="n">Theme: ' + esc(t.name) + (d.activeTheme === t.id ? ' ✓' : '') + '</span>');
        b.onclick = function () { Ext.setTheme(d.activeTheme === t.id ? null : t.id); go('ext', null, true); }; list.appendChild(b);
      });
      d.plugins.forEach(function (p) {
        var b = h('button', 'row f', '<span class="n">Plugin: ' + esc(p.name) + '</span><span class="d">select to remove</span>');
        b.onclick = function () { Ext.remove('plugins', p.id); go('ext', null, true); }; list.appendChild(b);
      });
    }
  };

  function buildBar() {
    bar.innerHTML = '<div class="np"><div class="cover"></div><div class="meta"><div class="title"></div><div class="artist"></div></div></div>' +
      '<div class="ctl"><div class="btns"></div><div class="seek"><span class="cur">0:00</span><div class="track"><div class="fill"></div></div><span class="dur">0:00</span></div></div>' +
      '<div class="right"></div>';
    var btns = bar.querySelector('.btns');
    [['⏮', Api.prev], ['⏯', Api.toggle], ['⏭', Api.next]].forEach(function (b) {
      var e = h('button', 'ico f', b[0]); e.onclick = b[1]; btns.appendChild(e);
    });
    var right = bar.querySelector('.right');
    var ly = h('button', 'ico f', '♪'); ly.onclick = toggleLyrics; right.appendChild(ly);
    Ext.topbar().forEach(function (t) { var e = h('button', 'ico f', esc(t.label)); e.onclick = t.onClick; right.appendChild(e); });
  }

  function setTrack(t) {
    track = t;
    bar.querySelector('.title').textContent = t ? t.name : '';
    bar.querySelector('.artist').textContent = t ? t.artist_names.join(', ') : '';
    bar.querySelector('.cover').style.backgroundImage = t && t.album_cover_url ? 'url(' + t.album_cover_url + ')' : '';
    bar.querySelector('.dur').textContent = t ? fmt(t.duration) : '0:00';
    lines = []; lyrIdx = -2; lyr.innerHTML = '';
    if (t) Lyrics.load(t).then(function (r) {
      if (!track || track.uri !== t.uri) return;
      lines = r.lines; renderLyrics(r);
    });
  }

  function renderLyrics(r) {
    lyr.innerHTML = '';
    if (!r.synced) return lyr.appendChild(h('p', 'dim', 'No synced lyrics found'));
    r.lines.forEach(function (l, i) { var e = h('div', 'ln', esc(l.text || '♪')); e.id = 'ln' + i; lyr.appendChild(e); });
  }

  function toggleLyrics() { lyrOn = !lyrOn; lyr.classList.toggle('hidden', !lyrOn); view.classList.toggle('narrow', lyrOn); }

  function tick() {
    if (track) {
      var p = Math.min(progress(), track.duration);
      bar.querySelector('.cur').textContent = fmt(p);
      bar.querySelector('.fill').style.transform = 'scaleX(' + (p / track.duration) + ')';
      if (lyrOn && lines.length) {
        var i = Lyrics.indexAt(lines, p + Lyrics.offset(track.uri));
        if (i !== lyrIdx) {
          var old = document.getElementById('ln' + lyrIdx), now = document.getElementById('ln' + i);
          if (old) old.classList.remove('on');
          if (now) { now.classList.add('on'); lyr.scrollTop = now.offsetTop - lyr.clientHeight / 2 + now.clientHeight / 2; }
          lyrIdx = i;
        }
      }
    }
    requestAnimationFrame(tick);
  }

  function sync(s) {
    if (!s) return;
    paused = s.paused || s.stopped; pos = s.track ? s.track.position : 0; posAt = Date.now();
    if ((s.track && s.track.uri) !== (track && track.uri)) setTrack(s.track);
  }

  function init() {
    buildSide(); buildBar();
    Api.on('status', sync);
    Api.on('metadata', function (m) { Api.refresh(); });
    ['playing', 'paused', 'seek', 'stopped'].forEach(function (e) { Api.on(e, function (d) { if (d && d.position != null) { pos = d.position; posAt = Date.now(); } paused = e !== 'playing'; if (e !== 'playing') Api.refresh(); }); });
    Focus.on('back', back);
    Focus.on('play', Api.resume); Focus.on('pause', Api.pause);
    Focus.on('ff', Api.next); Focus.on('rw', Api.prev);
    Focus.on('yellow', toggleLyrics);
    Focus.on('red', function () { if (track) { Lyrics.setOffset(track.uri, Lyrics.offset(track.uri) - 250); Ext.toast('Lyrics earlier'); } });
    Focus.on('green', function () { if (track) { Lyrics.setOffset(track.uri, Lyrics.offset(track.uri) + 250); Ext.toast('Lyrics later'); } });
    requestAnimationFrame(tick);
    go('home');
  }

  return { init: init, progress: progress, go: go };
})();
