// Storage scoped to the active profile ("p:<id>:key"), plus global keys for things shared by everyone
// (profile list, match cache, marketplace cache). Every access is guarded: storage can be full or blocked.
var Store = (function () {
  var pid = null;
  function raw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { console.error('storage', k, e); return false; } }
  function parse(s, def) { if (s == null) return def; try { return JSON.parse(s); } catch (e) { return def; } }
  return {
    use: function (id) { pid = id; },
    profile: function () { return pid; },
    get: function (k, def) { return parse(raw('p:' + pid + ':' + k), def); },
    set: function (k, v) { return put('p:' + pid + ':' + k, JSON.stringify(v)); },
    gget: function (k, def) { return parse(raw('g:' + k), def); },
    gset: function (k, v) { return put('g:' + k, JSON.stringify(v)); },
    wipeProfile: function (id) {
      try {
        var del = [];
        for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf('p:' + id + ':') === 0) del.push(k); }
        del.forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) {}
    }
  };
})();

// SHA-256 for PKCE (crypto.subtle is not available to file:// apps on this engine).
function sha256(bytes) {
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
  m.set(bytes); m[l] = 0x80;
  var bits = l * 8; m[n - 4] = bits >>> 24; m[n - 3] = (bits >>> 16) & 255; m[n - 2] = (bits >>> 8) & 255; m[n - 1] = bits & 255;
  var w = new Array(64);
  for (var o = 0; o < n; o += 64) {
    for (var i = 0; i < 16; i++) w[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
    for (i = 16; i < 64; i++) {
      var a = w[i - 15], b = w[i - 2];
      var s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      var s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    var A = H[0], B = H[1], C = H[2], D = H[3], E = H[4], F = H[5], G = H[6], Hh = H[7];
    for (i = 0; i < 64; i++) {
      var S1 = ((E >>> 6) | (E << 26)) ^ ((E >>> 11) | (E << 21)) ^ ((E >>> 25) | (E << 7));
      var t1 = (Hh + S1 + ((E & F) ^ (~E & G)) + K[i] + w[i]) | 0;
      var S0 = ((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10));
      var t2 = (S0 + ((A & B) ^ (A & C) ^ (B & C))) | 0;
      Hh = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
    }
    H[0] = (H[0] + A) | 0; H[1] = (H[1] + B) | 0; H[2] = (H[2] + C) | 0; H[3] = (H[3] + D) | 0;
    H[4] = (H[4] + E) | 0; H[5] = (H[5] + F) | 0; H[6] = (H[6] + G) | 0; H[7] = (H[7] + Hh) | 0;
  }
  var out = new Uint8Array(32);
  for (i = 0; i < 8; i++) { out[i * 4] = H[i] >>> 24; out[i * 4 + 1] = (H[i] >>> 16) & 255; out[i * 4 + 2] = (H[i] >>> 8) & 255; out[i * 4 + 3] = H[i] & 255; }
  return out;
}
