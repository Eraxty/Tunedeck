// D-pad navigation. Focusable elements have class "f". Scrollers are ".vs" (vertical) or ".hs" (horizontal)
// wrapping a single ".in" child that is moved with transforms (cheap on this TV's GPU). Horizontal rows
// remember their last focused item, so moving up/down returns to where you were in that row.
// Layers (full-screen views, keyboard, dialogs) restrict navigation to their own subtree.
var Focus = (function () {
  var KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter', 461: 'back', 8: 'back', 27: 'back',
    415: 'play', 19: 'pause', 413: 'stop', 417: 'ff', 412: 'rw', 403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
    33: 'chup', 34: 'chdown' };
  var cur = null, handlers = {}, layers = [];

  function root() { return layers.length ? layers[layers.length - 1].el : document; }

  // Position of el inside a scroller's .in, ignoring the current transform.
  function offsetIn(el, inner) {
    var x = 0, y = 0, e = el;
    while (e && e !== inner) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  }

  function scrollInto(el) {
    var p = el.parentNode;
    while (p && p !== document.body) {
      if (p.classList && (p.classList.contains('vs') || p.classList.contains('hs'))) {
        var inner = p.firstElementChild, vert = p.classList.contains('vs');
        var o = offsetIn(el, inner), view = vert ? p.clientHeight : p.clientWidth, size = vert ? inner.scrollHeight : inner.scrollWidth;
        var pos = vert ? o.y : o.x, len = vert ? o.h : o.w, cur0 = p._off || 0, pad = vert ? 120 : 80, off = cur0;
        // Shelves on a vertical page snap the focused row near the top, like the TV app.
        var row = vert ? el.closest('.shelf') : null;
        if (row && p.contains(row)) { off = offsetIn(row, inner).y - 24; }
        else if (pos - cur0 < pad) off = pos - pad;
        else if (pos + len - cur0 > view - pad) off = pos + len - view + pad;
        off = Math.max(0, Math.min(off, Math.max(0, size - view)));
        if (off !== cur0) {
          p._off = off;
          inner.style.transform = vert ? 'translate3d(0,' + (-off) + 'px,0)' : 'translate3d(' + (-off) + 'px,0,0)';
        }
      }
      p = p.parentNode;
    }
  }

  function set(el) {
    if (!el) return;
    if (cur) cur.classList.remove('focus');
    cur = el; el.classList.add('focus');
    var row = el.closest('.hs'); if (row) row._last = el;
    var reg = el.closest('.region'); if (reg) reg._last = el;
    scrollInto(el);
    if (handlers.focus) handlers.focus(el);
  }

  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  function move(dir) {
    // Skip hidden things: display:none (no offsetParent), disabled, and areas marked aria-hidden (e.g. the
    // Now Playing panel while it is faded out).
    var all = [].slice.call(root().querySelectorAll('.f')).filter(function (e) { return e.offsetParent !== null && !e.disabled && !e.closest('[aria-hidden="true"]'); });
    if (!all.length) return;
    if (!cur || all.indexOf(cur) < 0) return set(all[0]);
    var c = center(cur.getBoundingClientRect()), best = null, bs = Infinity;
    all.forEach(function (el) {
      if (el === cur) return;
      var r = el.getBoundingClientRect(), p = center(r), dx = p.x - c.x, dy = p.y - c.y, along, across;
      if (dir === 'left') { along = -dx; across = Math.abs(dy); }
      else if (dir === 'right') { along = dx; across = Math.abs(dy); }
      else if (dir === 'up') { along = -dy; across = Math.abs(dx); }
      else { along = dy; across = Math.abs(dx); }
      if (along <= 4) return;
      var score = along + across * (dir === 'up' || dir === 'down' ? 1.2 : 3);
      if (score < bs) { bs = score; best = el; }
    });
    if (!best) return;
    function usable(el) { return el && el.offsetParent && !el.closest('[aria-hidden="true"]') && all.indexOf(el) >= 0; }
    // Entering another area (library, main view, Now Playing, top bar, player bar) returns to where you were.
    var reg = best.closest('.region');
    if (reg && reg !== cur.closest('.region') && usable(reg._last)) { set(reg._last); return; }
    if (dir === 'up' || dir === 'down') {
      var row = best.closest('.hs');
      if (row && row !== cur.closest('.hs') && usable(row._last)) best = row._last;
    }
    set(best);
  }

  function key(e) {
    var k = KEYS[e.keyCode];
    if (!k) return;
    e.preventDefault();
    var top = layers.length ? layers[layers.length - 1] : null;
    if (top && top.key && top.key(k, e) === true) return;
    if (cur && cur._key && cur._key(k, e) === true) return;
    if (handlers.any && handlers.any(k, e) === true) return;
    if (k === 'enter') { if (cur) cur.click(); }
    else if (k === 'left' || k === 'right' || k === 'up' || k === 'down') move(k);
    else if (k === 'back') { if (top && top.back) top.back(); else if (handlers.back) handlers.back(e); }
    else if (handlers[k]) handlers[k](e);
  }
  document.addEventListener('keydown', key);

  // Pointer (LG Magic Remote) support: hovering focuses, clicking activates.
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest && e.target.closest('.f');
    if (el && el !== cur && root().contains(el)) set(el);
  });

  return {
    set: set, move: move, on: function (k, fn) { handlers[k] = fn; },
    get current() { return cur; },
    first: function (scope) { var el = (scope || root()).querySelector('.f.default') || (scope || root()).querySelector('.f'); if (el) set(el); },
    // A layer is { el, back, key }; focus is confined to it until popped. Returns a function that pops it.
    push: function (layer) {
      layer.prev = cur; layers.push(layer);
      return function () {
        var i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1);
        if (layer.prev && document.body.contains(layer.prev)) set(layer.prev); else { cur = null; move('down'); }
      };
    },
    inLayer: function () { return layers.length > 0; },
    resetScroll: function (scroller) { scroller._off = 0; scroller.firstElementChild.style.transform = ''; }
  };
})();
