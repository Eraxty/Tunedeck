// Chromium 53 on webOS 4.x: ES2015 syntax only (no async/await, no ?. , no object spread),
// and no Object.values/entries or padStart. No CSS grid.
var CFG = {
  appName: 'tunedeck',
  version: '0.3.0',
  audius: 'https://api.audius.co/v1',
  lrclib: 'https://lrclib.net/api',
  helper: 'http://127.0.0.1:8899',
  clientId: 'b39c9fa581f4448f80fed22715ae2b55',
  spotifyApi: 'https://api.spotify.com/v1',
  spotifyAuth: 'https://accounts.spotify.com',
  spotifyScopes: 'playlist-read-private playlist-read-collaborative user-library-read',
  syncEveryMs: 6 * 3600 * 1000,
  genres: ['Electronic', 'Hip-Hop/Rap', 'Lo-Fi', 'Pop', 'R&B/Soul', 'Alternative', 'Ambient', 'House', 'Rock']
};
