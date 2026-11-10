// One player interface over two engines:
//  - Spotify: the official Web Playback SDK. The TV becomes a Spotify Connect device; playback, queue,
//    shuffle and repeat live on Spotify's side and state arrives through player_state_changed.
//  - Audius: a single <audio> element with a local queue (used when the profile has no Spotify account).
var Playback = (function () {
  var listeners = {}, context = null;
  var state = { track: null, paused: true, shuffle: false, repeat: 'off', buffering: false, engine: null };
  function on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  function emit(type, data) { (listeners[type] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); Log.add('listener', type, e.message); } }); }
  function setTrack(t) {
    var changed = (t && t.uri) !== (state.track && state.track.uri);
    state.track = t;
    if (changed) { emit('track', t); if (t) emit('played', { track: t, context: context }); }
  }

  // ---------------- Spotify engine ----------------
  var sp = { player: null, device: null, ready: null, status: 'off', error: '', pos: 0, at: 0, dur: 0, next: [], prev: [] };
  function spTrack(t) {
    if (!t) return null;
    var imgs = (t.album && t.album.images) || [], big = imgs[0] ? imgs[0].url : '', small = imgs.length ? imgs[imgs.length - 1].url : big;
    imgs.forEach(function (i) { if (i.height && i.height <= 300 && i.height >= 200) small = small || i.url; });
    var aid = t.artists && t.artists[0] && t.artists[0].uri ? t.artists[0].uri.split(':')[2] : null;
    return { uri: t.uri, id: t.id, name: t.name, artist_names: (t.artists || []).map(function (a) { return a.name; }), artist_id: aid,
      album_name: t.album ? t.album.name : '', album_id: t.album && t.album.uri ? t.album.uri.split(':')[2] : null,
      album_cover_url: big, cover_big: big, cover_small: small, duration: t.duration_ms || 0, src: { source: 'spotify' } };
  }
  function spInit() {
    if (sp.ready) return sp.ready;
    sp.status = 'loading'; emit('engine', sp);
    sp.ready = new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { fail('Spotify player didn’t start (timed out)'); }, 25000);
      function fail(msg) { clearTimeout(timer); sp.status = 'error'; sp.error = msg; Log.add('sdk fail', msg); emit('engine', sp); sp.ready = null; reject(new Error(msg)); }
      window.onSpotifyWebPlaybackSDKReady = function () {
        Log.add('sdk script ready');
        var p = new window.Spotify.Player({ name: CFG.deviceName, volume: 0.8, getOAuthToken: function (cb) { SpotifyApi.token().then(cb, function (e) { Log.add('token fail', e.message); }); } });
        sp.player = p;
        p.addListener('ready', function (d) { clearTimeout(timer); sp.device = d.device_id; sp.status = 'ready'; Log.add('sdk ready', d.device_id); emit('engine', sp); resolve(d.device_id); });
        p.addListener('not_ready', function (d) { Log.add('sdk not_ready', d.device_id); sp.status = 'loading'; emit('engine', sp); });
        p.addListener('initialization_error', function (e) { fail('This TV’s browser can’t run Spotify playback: ' + e.message); });
        p.addListener('authentication_error', function (e) { fail('Spotify sign-in problem: ' + e.message); });
        p.addListener('account_error', function (e) { fail('Spotify playback needs Premium: ' + e.message); });
        p.addListener('playback_error', function (e) { Log.add('playback_error', e.message); emit('error', { track: state.track, message: 'Spotify couldn’t play this: ' + e.message }); });
        p.addListener('autoplay_failed', function () { Log.add('autoplay_failed'); });
        p.addListener('player_state_changed', spState);
        p.connect().then(function (ok) { Log.add('sdk connect', ok); if (!ok) fail('Spotify player couldn’t connect'); });
      };
      var s = document.createElement('script');
      s.src = 'https://sdk.scdn.co/spotify-player.js';
      s.onerror = function () { fail('Couldn’t load Spotify’s player. Is the TV online?'); };
      document.head.appendChild(s);
    });
    return sp.ready;
  }
  function spState(s) {
    if (!s) { Log.add('state null (playback moved to another device)'); state.paused = true; emit('state', state); return; }
    state.engine = 'spotify';
    sp.pos = s.position; sp.at = Date.now(); sp.dur = s.duration;
    sp.next = (s.track_window.next_tracks || []).map(spTrack); sp.prev = (s.track_window.previous_tracks || []).map(spTrack);
    state.paused = s.paused; state.buffering = !!s.loading; state.shuffle = s.shuffle; state.repeat = ['off', 'all', 'track'][s.repeat_mode] || 'off';
    setTrack(spTrack(s.track_window.current_track));
    emit('state', state); emit('queue');
  }
  function spDev(path) { return path + (path.indexOf('?') < 0 ? '?' : '&') + 'device_id=' + sp.device; }
  function spPlay(body) {
    return spInit().then(function () {
      if (sp.player.activateElement) sp.player.activateElement();
      return SpotifyApi.call('PUT', spDev('/me/player/play'), body);
    }).catch(function (e) {
      Log.add('play fail', e.message, e.code);
      // The device can drop off Spotify's list after the TV sleeps; reconnect once and retry.
      if (e.code === 404 && sp.player) { sp.ready = null; sp.player.disconnect(); sp.player = null; return spPlay(body); }
      emit('error', { track: null, message: e.message });
    });
  }

  // ---------------- Audius engine ----------------
  var audio = new Audio(), queue = [], idx = -1, errors = 0;
  audio.preload = 'auto';
  function auLoad() {
    var t = queue[idx];
    state.engine = 'audius';
    setTrack(t || null);
    if (!t) { audio.removeAttribute('src'); audio.load(); state.paused = true; emit('state', state); return; }
    state.buffering = true;
    audio.src = Sources.url(t.src);
    var p = audio.play(); if (p && p.catch) p.catch(function () {});
  }
  function auStep(dir, auto) {
    if (!queue.length) return;
    if (auto && state.repeat === 'track') { audio.currentTime = 0; audio.play(); return; }
    if (state.shuffle && queue.length > 1) { var n; do { n = Math.floor(Math.random() * queue.length); } while (n === idx); idx = n; }
    else {
      idx += dir;
      if (idx >= queue.length) { if (state.repeat === 'all' || !auto) idx = 0; else { idx = queue.length - 1; audio.pause(); return; } }
      if (idx < 0) idx = queue.length - 1;
    }
    auLoad(); emit('queue');
  }
  audio.addEventListener('playing', function () { errors = 0; state.paused = false; state.buffering = false; emit('state', state); });
  audio.addEventListener('waiting', function () { state.buffering = true; emit('state', state); });
  audio.addEventListener('pause', function () { state.paused = true; emit('state', state); });
  audio.addEventListener('ended', function () { auStep(1, true); });
  audio.addEventListener('error', function () {
    if (!audio.getAttribute('src')) return;
    errors++; state.buffering = false;
    emit('error', { track: state.track, message: 'Could not play this track' });
    if (errors < 3 && queue.length > 1) auStep(1, true); else { state.paused = true; emit('state', state); }
  });

  function isSp() { return state.engine === 'spotify'; }

  // Smooth transitions: the end of a song fades out and the next fades in. A real overlap (like Spotify's
  // Automix) needs two streams at once, which the Web Playback SDK can't do, so this fades one stream.
  var baseVol = 0.8, applied = -1, fadeMs = null, trackAt = 0, fadedOut = false;
  function fadeLength() { if (fadeMs === null) fadeMs = Store.get('fadeMs', 6000); return fadeMs; }
  function applyVolume(v) {
    if (Math.abs(v - applied) < 0.02) return;
    applied = v;
    if (isSp()) { if (sp.player) sp.player.setVolume(Math.max(0.0001, v)); } else audio.volume = v;
  }
  on('track', function () { trackAt = Date.now(); });
  setInterval(function () {
    if (!state.track || state.paused) return;
    var f = fadeLength(), d = duration(), left = d - position(), since = Date.now() - trackAt, v = baseVol;
    if (f && d > f * 3) {
      if (left < f && left > 0) { v = baseVol * Math.max(0.05, left / f); fadedOut = true; }
      else if (fadedOut && since < f) v = baseVol * Math.min(1, 0.05 + since / f);
      else if (since >= f) fadedOut = false;
    }
    applyVolume(v);
  }, 200);

  // ---------------- public ----------------
  // ctx: where playback came from ({ kind, id, uri, name, cover }) for "recently played" and Spotify contexts.
  function play(tracks, start, ctx) {
    context = ctx || null;
    var list = tracks.filter(function (t) { return t && t.src; }), first = tracks[start || 0] || list[0];
    if (!first) return;
    if (first.src.source === 'spotify') {
      if (state.engine === 'audius') audio.pause();
      state.engine = 'spotify';
      var body;
      if (ctx && ctx.uri && /^spotify:(album|playlist|artist):/.test(ctx.uri)) body = start == null ? { context_uri: ctx.uri } : { context_uri: ctx.uri, offset: { uri: first.uri } };
      else {
        var i = Math.max(0, list.indexOf(first)), from = Math.max(0, i - 20), uris = list.slice(from, from + 100).map(function (t) { return t.uri; });
        body = { uris: uris, offset: { position: i - from } };
      }
      return spPlay(body);
    }
    if (state.engine === 'spotify' && sp.player) sp.player.pause();
    queue = list; idx = Math.max(0, queue.indexOf(first)); errors = 0;
    if (state.shuffle && start == null) idx = Math.floor(Math.random() * queue.length);
    auLoad(); emit('queue');
  }
  function playContext(ctx) { context = ctx; state.engine = 'spotify'; return spPlay({ context_uri: ctx.uri }); }
  function position() { return isSp() ? (state.paused ? sp.pos : Math.min(sp.dur, sp.pos + Date.now() - sp.at)) : audio.currentTime * 1000; }
  function duration() { if (isSp()) return sp.dur; return isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : (state.track ? state.track.duration : 0); }
  function seek(ms) {
    if (!state.track) return;
    var d = duration(); ms = Math.max(0, Math.min(d ? d - 500 : ms, ms));
    if (isSp()) { sp.pos = ms; sp.at = Date.now(); if (sp.player) sp.player.seek(Math.round(ms)); }
    else audio.currentTime = ms / 1000;
    emit('seek', ms);
  }

  return {
    on: on, play: play, playContext: playContext, state: state, seek: seek, duration: duration, position: position,
    initSpotify: spInit, spotify: function () { return { status: sp.status, error: sp.error, device: sp.device }; },
    toggle: function () { if (!state.track) return; if (isSp()) sp.player && sp.player.togglePlay(); else if (audio.paused) audio.play(); else audio.pause(); },
    resume: function () { if (!state.track) return; if (isSp()) sp.player && sp.player.resume(); else audio.play(); },
    pause: function () { if (isSp()) sp.player && sp.player.pause(); else audio.pause(); },
    next: function () { if (isSp()) sp.player && sp.player.nextTrack(); else auStep(1, false); },
    prev: function () { if (isSp()) { if (position() > 4000) seek(0); else sp.player && sp.player.previousTrack(); } else if (audio.currentTime > 4) seek(0); else auStep(-1, false); },
    skipBy: function (ms) { seek(position() + ms); },
    volume: function (v) {
      if (v != null) { baseVol = Math.max(0, Math.min(1, v)); applied = -1; applyVolume(baseVol); emit('volume', baseVol); }
      return baseVol;
    },
    fade: function (ms) { if (ms != null) { fadeMs = ms; Store.set('fadeMs', ms); } return fadeLength(); },
    setShuffle: function (v) {
      state.shuffle = !!v; emit('state', state);
      if (isSp() && sp.device) SpotifyApi.call('PUT', spDev('/me/player/shuffle?state=' + !!v)).catch(function (e) { Log.add('shuffle', e.message); });
    },
    setRepeat: function (v) {
      state.repeat = v; emit('state', state);
      if (isSp() && sp.device) SpotifyApi.call('PUT', spDev('/me/player/repeat?state=' + ({ off: 'off', all: 'context', track: 'track' }[v]))).catch(function (e) { Log.add('repeat', e.message); });
    },
    enqueue: function (t) {
      if (!t || !t.src) return;
      if (t.src.source === 'spotify') { spInit().then(function () { return SpotifyApi.call('POST', spDev('/me/player/queue?uri=' + encodeURIComponent(t.uri))); }).then(function () { emit('queue'); }, function (e) { emit('error', { message: e.message }); }); return; }
      queue.splice(idx + 1, 0, t); emit('queue'); if (idx < 0) { idx = 0; auLoad(); }
    },
    jump: function (i) {
      if (isSp()) { var n = 0; (function skip() { if (n++ < i && sp.player) sp.player.nextTrack().then(function () { setTimeout(skip, 250); }); })(); return; }
      if (queue[i]) { idx = i; auLoad(); emit('queue'); }
    },
    queue: function () { return isSp() ? (state.track ? [state.track].concat(sp.next) : []) : queue.slice(); },
    // The full upcoming queue. The SDK only knows the next couple of songs, so Spotify's Web API is asked.
    fullQueue: function () {
      if (!isSp()) return Promise.resolve(queue.slice());
      return SpotifyApi.get('/me/player/queue').then(function (j) {
        var cur = j && j.currently_playing ? Cat.track(j.currently_playing) : state.track;
        return [cur].concat(((j && j.queue) || []).map(function (t) { return Cat.track(t); })).filter(Boolean);
      }, function () { return state.track ? [state.track].concat(sp.next) : []; });
    },
    index: function () { return isSp() ? 0 : idx; }, context: function () { return context; }
  };
})();
