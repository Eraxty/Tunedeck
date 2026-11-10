// Spatial D-pad navigation for the TV remote. Picks the nearest .f element in the pressed direction.
var Focus = (function () {
  var KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter', 461: 'back', 8: 'back', 27: 'back',
    415: 'play', 19: 'pause', 413: 'stop', 417: 'ff', 412: 'rw', 403: 'red', 404: 'green', 405: 'yellow', 406: 'blue' };
  var cur = null, handlers = {};

  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }

  function set(el) {
    if (!el) return;
    if (cur) cur.classList.remove('focus');
    cur = el; el.classList.add('focus');
    var sc = el.closest('.scroll');
    if (sc) {
      var r = el.getBoundingClientRect(), s = sc.getBoundingClientRect();
      if (r.top < s.top + 20) sc.scrollTop -= (s.top + 20 - r.top);
      else if (r.bottom > s.bottom - 20) sc.scrollTop += (r.bottom - s.bottom + 20);
      if (r.left < s.left + 20) sc.scrollLeft -= (s.left + 20 - r.left);
      else if (r.right > s.right - 20) sc.scrollLeft += (r.right - s.right + 20);
    }
  }

  function move(dir) {
    var all = [].slice.call(document.querySelectorAll('.f')).filter(visible);
    if (!all.length) return;
    if (!cur || all.indexOf(cur) < 0) return set(all[0]);
    var c = center(cur.getBoundingClientRect()), best = null, bs = Infinity;
    all.forEach(function (el) {
      if (el === cur) return;
      var p = center(el.getBoundingClientRect()), dx = p.x - c.x, dy = p.y - c.y, along, across;
      if (dir === 'left') { along = -dx; across = Math.abs(dy); }
      else if (dir === 'right') { along = dx; across = Math.abs(dy); }
      else if (dir === 'up') { along = -dy; across = Math.abs(dx); }
      else { along = dy; across = Math.abs(dx); }
      if (along <= 4) return;
      var score = along + across * 2.5;
      if (score < bs) { bs = score; best = el; }
    });
    if (best) set(best);
  }

  function key(e) {
    var k = KEYS[e.keyCode];
    if (!k) return;
    if (handlers.any && handlers.any(k, e) === true) { e.preventDefault(); return; }
    if (k === 'enter') { if (cur) { cur.click(); } }
    else if (k === 'left' || k === 'right' || k === 'up' || k === 'down') move(k);
    else if (handlers[k]) handlers[k](e);
    e.preventDefault();
  }

  document.addEventListener('keydown', key);
  return {
    set: set, move: move, on: function (k, fn) { handlers[k] = fn; },
    get current() { return cur; },
    first: function (root) { var el = (root || document).querySelector('.f'); if (el) set(el); }
  };
})();
