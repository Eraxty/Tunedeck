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

  // Position of el inside a scroller's .in, measured on screen: both move with the .in's transform (and any
  // slide still running), so the difference is the layout position. Summing offsetTop doesn't work here: the
  // TV's Chrome 53 skips the transformed .in when walking offsetParents and counts the panel's own position
  // too, which made lists scroll too late going up (focus slid under the header and then jumped away).
  function offsetIn(el, inner) {
    var a = el.getBoundingClientRect(), b = inner.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: el.offsetWidth, h: el.offsetHeight };
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
  // Where el will be once its list has finished sliding. A key pressed while the slide is still running (the
  // TV takes a while) must not see the new item as off screen, or focus would jump back across the list.
  var gen = 0;
  function rect(el) {
    var r = el.getBoundingClientRect(), p = el.closest('.vs');
    if (!p) return r;
    if (p._gen !== gen) {
      var m = getComputedStyle(p.firstElementChild).transform, v = m && m !== 'none' ? m.slice(m.indexOf('(') + 1, -1).split(',') : null;
      p._gen = gen; p._drift = (v ? -parseFloat(v[v.length === 16 ? 13 : 5]) : 0) - (p._off || 0);
    }
    if (!p._drift) return r;
    return { left: r.left, right: r.right, width: r.width, height: r.height, top: r.top + p._drift, bottom: r.bottom + p._drift };
  }
  function onScreen(el) { var r = rect(el), c = clip(el); return r.bottom > c.top + 8 && r.top < c.bottom - 8; }
  // The part of el that can be seen (a card half under a panel edge counts only by its visible half).
  function seen(el) {
    var r = rect(el), c = clip(el), top = Math.max(r.top, c.top), bottom = Math.min(r.bottom, c.bottom);
    return { left: r.left, right: r.right, width: r.width, top: top, bottom: bottom, height: Math.max(0, bottom - top) };
  }

  // Spatial navigation in the style of the W3C proposal: only elements past the current one in the pressed
  // direction count, the nearest edge-to-edge wins, and elements lined up with the current one (overlapping
  // across the direction) beat diagonal ones.
  function score(dir, c, r) {
    var vert = dir === 'up' || dir === 'down', gap, ov, mid;
    // A candidate must lie past the current element in that direction, give or take a few pixels of overlap
    // (a big cover that merely starts further left is not "to the left" of a small icon above it).
    var tv = Math.min(16, c.height / 2), th = Math.min(16, c.width / 2);
    if (dir === 'down') { if (r.top < c.bottom - tv) return -1; gap = r.top - c.bottom; }
    else if (dir === 'up') { if (r.bottom > c.top + tv) return -1; gap = c.top - r.bottom; }
    else if (dir === 'right') { if (r.left < c.right - th) return -1; gap = r.left - c.right; }
    else { if (r.right > c.left + th) return -1; gap = c.left - r.right; }
    // Lined-up items are ranked by centre or left edge, whichever is closer (a wide header lands on the first chip).
    if (vert) { ov = Math.min(c.right, r.right) - Math.max(c.left, r.left); mid = Math.min(Math.abs(r.left + r.right - c.left - c.right) / 2, Math.abs(r.left - c.left)); }
    else { ov = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top); mid = Math.abs(r.top + r.bottom - c.top - c.bottom) / 2; }
    return Math.max(0, gap) + (ov > 0 ? 0 : 60 - ov * (vert ? 2 : 3)) + mid * 0.05;
  }

  function move(dir) {
    var all = [].slice.call(root().querySelectorAll('.f')).filter(usable);
    if (!all.length) return;
    if (!cur || all.indexOf(cur) < 0) return set(all[0]);
    gen++;
    // After the pointer wheel scrolled the focused item out of sight, carry on from what is on screen.
    var sc = cur.closest('.vs');
    if (sc && !onScreen(cur)) {
      var vis = all.filter(function (e) { return sc.contains(e) && onScreen(e); });
      if (vis.length) return set(dir === 'up' ? vis[vis.length - 1] : vis[0]);
    }
    var c = seen(cur), best = null, bs = Infinity, inBest = null, ibs = Infinity;
    all.forEach(function (el) {
      if (el === cur) return;
      var mine = sc && sc.contains(el);
      // Items scrolled out of sight count only inside the list you are in (moving there scrolls them in);
      // elsewhere they are hidden behind a panel edge and focusing them would look like focus vanished.
      if (!mine && !onScreen(el)) return;
      var s = score(dir, c, mine && !onScreen(el) ? rect(el) : seen(el));
      if (s < 0) return;
      if (s < bs) { bs = s; best = el; }
      if (mine && s < ibs) { ibs = s; inBest = el; }
    });
    // Up and down keep going through the list you are in, even when its next item is a scroll away and
    // something in a neighbouring panel is closer; you leave the list at its ends.
    if (inBest && (dir === 'up' || dir === 'down')) best = inBest;
    if (!best) return;
    function ok(el) { return el && all.indexOf(el) >= 0; }
    // Entering another panel (library, main view, Now Playing) returns to where you were, when that spot is on
    // screen and in the pressed direction. The top bar and player bar are toolbars: always the nearest button.
    var reg = best.closest('.region');
    if (reg && reg.id !== 'top' && reg.id !== 'bar' && reg !== cur.closest('.region') && ok(reg._last) && onScreen(reg._last) && score(dir, c, seen(reg._last)) >= 0) return set(reg._last);
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
  // After a remote key, hovering takes over again only once the pointer really travels: the Magic Remote
  // reports small movements while it is held still, and a list sliding under a resting pointer puts a new
  // row under it. Either would pull focus to that row while you are moving with the arrow keys.
  var shown = true, pointing = true, ax = 0, ay = 0, lastKey = 0;
  document.addEventListener('cursorStateChange', function (e) { shown = !(e.detail && e.detail.visibility === false); if (!shown) pointing = false; });
  document.addEventListener('keydown', function () { lastKey = Date.now(); pointing = false; ax = -1; }, true);
  document.addEventListener('mousemove', function (e) {
    if (!shown) return;
    if (!pointing) {
      if (ax < 0) { ax = e.clientX; ay = e.clientY; return; }
      if (Math.abs(e.clientX - ax) + Math.abs(e.clientY - ay) < 40 || Date.now() - lastKey < 300) return;
      pointing = true;
    }
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
