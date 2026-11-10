// Queue player on a single <audio> element. A track without a `src` is never queued, and repeated stream
// errors stop playback, so it cannot race through a run of unplayable tracks.
var Playback = (function () {
  var audio = new Audio(), queue = [], idx = -1, listeners = {}, errors = 0, context = null;
  var state = { track: null, paused: true, shuffle: false, repeat: 'off', buffering: false };
  audio.preload = 'auto';

  function on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  function emit(type, data) { (listeners[type] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); }

  function load() {
    var t = queue[idx];
    state.track = t || null;
    emit('track', state.track);
    if (!t) { audio.removeAttribute('src'); audio.load(); state.paused = true; emit('state', state); return; }
    state.buffering = true;
    audio.src = Sources.url(t.src);
    var p = audio.play();
    if (p && p.catch) p.catch(function () {});
    emit('played', { track: t, context: context });
  }

  // ctx describes where playback came from ({ kind, id, name, cover }) for "recently played".
  function play(tracks, start, ctx) {
    queue = tracks.filter(function (t) { return t && !!t.src; });
    var first = tracks[start || 0];
    idx = Math.max(0, queue.indexOf(first));
    context = ctx || null; errors = 0;
    if (state.shuffle && start == null) idx = Math.floor(Math.random() * queue.length);
    emit('queue', queue);
    load();
  }

  function step(dir, auto) {
    if (!queue.length) return;
    if (auto && state.repeat === 'track') { audio.currentTime = 0; audio.play(); return; }
    if (state.shuffle && queue.length > 1) {
      var n; do { n = Math.floor(Math.random() * queue.length); } while (n === idx);
      idx = n;
    } else {
      idx += dir;
      if (idx >= queue.length) {
        if (state.repeat === 'all' || !auto) idx = 0;
        else { idx = queue.length - 1; audio.pause(); return; }
      }
      if (idx < 0) idx = queue.length - 1;
    }
    load();
  }

  audio.addEventListener('playing', function () { errors = 0; state.paused = false; state.buffering = false; emit('state', state); });
  audio.addEventListener('waiting', function () { state.buffering = true; emit('state', state); });
  audio.addEventListener('pause', function () { state.paused = true; emit('state', state); });
  audio.addEventListener('ended', function () { step(1, true); });
  audio.addEventListener('error', function () {
    if (!audio.getAttribute('src')) return;
    errors++; state.buffering = false;
    emit('error', { track: state.track, message: 'Could not play this track' });
    if (errors < 3 && queue.length > 1) step(1, true); else { state.paused = true; emit('state', state); }
  });

  function seek(ms) {
    if (!state.track) return;
    var d = duration();
    audio.currentTime = Math.max(0, Math.min(d ? d - 500 : ms, ms)) / 1000;
    emit('seek', ms);
  }
  function duration() { return isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : (state.track ? state.track.duration : 0); }

  return {
    on: on, play: play, state: state, seek: seek, duration: duration,
    toggle: function () { if (!state.track) return; if (audio.paused) audio.play(); else audio.pause(); },
    resume: function () { if (state.track) audio.play(); },
    pause: function () { audio.pause(); },
    next: function () { step(1, false); },
    prev: function () { if (audio.currentTime > 4) seek(0); else step(-1, false); },
    skipBy: function (ms) { seek(audio.currentTime * 1000 + ms); },
    position: function () { return audio.currentTime * 1000; },
    volume: function (v) { if (v != null) { audio.volume = Math.max(0, Math.min(1, v)); emit('volume', audio.volume); } return audio.volume; },
    setShuffle: function (v) { state.shuffle = !!v; emit('state', state); },
    setRepeat: function (v) { state.repeat = v; emit('state', state); },
    enqueue: function (t) { if (t && t.src) { queue.splice(idx + 1, 0, t); emit('queue', queue); if (idx < 0) { idx = 0; load(); } } },
    jump: function (i) { if (queue[i]) { idx = i; load(); } },
    queue: function () { return queue.slice(); }, index: function () { return idx; }, context: function () { return context; }
  };
})();
