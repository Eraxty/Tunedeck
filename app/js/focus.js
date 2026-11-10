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

  function scrollTo(p, off) {
    var inner = p.firstElementChild, vert = p.classList.contains('vs');
    p._off = off;
    inner.style.transform = vert ? 'translate3d(0,' + (-off) + 'px,0)' : 'translate3d(' + (-off) + 'px,0,0)';
  }
  function scrollInto(el) {
    var p = el.parentNode;
    while (p && p !== document.body) {
      if (p.classList && (p.classList.contains('vs') || p.classList.contains('hs'))) {
        var inner = p.firstElementChild, vert = p.classList.contains('vs');
        var o = offsetIn(el, inner), view = vert ? p.clientHeight : p.clientWidth, size = vert ? inner.scrollHeight : inner.scrollWidth;
        // Rows have side padding (room for the focus ring) that the cards must not end up under.
        if (!vert) { if (p._pad == null) { var cs = getComputedStyle(p); p._pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight); } view -= p._pad; }
        var pos = vert ? o.y : o.x, len = vert ? o.h : o.w, cur0 = p._off || 0, pad = vert ? 120 : 80, off = cur0;
        // Shelves on a vertical page snap the focused row near the top, like the TV app.
        var row = vert ? el.closest('.shelf') : null;
        if (row && p.contains(row)) { off = offsetIn(row, inner).y - 24; }
        else if (pos - cur0 < pad) off = pos - pad;
        else if (pos + len - cur0 > view - pad) off = pos + len - view + pad;
        off = Math.max(0, Math.min(off, Math.max(0, size - view)));
        if (off !== cur0) scrollTo(p, off);
      }
      p = p.parentNode;
    }
  }

  // fromPointer: hovering focuses without scrolling, so a list never moves under a resting pointer.
  function set(el, fromPointer) {
    if (!el) return;
    if (cur) cur.classList.remove('focus');
    cur = el; el.classList.add('focus');
    var row = el.closest('.hs'); if (row) row._last = el;
    var reg = el.closest('.region'); if (reg) reg._last = el;
    if (!fromPointer) scrollInto(el);
    if (handlers.focus) handlers.focus(el);
  }

  // Skip hidden things: display:none (no offsetParent), disabled, and areas marked aria-hidden (e.g. the
  // Now Playing panel while it is faded out).
  function usable(el) { return el.offsetParent !== null && !el.disabled && !el.closest('[aria-hidden="true"]'); }
  // The visible window of the vertical scroller an element sits in (or the screen).
  function clip(el) {
    var p = el.parentNode;
    while (p && p !== document.body) { if (p.classList && p.classList.contains('vs')) return p.getBoundingClientRect(); p = p.parentNode; }
    return { top: 0, bottom: window.innerHeight };
  }
  function onScreen(el) { var r = el.getBoundingClientRect(), c = clip(el); return r.bottom > c.top + 8 && r.top < c.bottom - 8; }

  // Spatial navigation in the style of the W3C proposal: only elements past the current one in the pressed
  // direction count, the nearest edge-to-edge wins, and elements lined up with the current one (overlapping
  // across the direction) beat diagonal ones.
  function score(dir, c, r) {
    var vert = dir === 'up' || dir === 'down', gap, ov, mid;
    if (dir === 'down') { if (r.top + r.height / 2 <= c.top + c.height / 2 + 2 || r.bottom <= c.bottom - 1) return -1; gap = r.top - c.bottom; }
    else if (dir === 'up') { if (r.top + r.height / 2 >= c.top + c.height / 2 - 2 || r.top >= c.top + 1) return -1; gap = c.top - r.bottom; }
    else if (dir === 'right') { if (r.left + r.width / 2 <= c.left + c.width / 2 + 2 || r.right <= c.right - 1) return -1; gap = r.left - c.right; }
    else { if (r.left + r.width / 2 >= c.left + c.width / 2 - 2 || r.left >= c.left + 1) return -1; gap = c.left - r.right; }
    if (vert) { ov = Math.min(c.right, r.right) - Math.max(c.left, r.left); mid = Math.abs(r.left + r.right - c.left - c.right) / 2; }
    else { ov = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top); mid = Math.abs(r.top + r.bottom - c.top - c.bottom) / 2; }
    return Math.max(0, gap) + (ov > 0 ? 0 : 60 - ov * (vert ? 2 : 3)) + mid * 0.05;
  }

  function move(dir) {
    var all = [].slice.call(root().querySelectorAll('.f')).filter(usable);
    if (!all.length) return;
    if (!cur || all.indexOf(cur) < 0) return set(all[0]);
    // After the pointer wheel scrolled the focused item out of sight, carry on from what is on screen.
    var sc = cur.closest('.vs');
    if (sc && !onScreen(cur)) {
      var vis = all.filter(function (e) { return sc.contains(e) && onScreen(e); });
      if (vis.length) return set(dir === 'up' ? vis[vis.length - 1] : vis[0]);
    }
    var c = cur.getBoundingClientRect(), best = null, bs = Infinity;
    all.forEach(function (el) {
      if (el === cur) return;
      var s = score(dir, c, el.getBoundingClientRect());
      if (s >= 0 && s < bs) { bs = s; best = el; }
    });
    if (!best) return;
    function ok(el) { return el && all.indexOf(el) >= 0; }
    // Entering another area (library, main view, Now Playing, top bar, player bar) returns to where you were,
    // when that spot is on screen and in the pressed direction.
    var reg = best.closest('.region');
    if (reg && reg !== cur.closest('.region') && ok(reg._last) && onScreen(reg._last) && score(dir, c, reg._last.getBoundingClientRect()) >= 0) return set(reg._last);
    if (dir === 'up' || dir === 'down') {
      var row = best.closest('.hs');
      if (row && row !== cur.closest('.hs') && ok(row._last)) best = row._last;
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

  // Pointer (LG Magic Remote): hovering focuses, clicking activates, the wheel scrolls what is under it.
  // Chrome repeats mouse events when content moves under a resting pointer; only real pointer movement
  // counts (a new position, not just after a remote key), or lists would jump around while scrolling.
  var px = -1, py = -1, moved = false, lastKey = 0;
  document.addEventListener('keydown', function () { lastKey = Date.now(); moved = false; }, true);
  document.addEventListener('mousemove', function (e) {
    if (e.clientX === px && e.clientY === py) return;
    px = e.clientX; py = e.clientY; moved = Date.now() - lastKey > 300;
  });
  document.addEventListener('mouseover', function (e) {
    if (!moved) return;
    var el = e.target.closest && e.target.closest('.f');
    if (el && el !== cur && root().contains(el) && usable(el)) set(el, true);
  });
  document.addEventListener('wheel', function (e) {
    var p = e.target.closest && e.target.closest('.vs');
    if (!p || !root().contains(p)) return;
    e.preventDefault();
    var dy = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? p.clientHeight : 1);
    if (!dy) return;
    var inner = p.firstElementChild, step = (dy > 0 ? 1 : -1) * Math.max(90, Math.min(Math.abs(dy), 400));
    var max = Math.max(0, inner.scrollHeight - p.clientHeight), off = Math.max(0, Math.min(max, (p._off || 0) + step));
    if (off !== (p._off || 0)) { scrollTo(p, off); if (handlers.scroll) handlers.scroll(p, off + p.clientHeight >= max - 400); }
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
