var Api = (function () {
  var listeners = {};
  var sock = null, retry = 500;
  var state = { status: null, connected: false };

  function req(method, path, body) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open(method, CFG.api + path);
      x.setRequestHeader('Content-Type', 'application/json');
      x.onload = function () {
        if (x.status === 204) return resolve(null);
        if (x.status >= 200 && x.status < 300) {
          try { resolve(x.responseText ? JSON.parse(x.responseText) : null); } catch (e) { resolve(null); }
        } else reject(new Error(x.status + ' ' + path));
      };
      x.onerror = function () { reject(new Error('network ' + path)); };
      x.send(body ? JSON.stringify(body) : null);
    });
  }

  function on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  function emit(type, data) { (listeners[type] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); }

  function refresh() {
    return req('GET', '/status').then(function (s) { state.status = s; emit('status', s); return s; }, function () {});
  }

  function connect() {
    sock = new WebSocket(CFG.ws);
    sock.onopen = function () { retry = 500; state.connected = true; emit('connection', true); refresh(); };
    sock.onclose = function () {
      state.connected = false; emit('connection', false);
      setTimeout(connect, retry); retry = Math.min(retry * 2, 8000);
    };
    sock.onmessage = function (m) {
      var ev; try { ev = JSON.parse(m.data); } catch (e) { return; }
      emit(ev.type, ev.data);
      emit('*', ev);
    };
  }

  return {
    state: state, on: on, connect: connect, refresh: refresh,
    get: function (p) { return req('GET', p); },
    post: function (p, b) { return req('POST', p, b || {}); },
    play: function (uri, skipTo) { return req('POST', '/player/play', { uri: uri, skip_to_uri: skipTo || undefined }); },
    pause: function () { return req('POST', '/player/pause'); },
    resume: function () { return req('POST', '/player/resume'); },
    toggle: function () { return req('POST', '/player/playpause'); },
    next: function () { return req('POST', '/player/next'); },
    prev: function () { return req('POST', '/player/prev'); },
    seek: function (ms) { return req('POST', '/player/seek', { position: ms }); },
    volume: function (v) { return req('POST', '/player/volume', { volume: v }); },
    shuffle: function (v) { return req('POST', '/player/shuffle_context', { shuffle_context: v }); },
    repeatContext: function (v) { return req('POST', '/player/repeat_context', { repeat_context: v }); },
    repeatTrack: function (v) { return req('POST', '/player/repeat_track', { repeat_track: v }); },
    queue: function (uri) { return req('POST', '/player/add_to_queue', { uri: uri }); },
    playlists: function () { return req('GET', '/library/playlists?limit=500'); },
    tracks: function (uri) { return req('GET', '/context/tracks?uri=' + encodeURIComponent(uri)); },
    liked: function (uris) { return req('GET', '/library/liked?uris=' + encodeURIComponent(uris.join(','))); },
    setLiked: function (uris, liked) { return req('POST', '/library/liked', { uris: uris, liked: liked }); }
  };
})();
