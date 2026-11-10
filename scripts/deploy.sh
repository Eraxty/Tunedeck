#!/usr/bin/env bash
# Packages the app and installs it on the TV over root SSH. Only touches the homebrew app folder,
# never the firmware. Does not launch the app.
set -euo pipefail
cd "$(dirname "$0")/.."

TV="${TV_HOST:-root@192.168.1.3}"
ID=com.ice.tunedeck
SSH=(ssh -o BatchMode=yes -o LogLevel=ERROR "$TV")

[ -f app/js/auth.local.js ] || echo 'window.AUTH_SEED = null;' > app/js/auth.local.js
[ -f app/js/import.local.js ] || echo 'window.IMPORT_DATA = null;' > app/js/import.local.js
mkdir -p dist && rm -f dist/*.ipk
ares-package --no-minify app -o dist > /dev/null
IPK=$(ls dist/*.ipk)

scp -q -o BatchMode=yes -o LogLevel=ERROR "$IPK" "$TV:/media/developer/temp/tunedeck.ipk"
"${SSH[@]}" "L=/tmp/tunedeck-install.log; : > \$L
  luna-send -i -f luna://com.webos.appInstallService/dev/install '{\"id\":\"$ID\",\"ipkUrl\":\"/media/developer/temp/tunedeck.ipk\",\"subscribe\":true}' > \$L 2>&1 < /dev/null &
  P=\$!; i=0
  while [ \$i -lt 60 ]; do grep -q -E '\"installed\"|FAILED|errorText|\"returnValue\": *false' \$L && break; sleep 1; i=\$((i+1)); done
  kill \$P 2>/dev/null; rm -f /media/developer/temp/tunedeck.ipk
  if grep -q '\"installed\"' \$L; then echo 'app installed'; else echo 'app install FAILED:'; tail -20 \$L; exit 1; fi"
