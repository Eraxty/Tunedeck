// Chromium 53 on webOS 4.x: ES2015 syntax only (no async/await, no ?. , no object spread),
// and no Object.values/entries or padStart. No CSS grid.
var CFG = {
  appName: 'tunedeck',
  version: '0.4.0',
  audius: 'https://api.audius.co/v1',
  lrclib: 'https://lrclib.net/api',
  helper: 'http://127.0.0.1:8899',
  spotifyApi: 'https://api.spotify.com/v1',
  spotifyAuth: 'https://accounts.spotify.com',
  // Playback (Web Playback SDK) + reading and saving the user's library. Nothing that edits playlists.
  spotifyScopes: 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state ' +
    'user-read-currently-playing user-read-recently-played user-top-read user-follow-read user-library-read user-library-modify ' +
    'playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public',
  deviceName: 'TuneDeck TV',
  syncEveryMs: 6 * 3600 * 1000,
  genres: ['Electronic', 'Hip-Hop/Rap', 'Lo-Fi', 'Pop', 'R&B/Soul', 'Alternative', 'Ambient', 'House', 'Rock']
};
