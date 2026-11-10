#!/usr/bin/env node
// One-time Spotify login for the TV app: Authorization Code + PKCE, run on the laptop.
// Writes the refresh token to app/js/auth.local.js (gitignored) and pushes it to the TV if the app is installed.
const http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const { execFileSync, spawn } = require('child_process');

const CLIENT_ID = 'b39c9fa581f4448f80fed22715ae2b55';
const REDIRECT = 'http://127.0.0.1:8888/callback';
const TV = process.env.TV_HOST || 'root@192.168.1.3';
const APP_DIR = '/media/developer/apps/usr/palm/applications/com.ice.tunedeck';
const OUT = path.join(__dirname, '..', 'app', 'js', 'auth.local.js');
// Search needs no scopes; add here only when a feature actually needs one.
const SCOPES = '';

const b64 = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = b64(crypto.randomBytes(64));
const challenge = b64(crypto.createHash('sha256').update(verifier).digest());
const state = b64(crypto.randomBytes(16));

const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
  client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT, state,
  code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
  const done = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain' }).end(msg); server.close(); };
  if (u.searchParams.get('state') !== state) return done(400, 'State mismatch, try again.');
  if (u.searchParams.get('error')) return done(400, 'Spotify said: ' + u.searchParams.get('error'));
  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: u.searchParams.get('code'),
        redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: verifier }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.error || r.status);
    fs.writeFileSync(OUT, 'window.AUTH_SEED = ' + JSON.stringify({ refresh_token: j.refresh_token, issued: Date.now() }) + ';\n', { mode: 0o600 });
    let pushed = false;
    try {
      execFileSync('scp', ['-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', OUT, `${TV}:${APP_DIR}/js/auth.local.js`], { stdio: 'ignore' });
      pushed = true;
    } catch (e) {}
    console.log(pushed ? 'Logged in and pushed to the TV. Restart the app on the TV.' : 'Logged in. Run scripts/deploy.sh to send it to the TV.');
    done(200, 'Logged in. You can close this tab.');
  } catch (e) {
    console.error('Login failed:', e.message);
    done(500, 'Login failed: ' + e.message);
  }
});

server.listen(8888, '127.0.0.1', () => {
  console.log('Open this URL to log in:\n\n' + url + '\n');
  spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
});
