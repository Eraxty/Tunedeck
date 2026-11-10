#!/usr/bin/env node
// Imports music libraries from data exports into TuneDeck and pushes them to the TV.
//   node scripts/import.js <file-or-folder> [...]
// Understands:
//   Spotify "Download your data":  YourLibrary.json (Liked Songs), Playlist*.json
//   YouTube / YouTube Music Takeout: playlists/*.csv (video IDs; titles looked up via YouTube oEmbed),
//                                    music-library-songs.csv
// Writes app/js/import.local.js (gitignored). Re-run it with a newer export to sync.
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');

const TV = process.env.TV_HOST || 'root@192.168.1.3';
const APP_DIR = '/media/developer/apps/usr/palm/applications/com.ice.tunedeck';
const OUT = path.join(__dirname, '..', 'app', 'js', 'import.local.js');

const song = (name, artist, album, duration) => ({ name: name || '', artist: artist || '', album: album || '', duration: duration || 0, cover: '' });
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function walk(p, out = []) {
  const st = fs.statSync(p);
  if (st.isDirectory()) fs.readdirSync(p).forEach((f) => walk(path.join(p, f), out));
  else out.push(p);
  return out;
}

// Minimal RFC 4180 CSV parser (quoted fields, embedded commas/newlines).
function csv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function spotifyLibrary(j) {
  const tracks = (j.tracks || []).map((t) => song(t.track, t.artist, t.album));
  return tracks.length ? [{ id: 'spx:liked', origin: 'spotify-export', name: 'Liked Songs', songs: tracks }] : [];
}

function spotifyPlaylists(j) {
  return (j.playlists || []).map((p) => ({
    id: 'spx:' + slug(p.name), origin: 'spotify-export', name: p.name,
    songs: (p.items || []).map((i) => i.track || i.item).filter((t) => t && t.trackName).map((t) => song(t.trackName, t.artistName, t.albumName)),
  }));
}

// "Artist - Title (Official Video)" -> { artist, name }; falls back to the channel name ("Artist - Topic").
function splitVideoTitle(title, channel) {
  const clean = title.replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyric|visuali[sz]er|hd|4k|mv)[^\)\]]*[\)\]]/ig, '').trim();
  const m = clean.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), name: m[2].trim() };
  return { artist: (channel || '').replace(/\s*-\s*Topic$/i, '').trim(), name: clean };
}

async function oembed(id) {
  const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
  if (!r.ok) return null; // private, deleted or region-blocked video
  return r.json();
}

async function youtubeVideoPlaylist(file, rows) {
  const h = rows[0].map((x) => x.trim().toLowerCase()), col = h.indexOf('video id');
  const ids = rows.slice(1).map((r) => (r[col] || '').trim()).filter(Boolean);
  const name = path.basename(file, '.csv').replace(/-videos$/i, '');
  const songs = []; let missing = 0;
  for (let i = 0; i < ids.length; i += 4) {
    const batch = await Promise.all(ids.slice(i, i + 4).map(oembed));
    batch.forEach((v) => { if (!v) { missing++; return; } const s = splitVideoTitle(v.title, v.author_name); songs.push(song(s.name, s.artist)); });
    process.stdout.write(`\r  ${name}: ${Math.min(i + 4, ids.length)}/${ids.length}`);
  }
  process.stdout.write('\n');
  if (missing) console.log(`  ${missing} videos in "${name}" are private or deleted, skipped`);
  return { id: 'ytx:' + slug(name), origin: 'youtube-export', name, songs };
}

function youtubeMusicSongs(rows) {
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const c = (n) => h.indexOf(n);
  const songs = rows.slice(1).map((r) => song(r[c('song title')], r[c('artist name 1')], r[c('album title')]));
  return { id: 'ytx:library', origin: 'youtube-export', name: 'YouTube Music Library', songs: songs.filter((s) => s.name) };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.log('Usage: node scripts/import.js <export file or folder> [...]'); process.exit(1); }
  const playlists = [];
  for (const file of args.flatMap((a) => walk(a))) {
    const base = path.basename(file);
    try {
      if (/^YourLibrary\.json$/i.test(base)) playlists.push(...spotifyLibrary(JSON.parse(fs.readFileSync(file, 'utf8'))));
      else if (/^Playlist\d*\.json$/i.test(base)) playlists.push(...spotifyPlaylists(JSON.parse(fs.readFileSync(file, 'utf8'))));
      else if (/\.csv$/i.test(base)) {
        const rows = csv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
        if (!rows.length) continue;
        const h = rows[0].map((x) => x.trim().toLowerCase());
        if (h.includes('video id')) playlists.push(await youtubeVideoPlaylist(file, rows));
        else if (h.includes('song title')) playlists.push(youtubeMusicSongs(rows));
      }
    } catch (e) { console.error(`Skipping ${file}: ${e.message}`); }
  }
  const nonEmpty = playlists.filter((p) => p.songs.length);
  if (!nonEmpty.length) { console.error('Found nothing to import. Point this at the unzipped Spotify or Takeout export.'); process.exit(1); }
  const data = { importedAt: Date.now(), playlists: nonEmpty };
  fs.writeFileSync(OUT, 'window.IMPORT_DATA = ' + JSON.stringify(data) + ';\n');
  nonEmpty.forEach((p) => console.log(`  ${p.origin.padEnd(15)} ${p.name} (${p.songs.length} songs)`));
  try {
    execFileSync('scp', ['-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', OUT, `${TV}:${APP_DIR}/js/import.local.js`], { stdio: 'ignore' });
    console.log('Imported and pushed to the TV. Restart TuneDeck to load it.');
  } catch (e) { console.log('Imported. Run scripts/deploy.sh to send it to the TV.'); }
}

main();
