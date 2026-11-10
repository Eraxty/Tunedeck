#!/bin/sh
# Boot hook, linked from /var/lib/webosbrew/init.d/tunedeck by setup.sh: (re)starts the TuneDeck helper in
# the background and returns at once. Does nothing if the app has been removed.
H=$(dirname "$(readlink -f "$0")")
S=/var/lib/webosbrew/tunedeck
[ -f "$H/server.js" ] || exit 0
mkdir -p "$S"
for f in run server; do
  if [ -f "$S/$f.pid" ]; then kill "$(cat "$S/$f.pid")" 2>/dev/null; rm -f "$S/$f.pid"; fi
done
echo "$(date) starting helper from $H" > "$S/startup.log"
setsid sh "$H/run.sh" >> "$S/startup.log" 2>&1 < /dev/null &
exit 0
