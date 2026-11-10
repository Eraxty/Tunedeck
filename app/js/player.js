// Queue player on a single <audio> element. A track without a `src` is not playable and is never queued,
// so the player cannot fall into skipping through a run of unavailable tracks.
var Playback = (function () {
  var audio = new Audio(), queue = [], idx = -1, listeners = {}, errors = 0;
  var state = { track: null, paused: true, shuffle: false, repeat: 'off' };
  audio.preload = 'auto';

  function on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  function emit(type, data) { (listeners[type] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); }

  function load() {
    var t = queue[idx];
    state.track = t || null;
    emit('track', state.track);
    if (!t) { audio.removeAttribute('src'); audio.load(); state.paused = true; emit('state', state); return; }
    audio.src = Sources.url(t.src);
    var p = audio.play();
    if (p && p.catch) p.catch(function () {});
  }

  function play(tracks, start) {
    queue = tracks.filter(function (t) { return !!t.src; });
    idx = Math.max(0, queue.indexOf(tracks[start || 0]));
    errors = 0;
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
      if (idx >= queue.length) { if (state.repeat === 'all' || !auto) idx = 0; else { idx = queue.length - 1; state.paused = true; emit('state', state); return; } }
      if (idx < 0) idx = queue.length - 1;
    }
    load();
  }

  audio.addEventListener('playing', function () { errors = 0; state.paused = false; emit('state', state); });
  audio.addEventListener('pause', function () { state.paused = true; emit('state', state); });
  audio.addEventListener('ended', function () { step(1, true); });
  audio.addEventListener('error', function () {
    if (!audio.getAttribute('src')) return;
    errors++;
    emit('error', { track: state.track, message: 'Could not play this track' });
    // One bad stream moves on; several in a row means the source is down, so stop instead of cycling.
    if (errors < 3 && queue.length > 1) step(1, true); else { state.paused = true; emit('state', state); }
  });

  return {
    on: on, play: play, state: state,
    toggle: function () { if (!state.track) return; if (audio.paused) audio.play(); else audio.pause(); },
    resume: function () { if (state.track) audio.play(); },
    pause: function () { audio.pause(); },
    next: function () { step(1, false); },
    prev: function () { if (audio.currentTime > 4) audio.currentTime = 0; else step(-1, false); },
    seek: function (ms) { audio.currentTime = ms / 1000; },
    position: function () { return audio.currentTime * 1000; },
    duration: function () { return isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : (state.track ? state.track.duration : 0); },
    volume: function (v) { if (v != null) audio.volume = Math.max(0, Math.min(1, v)); return audio.volume; },
    setShuffle: function (v) { state.shuffle = !!v; emit('state', state); },
    setRepeat: function (v) { state.repeat = v; emit('state', state); },
    queue: function () { return queue.slice(); }, index: function () { return idx; }
  };
})();
