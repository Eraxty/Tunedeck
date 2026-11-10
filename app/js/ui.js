var UI = (function () {
  var $ = function (s) { return document.querySelector(s); };
  var view = $('#view'), side = $('#sidebar'), bar = $('#player'), lyr = $('#lyrics-pane');
  var track = null, lines = [], lyrIdx = -2, lyrOn = false, history = [], els = {};
  var PAGE = 80;

  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(ms) { var s = Math.floor((ms || 0) / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function ago(t) { if (!t) return 'never'; var m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; }
  var ORIGIN = { spotify: 'Spotify', 'spotify-export': 'Spotify export', 'youtube-export': 'YouTube' };

  var NAV = [['home', 'Home'], ['search', 'Search'], ['library', 'Your Library'], ['queue', 'Queue'], ['import', 'Import & Sync'], ['ext', 'Themes & Plugins']];

  function buildSide() {
    side.innerHTML = '<div class="logo">TuneDeck</div>';
    NAV.forEach(function (n) {
      var b = h('button', 'nav f', esc(n[1])); b.onclick = function () { go(n[0]); }; b.dataset.id = n[0]; side.appendChild(b);
    });
  }

  function go(id, arg, noPush) {
    if (!noPush) history.push([id, arg]);
    if (history.length > 30) history.shift();
    [].forEach.call(side.children, function (b) { b.classList.toggle('active', b.dataset && b.dataset.id === id); });
    document.body.classList.toggle('nowplaying', id === 'now');
    view.innerHTML = '';
    var body = h('div', 'page scroll'); view.appendChild(body);
    (VIEWS[id] || VIEWS.home)(body, arg);
    setTimeout(function () { Focus.first(view); }, 0);
  }

  function back() {
    if (history.length > 1) { history.pop(); var p = history[history.length - 1]; go(p[0], p[1], true); }
  }

  function card(title, sub, img, onClick) {
    var c = h('button', 'card f');
    c.innerHTML = '<div class="art"' + (img ? ' style="background-image:url(' + esc(img) + ')"' : '') + '></div><div class="t">' + esc(title) + '</div><div class="s">' + esc(sub) + '</div>';
    c.onclick = onClick; return c;
  }

  // Track rows rendered a page at a time: focusing the last rendered row appends the next page, so a
  // 2,000-song playlist never puts 2,000 nodes on this TV at once.
  function trackList(parent, items, onPick, rowHtml) {
    var list = h('div', 'list'), shown = 0;
    parent.appendChild(list);
    function more() {
      var end = Math.min(items.length, shown + PAGE);
      for (var i = shown; i < end; i++) (function (i) {
        var b = h('button', 'row f', rowHtml(items[i], i));
        b.onclick = function () { onPick(i); };
        if (i === end - 1 && end < items.length) b.dataset.more = '1';
        list.appendChild(b);
      })(i);
      shown = end;
    }
    list.more = function (el) { if (el.dataset.more) { delete el.dataset.more; more(); } };
    more();
    return list;
  }

  function songRow(t, i) {
    return '<span class="i">' + (i + 1) + '</span><span class="n">' + esc(t.name) + '</span><span class="d">' + esc(t.artist_names.join(', ')) + '</span><span class="len">' + fmt(t.duration) + '</span>';
  }

  var VIEWS = {
    home: function (body) {
      body.appendChild(h('h1', null, 'Good to see you'));
      var mine = Library.playlists();
      if (mine.length) {
        body.appendChild(h('h2', null, 'Your playlists'));
        var row = h('div', 'cards'); body.appendChild(row);
        mine.slice(0, 12).forEach(function (p) { row.appendChild(card(p.name, p.songs.length + ' songs · ' + (ORIGIN[p.origin] || ''), p.cover, function () { go('playlist', p.id); })); });
      }
      body.appendChild(h('h2', null, 'Trending now'));
      var tr = h('div', 'cards'); body.appendChild(tr);
      tr.appendChild(h('p', 'dim', 'Loading…'));
      Sources.trending(18).then(function (ts) {
        tr.innerHTML = '';
        ts.forEach(function (t, i) { tr.appendChild(card(t.name, t.artist_names[0], t.album_cover_url, function () { Playback.play(ts, i); })); });
      }, function (e) { tr.innerHTML = ''; tr.appendChild(h('p', 'dim', esc(e.message))); });
    },

    search: function (body) {
      body.appendChild(h('h1', null, 'Search'));
      var inp = h('input', 'f'); inp.placeholder = 'Songs or artists'; body.appendChild(inp);
      var res = h('div'); body.appendChild(res);
      inp.onchange = function () {
        if (!inp.value.trim()) return;
        res.innerHTML = '<p class="dim">Searching…</p>';
        Sources.search(inp.value, 30).then(function (ts) {
          res.innerHTML = '';
          if (!ts.length) return res.appendChild(h('p', 'dim', 'No results'));
          trackList(res, ts, function (i) { Playback.play(ts, i); }, songRow);
        }, function (e) { res.innerHTML = ''; res.appendChild(h('p', 'dim', esc(e.message))); });
      };
    },

    library: function (body) {
      body.appendChild(h('h1', null, 'Your Library'));
      var pls = Library.playlists();
      if (!pls.length) {
        body.appendChild(h('p', 'dim', 'Nothing here yet. Connect Spotify or import a Spotify / YouTube export.'));
        var b = h('button', 'btn f', 'Import & Sync'); b.onclick = function () { go('import'); }; body.appendChild(b);
        return;
      }
      trackList(body, pls, function (i) { go('playlist', pls[i].id); }, function (p) {
        return '<span class="n">' + esc(p.name) + '</span><span class="d">' + esc(ORIGIN[p.origin] || '') + ' · ' + p.songs.length + ' songs</span>';
      });
    },

    playlist: function (body, id) {
      var p = Library.get(id);
      if (!p) return body.appendChild(h('p', 'dim', 'Playlist not found'));
      body.appendChild(h('h1', null, esc(p.name)));
      var info = h('p', 'dim', esc(ORIGIN[p.origin] || '') + ' · ' + p.songs.length + ' songs · finding playable versions…');
      body.appendChild(info);
      var play = h('button', 'btn f', 'Play'); body.appendChild(play);
      var found = p.songs.map(function (s) { var t = Library.cached(s); return t ? withOrig(t, s) : t; });
      var tracks = p.songs.map(function (s, i) {
        return { name: s.name, artist_names: [s.artist], duration: s.duration, i: i };
      });
      function playFrom(i) {
        var q = found.filter(Boolean);
        var start = found[i] ? q.indexOf(found[i]) : 0;
        if (!q.length) return Ext.toast('No playable versions found yet');
        Playback.play(q, Math.max(0, start));
        if (!found[i]) Ext.toast('That song is not available, playing the next one');
      }
      play.onclick = function () { playFrom(0); };
      var list = trackList(body, tracks, playFrom, function (t, i) {
        return songRow(t, i).replace('class="n"', 'class="n" id="pn' + i + '"');
      });
      list.id = 'pl-list';
      function mark(i) {
        var el = document.getElementById('pn' + i);
        if (el) el.parentNode.classList.toggle('missing', found[i] === null);
      }
      found.forEach(function (t, i) { if (t !== undefined) mark(i); });
      Library.resolve(p.songs, function (i, t) {
        found[i] = t ? withOrig(t, p.songs[i]) : null; mark(i);
      }).then(function () {
        var ok = found.filter(Boolean).length;
        if (info.parentNode) info.textContent = (ORIGIN[p.origin] || '') + ' · ' + ok + ' of ' + p.songs.length + ' songs playable';
      });
    },

    queue: function (body) {
      body.appendChild(h('h1', null, 'Queue'));
      var q = Playback.queue(), cur = Playback.index();
      if (!q.length) return body.appendChild(h('p', 'dim', 'Nothing queued'));
      trackList(body, q, function (i) { Playback.play(q, i); }, function (t, i) {
        return songRow(t, i).replace('class="i"', 'class="i' + (i === cur ? ' playing' : '') + '"');
      });
    },

    now: function (body) {
      var t = Playback.state.track;
      body.appendChild(h('div', 'np-art', ''));
      var meta = h('div', 'np-meta', ''); body.appendChild(meta);
      function fill() {
        var tr = Playback.state.track;
        body.querySelector('.np-art').style.backgroundImage = tr && tr.album_cover_url ? 'url(' + tr.album_cover_url + ')' : '';
        meta.innerHTML = '<div class="np-title">' + esc(tr ? tr.name : 'Nothing playing') + '</div><div class="np-artist">' + esc(tr ? tr.artist_names.join(', ') : '') + '</div>';
      }
      fill(); VIEWS.now.fill = fill;
      if (!lyrOn) toggleLyrics();
    },

    import: function (body) {
      body.appendChild(h('h1', null, 'Import & Sync'));
      body.appendChild(h('h2', null, 'Spotify account'));
      body.appendChild(h('p', 'dim', WebApi.loggedIn() ? 'Connected · last synced ' + ago(Library.syncedAt()) + ' · syncs automatically every 6 hours' :
        'Not connected. On the laptop run: node scripts/login.js'));
      var st = h('p', 'dim'); 
      if (WebApi.loggedIn()) {
        var b = h('button', 'btn f', 'Sync now'); body.appendChild(b); body.appendChild(st);
        b.onclick = function () {
          Library.syncSpotify(function (m) { st.textContent = m; }).then(function (r) {
            st.textContent = 'Synced ' + r.playlists + ' playlists' + (r.skipped ? ' (' + r.skipped + ' followed playlists skipped: Spotify only shares ones you own)' : '');
          }, function (e) { st.textContent = e.message; });
        };
      }
      body.appendChild(h('h2', null, 'Spotify or YouTube export'));
      body.appendChild(h('p', 'dim', 'Last import: ' + ago(Library.importedAt()) + '. Download your data from Spotify (Privacy settings) or Google Takeout (YouTube and YouTube Music), unzip it, then on the laptop run: node scripts/import.js &lt;folder&gt;'));
      body.appendChild(h('h2', null, 'Playable versions'));
      body.appendChild(h('p', 'dim', 'Songs play from Audius, a free open music platform. Songs with no matching upload there are greyed out.'));
      var c = h('button', 'btn f', 'Re-match all songs'); body.appendChild(c);
      c.onclick = function () { Library.clearMatches(); Ext.toast('Matches cleared, they will be found again'); };
    },

    ext: function (body) {
      var d = Ext.db();
      body.appendChild(h('h1', null, 'Themes & Plugins'));
      body.appendChild(h('p', 'dim', 'Install by URL (raw .css / .js). Spicetify color.ini schemes and simple Spicetify extensions work.'));
      function installer(label, fn) {
        var inp = h('input', 'f'); inp.placeholder = label + ' URL'; var b = h('button', 'btn f', 'Install ' + label);
        b.onclick = function () { fn(inp.value).then(function () { Ext.toast(label + ' installed'); go('ext', null, true); }, function (e) { Ext.toast('Failed: ' + e.message); }); };
        body.appendChild(inp); body.appendChild(b);
      }
      installer('theme', function (u) { return Ext.installTheme(u.split('/').slice(-2)[0] || 'theme', u); });
      installer('plugin', function (u) { return Ext.installPlugin(u.split('/').pop(), u); });
      var list = h('div', 'list'); body.appendChild(list);
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

  // Keeps the library song's real title/artist with the matched upload, so lyrics look up the actual song.
  function withOrig(t, s) {
    var c = {}; for (var k in t) c[k] = t[k];
    c.orig = s; return c;
  }

  function buildBar() {
    bar.innerHTML = '<button class="np f"><div class="cover"></div><div class="meta"><div class="title"></div><div class="artist"></div></div></button>' +
      '<div class="ctl"><div class="btns"></div><div class="seek"><span class="cur">0:00</span><div class="track"><div class="fill"></div></div><span class="dur">0:00</span></div></div>' +
      '<div class="right"></div>';
    bar.querySelector('.np').onclick = function () { go('now'); };
    var btns = bar.querySelector('.btns');
    els.shuffle = h('button', 'ico f small', '⇄'); els.shuffle.onclick = function () { Playback.setShuffle(!Playback.state.shuffle); };
    els.play = h('button', 'ico f big', '▶'); els.play.onclick = Playback.toggle;
    els.repeat = h('button', 'ico f small', '↻'); els.repeat.onclick = function () {
      var order = ['off', 'all', 'track']; Playback.setRepeat(order[(order.indexOf(Playback.state.repeat) + 1) % 3]);
    };
    [els.shuffle, mk('⏮', Playback.prev), els.play, mk('⏭', Playback.next), els.repeat].forEach(function (e) { btns.appendChild(e); });
    var right = bar.querySelector('.right');
    right.appendChild(mk('♪', toggleLyrics));
    Ext.topbar().forEach(function (t) { right.appendChild(mk(esc(t.label), t.onClick)); });
    els.cur = bar.querySelector('.cur'); els.dur = bar.querySelector('.dur'); els.fill = bar.querySelector('.fill');
    function mk(label, fn) { var e = h('button', 'ico f', label); e.onclick = fn; return e; }
  }

  function setState(s) {
    els.play.textContent = s.paused ? '▶' : '⏸';
    els.shuffle.classList.toggle('on', s.shuffle);
    els.repeat.classList.toggle('on', s.repeat !== 'off');
    els.repeat.textContent = s.repeat === 'track' ? '↻1' : '↻';
  }

  function setTrack(t) {
    track = t;
    bar.querySelector('.title').textContent = t ? t.name : '';
    bar.querySelector('.artist').textContent = t ? t.artist_names.join(', ') : '';
    bar.querySelector('.cover').style.backgroundImage = t && t.album_cover_url ? 'url(' + t.album_cover_url + ')' : '';
    els.dur.textContent = fmt(t ? t.duration : 0);
    if (VIEWS.now.fill && document.body.classList.contains('nowplaying')) VIEWS.now.fill();
    lines = []; lyrIdx = -2; lyr.innerHTML = '';
    if (!t) return;
    var o = t.orig;
    var meta = o ? { uri: t.uri, name: o.name, artist_names: [o.artist.split(',')[0]], album_name: o.album, duration: t.duration } : t;
    lyr.appendChild(h('p', 'dim', 'Loading lyrics…'));
    Lyrics.load(meta).then(function (r) {
      if (!track || track.uri !== t.uri) return;
      lines = r.lines; renderLyrics(r);
    });
  }

  function renderLyrics(r) {
    lyr.innerHTML = '';
    if (!r.synced) return lyr.appendChild(h('p', 'dim', 'No synced lyrics found'));
    var frag = document.createDocumentFragment();
    r.lines.forEach(function (l, i) { var e = h('div', 'ln', esc(l.text || '♪')); e.id = 'ln' + i; frag.appendChild(e); });
    lyr.appendChild(frag);
  }

  function toggleLyrics() { lyrOn = !lyrOn; lyr.parentNode.classList.toggle('hidden', !lyrOn); view.classList.toggle('narrow', lyrOn); lyrIdx = -2; }

  var lastSec = -1;
  function tick() {
    if (track) {
      var p = Playback.position(), d = Playback.duration();
      var sec = Math.floor(p / 1000);
      if (sec !== lastSec) { lastSec = sec; els.cur.textContent = fmt(p); els.dur.textContent = fmt(d); }
      els.fill.style.transform = 'scaleX(' + (d ? Math.min(1, p / d) : 0) + ')';
      if (lyrOn && lines.length) {
        var i = Lyrics.indexAt(lines, p + Lyrics.offset(track.uri));
        if (i !== lyrIdx) {
          var old = document.getElementById('ln' + lyrIdx), now = document.getElementById('ln' + i);
          if (old) old.classList.remove('on');
          if (now) { now.classList.add('on'); lyr.style.transform = 'translateY(' + Math.round(lyr.parentNode.clientHeight / 2 - now.offsetTop - now.clientHeight / 2) + 'px)'; }
          lyrIdx = i;
        }
      }
    }
    requestAnimationFrame(tick);
  }

  function autoSync() {
    if (WebApi.loggedIn() && Date.now() - Library.syncedAt() > CFG.syncEveryMs) {
      Library.syncSpotify().then(function (r) { Ext.toast('Spotify library synced (' + r.playlists + ' playlists)'); }, function (e) { console.warn('sync', e.message); });
    }
  }

  function init() {
    buildSide(); buildBar();
    Playback.on('track', setTrack);
    Playback.on('state', setState);
    Playback.on('error', function (e) { Ext.toast(e.message + (e.track ? ': ' + e.track.name : '')); });
    Focus.on('focus', function (el) { var l = el.parentNode; if (l && l.more) l.more(el); });
    Focus.on('back', back);
    Focus.on('play', Playback.resume); Focus.on('pause', Playback.pause);
    Focus.on('ff', Playback.next); Focus.on('rw', Playback.prev);
    Focus.on('yellow', toggleLyrics);
    Focus.on('blue', function () { go('now'); });
    Focus.on('red', function () { if (track) { Lyrics.setOffset(track.uri, Lyrics.offset(track.uri) - 250); Ext.toast('Lyrics earlier (' + Lyrics.offset(track.uri) + ' ms)'); } });
    Focus.on('green', function () { if (track) { Lyrics.setOffset(track.uri, Lyrics.offset(track.uri) + 250); Ext.toast('Lyrics later (+' + Lyrics.offset(track.uri) + ' ms)'); } });
    if (Library.applyImport()) Ext.toast('Imported library loaded');
    requestAnimationFrame(tick);
    go('home');
    autoSync(); setInterval(autoSync, 30 * 60000);
  }

  return { init: init, go: go };
})();
