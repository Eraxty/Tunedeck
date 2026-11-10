#!/usr/bin/env bash
# Packages the app and installs app + engine on the TV over root SSH.
# Only touches homebrew locations; never the firmware.   Usage: deploy.sh [--app-only]
set -euo pipefail
cd "$(dirname "$0")/.."

TV="${TV_HOST:-root@192.168.1.3}"
ID=com.ice.tunedeck
SSH=(ssh -o BatchMode=yes -o LogLevel=ERROR "$TV")
SCP=(scp -q -o BatchMode=yes -o LogLevel=ERROR)

[ -f app/js/auth.local.js ] || echo 'window.AUTH_SEED = null;' > app/js/auth.local.js
mkdir -p dist && rm -f dist/*.ipk
ares-package --no-minify app -o dist > /dev/null
IPK=$(ls dist/*.ipk)

if [ "${1:-}" != "--app-only" ]; then
  [ -f engine/out/go-librespot ] || { echo "engine not built: run engine/build.sh" >&2; exit 1; }
  "${SSH[@]}" 'mkdir -p /media/developer/tunedeck; pkill -f "[t]unedeck/run.sh"; pkill -f "[t]unedeck/go-librespot"; true'
  "${SCP[@]}" engine/out/go-librespot service/run.sh service/config.yml "$TV:/media/developer/tunedeck/"
  "${SCP[@]}" service/init.sh "$TV:/var/lib/webosbrew/init.d/tunedeck"
  "${SSH[@]}" 'chmod +x /media/developer/tunedeck/go-librespot /media/developer/tunedeck/run.sh /var/lib/webosbrew/init.d/tunedeck
    setsid /media/developer/tunedeck/run.sh > /dev/null 2>&1 < /dev/null &'
  echo "engine installed and started"
fi

"${SCP[@]}" "$IPK" "$TV:/media/developer/temp/tunedeck.ipk"
"${SSH[@]}" "L=/tmp/tunedeck-install.log; : > \$L
  luna-send -i -f luna://com.webos.appInstallService/dev/install '{\"id\":\"$ID\",\"ipkUrl\":\"/media/developer/temp/tunedeck.ipk\",\"subscribe\":true}' > \$L 2>&1 &
  P=\$!; i=0
  while [ \$i -lt 60 ]; do grep -q -E '\"installed\"|FAILED|errorText|\"returnValue\": *false' \$L && break; sleep 1; i=\$((i+1)); done
  kill \$P 2>/dev/null; rm -f /media/developer/temp/tunedeck.ipk
  if grep -q '\"installed\"' \$L; then echo 'app installed'; else echo 'app install FAILED:'; tail -20 \$L; exit 1; fi"
