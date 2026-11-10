Library.load();
Profiles.start(function () {
  Log.add('profile', Profiles.current().name, SpotifyApi.linked() ? 'spotify' : 'audius');
  Ext.boot();
  UI.init();
  UI.go('home');
  if (SpotifyApi.linked()) {
    // Start the Spotify player early so the TV is ready to play and visible in Spotify Connect.
    SpotifyApi.me().catch(function (e) { UI.toast(e.message); });
    Playback.initSpotify().catch(function () {});
  }
});
