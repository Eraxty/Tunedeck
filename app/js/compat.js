// Small runtime helpers missing from this TV's Chrome 53 that marketplace extensions (and Babel, which converts
// them) expect. Syntax is handled by Babel; these are only library functions.
(function () {
  function def(obj, name, fn) { if (!obj[name]) Object.defineProperty(obj, name, { value: fn, configurable: true, writable: true }); }
  def(Object, 'values', function (o) { return Object.keys(o).map(function (k) { return o[k]; }); });
  def(Object, 'entries', function (o) { return Object.keys(o).map(function (k) { return [k, o[k]]; }); });
  def(Object, 'fromEntries', function (list) { var o = {}; Array.from(list, function (e) { o[e[0]] = e[1]; }); return o; });
  def(Object, 'getOwnPropertyDescriptors', function (o) {
    var out = {}; Reflect.ownKeys(o).forEach(function (k) { out[k] = Object.getOwnPropertyDescriptor(o, k); }); return out;
  });
  function pad(s, n, f, start) {
    s = String(s); f = f === undefined ? ' ' : String(f);
    if (s.length >= n || !f) return s;
    var fill = ''; while (fill.length < n - s.length) fill += f;
    fill = fill.slice(0, n - s.length); return start ? fill + s : s + fill;
  }
  def(String.prototype, 'padStart', function (n, f) { return pad(this, n, f, true); });
  def(String.prototype, 'padEnd', function (n, f) { return pad(this, n, f, false); });
  def(String.prototype, 'trimStart', function () { return this.replace(/^\s+/, ''); });
  def(String.prototype, 'trimEnd', function () { return this.replace(/\s+$/, ''); });
  def(String.prototype, 'replaceAll', function (a, b) { return typeof a === 'string' ? this.split(a).join(b) : this.replace(a, b); });
  def(Array.prototype, 'flat', function (depth) {
    depth = depth === undefined ? 1 : depth;
    return depth < 1 ? this.slice() : this.reduce(function (acc, x) { return acc.concat(Array.isArray(x) ? x.flat(depth - 1) : [x]); }, []);
  });
  def(Array.prototype, 'flatMap', function (fn, self) { return this.map(fn, self).flat(1); });
  def(Array.prototype, 'at', function (i) { i = Math.trunc(i) || 0; return this[i < 0 ? this.length + i : i]; });
  def(Promise.prototype, 'finally', function (fn) {
    return this.then(function (v) { return Promise.resolve(fn()).then(function () { return v; }); },
      function (e) { return Promise.resolve(fn()).then(function () { throw e; }); });
  });
  if (typeof window.globalThis === 'undefined') window.globalThis = window;
  if (!window.queueMicrotask) window.queueMicrotask = function (fn) { Promise.resolve().then(fn); };
})();
