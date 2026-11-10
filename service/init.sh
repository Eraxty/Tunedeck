#!/bin/sh
# Homebrew Channel startup hook (/var/lib/webosbrew/init.d/tunedeck): start the audio engine at boot.
[ -x /media/developer/tunedeck/run.sh ] && setsid /media/developer/tunedeck/run.sh > /dev/null 2>&1 < /dev/null &
exit 0
