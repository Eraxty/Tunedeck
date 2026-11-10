// The TuneDeck helper (a small server on the TV for the phone sign-in page, the Spotify login relay and
// imports) ships inside the app. On first launch, and after an update, the app asks the Homebrew Channel's
// root service to run helper/setup.sh from its own folder. Without root, free music still works; Spotify
// sign-in and phone imports need the helper.
var Helper = (function () {
  var APP_DIR = decodeURIComponent(location.pathname).replace(/\/[^\/]*$/, '');
  var ready = null, bridge = null;

  function ping() {
    return fetch(CFG.helper + '/api/info').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  // Runs a shell command as root through the Homebrew Channel (luna://org.webosbrew.hbchannel.service/exec).
  function rootExec(cmd) {
    return new Promise(function (resolve, reject) {
      if (typeof PalmServiceBridge === 'undefined') return reject(new Error('Not running on a webOS TV'));
      bridge = new PalmServiceBridge();
      bridge.onservicecallback = function (msg) {
        var j = {}; try { j = JSON.parse(msg); } catch (e) {}
        if (j.returnValue) resolve(j); else reject(new Error(j.errorText || j.stderrString || 'The Homebrew Channel refused the request'));
      };
      bridge.call('luna://org.webosbrew.hbchannel.service/exec', JSON.stringify({ command: cmd }));
    });
  }
  function waitUp(tries) {
    return ping().then(function (info) {
      if (info && info.version === CFG.version) return info;
      if (tries <= 0) throw new Error('The TuneDeck helper didn’t start');
      return new Promise(function (r) { setTimeout(r, 1000); }).then(function () { return waitUp(tries - 1); });
    });
  }
  // Resolves with the helper's info once a helper of this app version is running.
  function ensure() {
    if (ready) return ready;
    ready = ping().then(function (info) {
      if (info && info.version === CFG.version) return info;
      Log.add('helper setup', info ? 'update from ' + info.version : 'first run');
      return rootExec('sh "' + APP_DIR + '/helper/setup.sh"').then(function (r) {
        Log.add('helper setup said', (r.stdoutString || '').trim(), (r.stderrString || '').trim());
        return waitUp(15);
      });
    }).catch(function (e) {
      ready = null; Log.add('helper unavailable', e.message);
      throw new Error('TuneDeck’s helper couldn’t start (' + e.message + '). Spotify sign-in needs the Homebrew Channel with root access.');
    });
    return ready;
  }
  return { ensure: ensure };
})();
