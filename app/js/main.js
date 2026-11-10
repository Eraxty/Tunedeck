Library.load();
Profiles.start(function () {
  Log.add('profile', Profiles.current().name, Spotify.linked() ? 'spotify' : 'audius');
  Ext.boot();
  UI.init();
  UI.go('home');
  if (Spotify.linked()) {
    // Start the Spotify player early so the TV is ready to play and visible in Spotify Connect.
    Spotify.me().catch(function (e) { UI.toast(e.message); });
    Playback.initSpotify().catch(function () {});
  }
});
