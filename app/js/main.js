Library.load();
Profiles.start(function () {
  Ext.boot();
  UI.init();
  UI.go('home');
  // Spotify sync on launch and every 30 min check (syncs when older than 6 h).
  function autoSync() {
    if (Spotify.linked() && Date.now() - Library.syncedAt() > CFG.syncEveryMs) {
      Library.syncSpotify().then(function (r) { UI.toast('Spotify synced · ' + r.playlists + ' playlists'); UI.buildRail(); }, function (e) { console.warn('sync', e.message); });
    }
  }
  setTimeout(autoSync, 4000); setInterval(autoSync, 30 * 60000);
});
