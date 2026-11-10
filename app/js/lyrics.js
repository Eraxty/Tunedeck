// Synced lyrics from LRCLIB. Mismatch handling: exact-duration lookup first, then search
// ranked by closeness to the real track length, and a per-track manual offset the user can nudge.
var Lyrics = (function () {
  var cache = {};

  function parseLrc(txt) {
    var out = [];
    txt.split('\n').forEach(function (line) {
      var re = /\[(\d+):(\d+(?:\.\d+)?)\]/g, m, times = [];
      while ((m = re.exec(line))) times.push(parseInt(m[1], 10) * 60000 + Math.round(parseFloat(m[2]) * 1000));
      var text = line.replace(/\[[^\]]*\]/g, '').trim();
      times.forEach(function (t) { out.push({ t: t, text: text }); });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  function getJson(url) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function clean(s) { return s.replace(/\s*[\(\[].*?(remaster|live|version|edit|feat|mono|stereo)[^\)\]]*[\)\]]/ig, '').trim(); }

  function pick(list, durSec) {
    var best = null, bd = Infinity;
    (list || []).forEach(function (r) {
      if (!r.syncedLyrics) return;
      var d = Math.abs((r.duration || 0) - durSec);
      if (d < bd) { bd = d; best = r; }
    });
    return bd <= 6 ? best : null;
  }

  function load(track) {
    var key = track.uri;
    if (cache[key]) return Promise.resolve(cache[key]);
    var dur = Math.round(track.duration / 1000), artist = track.artist_names[0], name = track.name;
    var q = '?track_name=' + encodeURIComponent(name) + '&artist_name=' + encodeURIComponent(artist) +
      '&album_name=' + encodeURIComponent(track.album_name) + '&duration=' + dur;
    return getJson(CFG.lrclib + '/get' + q).then(function (r) {
      if (r && r.syncedLyrics) return r;
      return getJson(CFG.lrclib + '/search?track_name=' + encodeURIComponent(clean(name)) + '&artist_name=' + encodeURIComponent(artist))
        .then(function (list) { return pick(list, dur) || (r && r.plainLyrics ? r : null); });
    }).then(function (r) {
      var res = r && r.syncedLyrics ? { lines: parseLrc(r.syncedLyrics), plain: r.plainLyrics, synced: true } :
        { lines: [], plain: r ? r.plainLyrics : null, synced: false };
      cache[key] = res; return res;
    });
  }

  // Timing: a positive offset shows lyrics earlier. The TV-wide offset covers audio delay from soundbars or
  // Bluetooth and applies to every song; each song can be fine-tuned on top of it. Both are saved.
  function num(k) { try { return parseInt(localStorage.getItem(k) || '0', 10) || 0; } catch (e) { return 0; } }
  function put(k, v) { try { localStorage.setItem(k, String(Math.round(v))); } catch (e) {} }
  function songOffset(uri) { return num('lyr.off.' + uri); }
  function globalOffset() { return num('lyr.global'); }
  function offset(uri) { return songOffset(uri) + globalOffset(); }
  function setOffset(uri, ms) { put('lyr.off.' + uri, Math.max(-10000, Math.min(10000, ms))); }
  function setGlobal(ms) { put('lyr.global', Math.max(-5000, Math.min(5000, ms))); }

  // Binary search for the active line at position pos (ms).
  function indexAt(lines, pos) {
    var lo = 0, hi = lines.length - 1, ans = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (lines[mid].t <= pos) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }

  return { load: load, offset: offset, songOffset: songOffset, setOffset: setOffset, globalOffset: globalOffset, setGlobal: setGlobal, indexAt: indexAt };
})();
