#!/usr/bin/env bash
# Installs TuneDeck on the TV over root SSH: the app (ipk) and the helper (phone import + Spotify login relay).
# Only touches the homebrew app folder, /media/developer/tunedeck and the Homebrew Channel init.d hook.
# Never touches the firmware. Does not launch the app.
set -euo pipefail
cd "$(dirname "$0")/.."

TV="${TV_HOST:-root@192.168.1.3}"
TV_IP="${TV#*@}"
ID=com.ice.tunedeck
HELPER=/media/developer/tunedeck
SSH=(ssh -o BatchMode=yes -o LogLevel=ERROR "$TV")
SCP=(scp -q -o BatchMode=yes -o LogLevel=ERROR)

# Self-signed cert for the HTTPS Spotify callback (Spotify only redirects to HTTPS or loopback).
mkdir -p helper/certs
if [ ! -f helper/certs/cert.pem ]; then
  openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 -subj "/CN=TuneDeck TV" \
    -addext "subjectAltName=IP:$TV_IP" -keyout helper/certs/key.pem -out helper/certs/cert.pem 2>/dev/null
fi

"${SSH[@]}" "mkdir -p $HELPER/data"
"${SCP[@]}" helper/server.js helper/run.sh helper/phone.html helper/certs/key.pem helper/certs/cert.pem "$TV:$HELPER/"
"${SCP[@]}" helper/init.sh "$TV:/var/lib/webosbrew/init.d/tunedeck"
"${SSH[@]}" "chmod +x /var/lib/webosbrew/init.d/tunedeck
  pkill -f '[t]unedeck/run.sh' ; pkill -f '[t]unedeck/server.js' ; true
  sh /var/lib/webosbrew/init.d/tunedeck"
echo "helper installed and started"

mkdir -p dist && rm -f dist/*.ipk
ares-package --no-minify app -o dist > /dev/null
IPK=$(ls dist/*.ipk)
"${SCP[@]}" "$IPK" "$TV:/media/developer/temp/tunedeck.ipk"
"${SSH[@]}" "L=/tmp/tunedeck-install.log; : > \$L
  luna-send -i -f luna://com.webos.appInstallService/dev/install '{\"id\":\"$ID\",\"ipkUrl\":\"/media/developer/temp/tunedeck.ipk\",\"subscribe\":true}' > \$L 2>&1 < /dev/null &
  P=\$!; i=0
  while [ \$i -lt 60 ]; do grep -q -E '\"installed\"|FAILED|errorText|\"returnValue\": *false' \$L && break; sleep 1; i=\$((i+1)); done
  kill \$P 2>/dev/null; rm -f /media/developer/temp/tunedeck.ipk
  if grep -q '\"installed\"' \$L; then echo 'app installed'; else echo 'app install FAILED:'; tail -20 \$L; exit 1; fi"
