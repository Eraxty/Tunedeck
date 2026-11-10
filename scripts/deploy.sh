#!/usr/bin/env bash
# Development install over root SSH: builds the ipk, installs it, and runs the same helper setup that the app
# runs through the Homebrew Channel on first launch. Never touches the firmware. Does not launch the app.
set -euo pipefail
cd "$(dirname "$0")/.."

TV="${TV_HOST:-root@192.168.1.3}"
ID=com.ice.tunedeck
APPDIR=/media/developer/apps/usr/palm/applications/$ID
SSH=(ssh -o BatchMode=yes -o LogLevel=ERROR "$TV")
SCP=(scp -q -o BatchMode=yes -o LogLevel=ERROR)

./scripts/release.sh > /dev/null
IPK=$(ls dist/*.ipk)
"${SCP[@]}" "$IPK" "$TV:/media/developer/temp/tunedeck.ipk"
"${SSH[@]}" "L=/tmp/tunedeck-install.log; : > \$L
  luna-send -i -f luna://com.webos.appInstallService/dev/install '{\"id\":\"$ID\",\"ipkUrl\":\"/media/developer/temp/tunedeck.ipk\",\"subscribe\":true}' > \$L 2>&1 < /dev/null &
  P=\$!; i=0
  while [ \$i -lt 60 ]; do grep -q -E '\"installed\"|FAILED|errorText|\"returnValue\": *false' \$L && break; sleep 1; i=\$((i+1)); done
  kill \$P 2>/dev/null; rm -f /media/developer/temp/tunedeck.ipk
  if grep -q '\"installed\"' \$L; then echo 'app installed'; else echo 'app install FAILED:'; tail -20 \$L; exit 1; fi"
"${SSH[@]}" "sh $APPDIR/helper/setup.sh" < /dev/null
echo "helper set up"
