#!/bin/sh
# Keeps the helper alive; the log is on tmpfs so it can never fill the app partition.
D=/media/developer/tunedeck
while true; do
  node "$D/server.js" > /tmp/tunedeck-helper.log 2>&1
  sleep 5
done
