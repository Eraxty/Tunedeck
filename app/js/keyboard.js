// On-screen keyboard for the remote (the system keyboard is unreliable for D-pad search on this TV).
var Keyboard = (function () {
  var ROWS = [
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['h', 'i', 'j', 'k', 'l', 'm', 'n'], ['o', 'p', 'q', 'r', 's', 't', 'u'],
    ['v', 'w', 'x', 'y', 'z', '-', "'"], ['1', '2', '3', '4', '5', '6', '7'], ['8', '9', '0', '&', '.', ',', '!']
  ];
  // opts: { value, onChange(value), onDone(value), doneLabel }
  function create(opts) {
    var value = opts.value || '';
    var el = document.createElement('div');
    el.className = 'kbd';
    var html = '';
    ROWS.forEach(function (r) {
      html += '<div class="kbd-row">' + r.map(function (k) { return '<button class="key f" data-k="' + k + '">' + k + '</button>'; }).join('') + '</div>';
    });
    html += '<div class="kbd-row"><button class="key wide f" data-k=" ">space</button><button class="key f" data-k="del">' + Icon('backspace', 30) + '</button>' +
      '<button class="key f" data-k="clear">clear</button></div>';
    if (opts.onDone) html += '<div class="kbd-row"><button class="key done f" data-k="done">' + (opts.doneLabel || 'Done') + '</button></div>';
    el.innerHTML = html;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('.key'); if (!b) return;
      var k = b.getAttribute('data-k');
      if (k === 'del') value = value.slice(0, -1);
      else if (k === 'clear') value = '';
      else if (k === 'done') return opts.onDone(value);
      else value += k;
      if (opts.onChange) opts.onChange(value);
    });
    // Number keys and letters on a USB/Bluetooth keyboard or the Magic Remote's number pad also type.
    el.typeKey = function (e) {
      if (e.keyCode >= 48 && e.keyCode <= 57 && !e.shiftKey) { value += String(e.keyCode - 48); opts.onChange(value); return true; }
      if (e.keyCode >= 65 && e.keyCode <= 90) { value += String.fromCharCode(e.keyCode + 32); opts.onChange(value); return true; }
      return false;
    };
    el.value = function () { return value; };
    return el;
  }
  return { create: create };
})();
