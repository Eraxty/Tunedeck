#!/bin/sh
# Runs on the TV. Keeps the engine alive; credentials live under /media/developer/tunedeck,
# the log goes to tmpfs so it can never fill the app partition.
D=/media/developer/tunedeck
cd "$D" || exit 1
export GOMEMLIMIT=128MiB
while true; do
  ./go-librespot --config_dir "$D" > /tmp/tunedeck.log 2>&1
  sleep 3
done
