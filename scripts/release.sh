#!/usr/bin/env bash
# Builds a Homebrew Channel release into dist/: the ipk and its manifest (same fields as
# webosbrew-toolbox-gen-manifest). Upload both to one GitHub release; the apps-repo package points at
# releases/latest/download/com.ice.tunedeck.manifest.json.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO=https://github.com/Eraxty/Tunedeck
ID=$(python3 -c 'import json; print(json.load(open("app/appinfo.json"))["id"])')
VER=$(python3 -c 'import json; print(json.load(open("app/appinfo.json"))["version"])')
CFG_VER=$(sed -n "s/.*version: '\([0-9.]*\)'.*/\1/p" app/js/config.js)
[ "$VER" = "$CFG_VER" ] || { echo "appinfo.json ($VER) and config.js ($CFG_VER) versions differ"; exit 1; }

rm -rf dist && mkdir -p dist
ares-package --no-minify app -o dist > /dev/null
IPK=dist/${ID}_${VER}_all.ipk
[ -f "$IPK" ] || { echo "ares-package didn't produce $IPK"; exit 1; }

SHA=$(sha256sum "$IPK" | cut -d' ' -f1)
SIZE=$(stat -c %s "$IPK")
python3 - "$ID" "$VER" "$REPO" "$(basename "$IPK")" "$SHA" "$SIZE" > "dist/$ID.manifest.json" <<'EOF'
import json, sys
id_, ver, repo, ipk, sha, size = sys.argv[1:]
print(json.dumps({
    "id": id_, "version": ver, "type": "web", "title": "TuneDeck",
    "appDescription": "Fast Spotify player for webOS TVs",
    "iconUri": "https://raw.githubusercontent.com/Eraxty/Tunedeck/main/app/assets/icon160.png",
    "sourceUrl": repo, "rootRequired": "optional",
    "ipkUrl": ipk, "ipkSize": int(size), "ipkHash": {"sha256": sha},
}))
EOF
ls -la dist
