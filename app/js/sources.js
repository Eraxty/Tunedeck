// Audio sources. Audius is an open music platform with a free public streaming API, so tracks play
// straight into an <audio> element with no native engine. Everything is normalised to the app's track
// shape: { uri, name, artist_names, album_name, album_cover_url, duration (ms), src: { source, id } }.
var Sources = (function () {
  function json(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('Audius error ' + r.status);
      return r.json();
    }, function () { throw new Error('Cannot reach Audius'); });
  }

  function track(t) {
    var art = t.artwork || {};
    return {
      uri: 'audius:' + t.id, name: t.title, artist_names: [t.user ? t.user.name : ''], album_name: '',
      album_cover_url: art['480x480'] || art['150x150'] || '', duration: (t.duration || 0) * 1000,
      src: { source: 'audius', id: t.id }
    };
  }

  function playable(t) { return t.is_streamable !== false && !t.is_stream_gated && t.duration > 0; }
  function list(path) { return json(CFG.audius + path).then(function (j) { return (j.data || []).filter(playable).map(track); }); }
  var q = 'app_name=' + CFG.appName;

  return {
    search: function (text, n) { return list('/tracks/search?' + q + '&limit=' + (n || 20) + '&query=' + encodeURIComponent(text)); },
    trending: function (n) { return list('/tracks/trending?' + q + '&limit=' + (n || 24)); },
    url: function (src) { return CFG.audius + '/tracks/' + src.id + '/stream?' + q; }
  };
})();
