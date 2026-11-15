#!/usr/bin/env bash
# Downloads the newest build of one region's pack from its GitHub release into a folder, with the
# files under their plain names (graph.bin.gz.000, tiles.pmtiles.000, ...) and its manifest.json,
# as the test workflows read it. Needs gh (GH_TOKEN).
# Usage: scripts/offline/fetch-pack.sh <region id> <out dir>
set -euo pipefail
ID=$1
OUT=$2
REPO=${SITE_REPO:-$GITHUB_REPOSITORY}
TAG="maps-$ID"
mkdir -p "$OUT"
gh release download "$TAG" -R "$REPO" -p entry.json -O "$OUT/entry.json" --clobber
VERSION=$(node -p "require('$(realpath "$OUT")/entry.json').manifest.version")
gh release download "$TAG" -R "$REPO" -p "$VERSION.*" -D "$OUT" --clobber
for f in "$OUT/$VERSION".*; do mv "$f" "$OUT/${f##*/$VERSION.}"; done
node -e '
const fs = require("fs");
const e = JSON.parse(fs.readFileSync(process.argv[1] + "/entry.json", "utf8"));
const m = e.manifest;
for (const f of m.files) for (const p of f.parts) p.path = p.path.split("/").pop().replace(m.version + ".", "");
fs.writeFileSync(process.argv[1] + "/manifest.json", JSON.stringify(m, null, 1));
' "$(realpath "$OUT")"
echo "fetched $ID ($VERSION)"
