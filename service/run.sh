#!/bin/sh
# Runs on the TV. Keeps the engine alive; state/credentials live under /media/developer/tunedeck.
D=/media/developer/tunedeck
mkdir -p "$D/state"
cd "$D"
while true; do
  ./go-librespot --config_dir "$D" >> "$D/engine.log" 2>&1
  sleep 3
done
