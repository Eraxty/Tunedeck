#!/bin/sh
# Homebrew Channel startup hook (/var/lib/webosbrew/init.d/tunedeck): starts the TuneDeck helper at boot.
D=/media/developer/tunedeck
[ -f "$D/server.js" ] || exit 0
setsid sh "$D/run.sh" > /dev/null 2>&1 < /dev/null &
exit 0
