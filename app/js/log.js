// Diagnostics: errors and playback events go to the TV helper (/tmp/tunedeck-app.log on the TV), so problems
// on the TV can be read over SSH. Nothing leaves the TV.
var Log = (function () {
  var q = [], busy = false;
  function flush() {
    if (busy || !q.length) return;
    busy = true;
    var line = q.splice(0, 20).join('\n');
    fetch(CFG.helper + '/api/log', { method: 'POST', body: line }).then(function () { busy = false; flush(); }, function () { busy = false; });
  }
  function add() {
    var parts = [].slice.call(arguments).map(function (a) { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { return String(a); } });
    q.push(parts.join(' ')); if (q.length > 200) q.shift();
    setTimeout(flush, 300);
  }
  window.addEventListener('error', function (e) { add('ERROR', e.message, (e.filename || '').split('/').pop() + ':' + e.lineno); });
  window.addEventListener('unhandledrejection', function (e) { add('REJECTION', e.reason && (e.reason.message || String(e.reason))); });
  add('start', navigator.userAgent);
  return { add: add };
})();
