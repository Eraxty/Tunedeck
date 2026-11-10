// TuneDeck helper, runs on the TV (Node 0.12, so ES5 only).
// - http://<tv>:8899/      phone page (opened from the QR code): upload Spotify / YouTube exports, Spotify login
// - https://<tv>:8900/callback   Spotify OAuth redirect target (self-signed cert; Spotify requires HTTPS)
// - http://127.0.0.1:8899/api/*  the TV app polls this for imports and login results
'use strict';
var http = require('http'), https = require('https'), fs = require('fs'), os = require('os'), zlib = require('zlib'), url = require('url'), path = require('path');

var DIR = __dirname, DATA = path.join(DIR, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);
var MAX_UPLOAD = 200 * 1024 * 1024;

var pending = { imports: [], login: null, loginResult: null, clientIdUpdate: null };

function lanIp() {
  var ifs = os.networkInterfaces(), best = null;
  Object.keys(ifs).forEach(function (n) {
    ifs[n].forEach(function (a) {
      if (a.family === 'IPv4' && !a.internal && !best) best = a.address;
    });
  });
  return best || '127.0.0.1';
}

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, cb) {
  var chunks = [], size = 0, dead = false;
  req.on('data', function (c) {
    size += c.length;
    if (size > MAX_UPLOAD) { dead = true; cb(new Error('File too large')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', function () { if (!dead) cb(null, Buffer.concat(chunks)); });
}

function isLocal(req) { var a = req.socket.remoteAddress || ''; return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; }

// --- zip reading (central directory; stored and deflated entries) ---
function unzip(buf, want) {
  var out = {}, eocd = -1;
  for (var i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  var count = buf.readUInt16LE(eocd + 10), p = buf.readUInt32LE(eocd + 16);
  for (var n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    var method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    var nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    var off = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (!want(name)) continue;
    var lnlen = buf.readUInt16LE(off + 26), lelen = buf.readUInt16LE(off + 28);
    var data = buf.slice(off + 30 + lnlen + lelen, off + 30 + lnlen + lelen + csize);
    if (method === 8) data = zlib.inflateRawSync(data);
    else if (method !== 0) continue;
    out[name] = data.toString('utf8').replace(/^﻿/, '');
  }
  return out;
}

function wanted(name) {
  var b = path.basename(name);
  return /^YourLibrary\.json$/i.test(b) || /^Playlist\d*\.json$/i.test(b) || /\.csv$/i.test(b);
}

// Files are queued raw; the TV app parses them (it can also look up YouTube titles, which old Node can't).
function queueFiles(files, from) {
  var names = Object.keys(files);
  if (!names.length) throw new Error('No Spotify or YouTube library files found in that upload');
  var item = { id: Date.now(), from: from, files: files };
  pending.imports.push(item);
  fs.writeFileSync(path.join(DATA, 'import-' + item.id + '.json'), JSON.stringify(item));
  return names.length;
}

function loadQueued() {
  fs.readdirSync(DATA).forEach(function (f) {
    if (/^import-\d+\.json$/.test(f)) {
      try { pending.imports.push(JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'))); } catch (e) {}
    }
  });
}

function handleUpload(req, res, q) {
  readBody(req, function (err, buf) {
    if (err) return send(res, 413, { error: err.message });
    try {
      var name = String(q.name || 'upload'), files = {};
      if (/\.zip$/i.test(name) || (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50)) files = unzip(buf, wanted);
      else if (wanted(name)) files[name] = buf.toString('utf8').replace(/^﻿/, '');
      var n = queueFiles(files, name);
      send(res, 200, { ok: true, files: n });
    } catch (e) { send(res, 400, { error: e.message }); }
  });
}

function api(req, res, u) {
  var q = u.query;
  if (u.pathname === '/api/info') return send(res, 200, { ip: lanIp(), phoneUrl: 'http://' + lanIp() + ':8899/', callback: 'https://' + lanIp() + ':8900/callback' });
  if (u.pathname === '/api/upload' && req.method === 'POST') return handleUpload(req, res, q);
  // Phone: is a Spotify login waiting on the TV, and with which app key?
  if (u.pathname === '/api/login/status') return send(res, 200, { pending: !!(pending.login && pending.login.url), clientId: pending.login ? pending.login.clientId || null : null });
  // Phone: hand the TV the person's own Spotify app key (Client ID); the TV restarts its login with it.
  if (u.pathname === '/api/clientid' && req.method === 'POST') {
    return readBody(req, function (err, buf) {
      var id = '';
      try { id = String(JSON.parse(buf.toString('utf8')).clientId || '').trim(); } catch (e) {}
      if (!/^[0-9a-f]{32}$/i.test(id)) return send(res, 400, { error: 'That doesn’t look like a Client ID. It is 32 letters and numbers.' });
      if (!pending.login) return send(res, 409, { error: 'Start “Sign in with Spotify” on the TV first.' });
      pending.clientIdUpdate = id.toLowerCase();
      send(res, 200, { ok: true });
    });
  }
  if (!isLocal(req)) return send(res, 403, { error: 'TV only' });
  if (u.pathname === '/api/log' && req.method === 'POST') {
    return readBody(req, function (err, buf) {
      try {
        var f = '/tmp/tunedeck-app.log';
        if (fs.existsSync(f) && fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f + '.1');
        fs.appendFileSync(f, new Date().toISOString() + ' ' + buf.toString('utf8').slice(0, 4000) + '\n');
      } catch (e) {}
      send(res, 200, { ok: true });
    });
  }
  if (u.pathname === '/api/imports') return send(res, 200, pending.imports.map(function (i) { return { id: i.id, from: i.from, files: i.files }; }));
  if (u.pathname === '/api/imports/done' && req.method === 'POST') {
    pending.imports = pending.imports.filter(function (i) { return String(i.id) !== String(q.id); });
    try { fs.unlinkSync(path.join(DATA, 'import-' + q.id + '.json')); } catch (e) {}
    return send(res, 200, { ok: true });
  }
  // The app starts a login with its PKCE authorize URL; the phone page shows it; the callback stores the code.
  if (u.pathname === '/api/login' && req.method === 'POST') {
    return readBody(req, function (err, buf) {
      try { pending.login = JSON.parse(buf.toString('utf8')); pending.loginResult = null; send(res, 200, { ok: true }); }
      catch (e) { send(res, 400, { error: 'bad request' }); }
    });
  }
  if (u.pathname === '/api/login/result') {
    if (pending.clientIdUpdate) { var cid = pending.clientIdUpdate; pending.clientIdUpdate = null; return send(res, 200, { clientId: cid }); }
    var r = pending.loginResult;
    if (r) { pending.loginResult = null; pending.login = null; }
    return send(res, 200, r || {});
  }
  send(res, 404, { error: 'not found' });
}

function phone(req, res, u) {
  if (u.pathname === '/') return send(res, 200, fs.readFileSync(path.join(DIR, 'phone.html')), 'text/html; charset=utf-8');
  if (u.pathname === '/login') {
    if (!pending.login || !pending.login.url) return send(res, 200, page('No login waiting', 'Open <b>Settings → Spotify</b> on the TV and choose <b>Connect Spotify</b> first.'), 'text/html; charset=utf-8');
    res.writeHead(302, { Location: pending.login.url }); return res.end();
  }
  send(res, 404, 'not found', 'text/plain');
}

function page(title, body) {
  return '<!doctype html><meta name=viewport content="width=device-width"><title>TuneDeck</title><body style="font-family:sans-serif;background:#121212;color:#fff;padding:24px"><h2>' + title + '</h2><p>' + body + '</p>';
}

http.createServer(function (req, res) {
  var u = url.parse(req.url, true);
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (u.pathname.indexOf('/api/') === 0) return api(req, res, u);
  phone(req, res, u);
}).listen(8899, '0.0.0.0');

var keyFile = path.join(DIR, 'key.pem'), certFile = path.join(DIR, 'cert.pem');
if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
  https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, function (req, res) {
    var u = url.parse(req.url, true);
    if (u.pathname !== '/callback') return send(res, 404, 'not found', 'text/plain');
    var expect = pending.login && pending.login.state;
    if (!expect || u.query.state !== expect) return send(res, 400, page('Login expired', 'Start again from the TV.'), 'text/html; charset=utf-8');
    if (u.query.error) {
      pending.loginResult = { error: String(u.query.error) };
      return send(res, 200, page('Spotify login cancelled', 'You can close this page.'), 'text/html; charset=utf-8');
    }
    pending.loginResult = { code: String(u.query.code || ''), state: expect };
    send(res, 200, page('Connected ✓', 'Spotify is linked. Look at the TV, you can close this page.'), 'text/html; charset=utf-8');
  }).listen(8900, '0.0.0.0');
}

loadQueued();
console.log('tunedeck helper on ' + lanIp() + ':8899');
