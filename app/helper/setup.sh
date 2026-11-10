#!/bin/sh
# Sets up the TuneDeck helper (phone sign-in page, Spotify login relay, imports). TuneDeck runs this as root
# through the Homebrew Channel on first launch and after each update. It only touches:
#   - this app's own folder (the helper runs from here)
#   - /var/lib/webosbrew/tunedeck   certificate, pending imports, startup log
#   - /var/lib/webosbrew/init.d/tunedeck   a link to helper/init.sh, so the helper starts at boot
# Nothing on the system partitions. Removing the app leaves a dangling link that run-parts skips.
H=$(dirname "$(readlink -f "$0")")
S=/var/lib/webosbrew/tunedeck
mkdir -p "$S/data" || exit 1

# Versions before 0.5 were installed by a developer script into /media/developer/tunedeck.
if [ -d /media/developer/tunedeck ]; then
  pkill -f '/media/developer/tunedeck/run.sh'; pkill -f '/media/developer/tunedeck/server.js'
  rm -rf /media/developer/tunedeck
fi

# Spotify only redirects to HTTPS, so the callback needs a certificate. It is made here, on the TV, once.
if [ ! -s "$S/cert.pem" ] || [ ! -s "$S/key.pem" ]; then
  IP=$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')
  CFG="$S/openssl.cnf"
  printf '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=TuneDeck TV\n[ext]\nbasicConstraints=CA:FALSE\n' > "$CFG"
  [ -n "$IP" ] && printf 'subjectAltName=IP:%s\n' "$IP" >> "$CFG"
  openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 -config "$CFG" -keyout "$S/key.pem" -out "$S/cert.pem" > /dev/null 2>&1 || { echo "certificate failed"; exit 1; }
  rm -f "$CFG"
  chmod 600 "$S/key.pem"
fi

chmod +x "$H/init.sh" "$H/run.sh"
mkdir -p /var/lib/webosbrew/init.d
ln -sf "$H/init.sh" /var/lib/webosbrew/init.d/tunedeck

# (Re)start the helper so it runs this version's code.
sh "$H/init.sh"
echo ok
