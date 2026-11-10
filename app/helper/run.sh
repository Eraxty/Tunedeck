#!/bin/sh
# Keeps the helper running. Its log is on tmpfs so it can never fill storage. Stops for good once the app
# has been removed.
H=$(dirname "$(readlink -f "$0")")
export TUNEDECK_STATE=/var/lib/webosbrew/tunedeck
echo $$ > "$TUNEDECK_STATE/run.pid"
while [ -f "$H/server.js" ]; do
  node "$H/server.js" > /tmp/tunedeck-helper.log 2>&1 &
  echo $! > "$TUNEDECK_STATE/server.pid"
  wait $!
  sleep 5
done
rm -f "$TUNEDECK_STATE/run.pid" "$TUNEDECK_STATE/server.pid"
