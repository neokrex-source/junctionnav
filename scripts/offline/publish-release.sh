#!/usr/bin/env bash
# Publishes a built pack as files of the GitHub release "maps-<id>" in the site repository, each
# named with the pack's version in front so a new build never overwrites files a phone is still
# downloading. Writes <pack>/entry.json (the catalog entry, with the release addresses) and keeps
# only the files of this version and the one before.
# Needs GH_TOKEN with write access to SITE_REPO (default: this repository).
# Usage: scripts/offline/publish-release.sh <pack dir> <region id> <build key>
set -euo pipefail
DIR=$1
ID=$2
KEY=${3:-}
REPO=${SITE_REPO:-$GITHUB_REPOSITORY}
TAG="maps-$ID"
HERE=$(cd "$(dirname "$0")" && pwd)
VERSION=$(node -p "require('$(realpath "$DIR")/manifest.json').version")
NAME=$(node -p "require('$(realpath "$DIR")/manifest.json').name")

if ! gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  gh release create "$TAG" -R "$REPO" --title "Offline maps: $NAME" --prerelease --latest=false \
    --notes "Offline maps for $NAME, for the JunctionNav app (Settings → Downloads → Offline maps). Built from OpenStreetMap data (© OpenStreetMap contributors) and Protomaps tiles; rebuilt every month."
fi

UP="$DIR/.upload"
rm -rf "$UP" && mkdir -p "$UP"
node -e '
const m = require(process.argv[1] + "/manifest.json");
for (const f of m.files) for (const p of f.parts) console.log(p.path);
' "$(realpath "$DIR")" | while read -r part; do
  ln -f "$DIR/$part" "$UP/$VERSION.$part" 2>/dev/null || cp "$DIR/$part" "$UP/$VERSION.$part"
done
# Upload a few at a time; a failed file is tried again.
ls "$UP" | xargs -P 4 -I{} sh -c 'for i in 1 2 3; do gh release upload "$0" "$1/{}" -R "$2" --clobber && exit 0; sleep 10; done; exit 1' "$TAG" "$UP" "$REPO"

node "$HERE/release-entry.mjs" "$DIR" "$ID" "https://github.com/$REPO/releases/download/$TAG/$VERSION." > "$DIR/entry.json"
cp "$DIR/entry.json" "$UP/entry.json"
printf '%s\n' "$KEY" > "$UP/build-key.txt"
gh release upload "$TAG" "$UP/entry.json" "$UP/build-key.txt" -R "$REPO" --clobber

# Keep this version and the one before (a phone may be part way through it).
KEEP=$(gh release view "$TAG" -R "$REPO" --json assets -q '.assets[].name' | grep -E '^[0-9]{8}T[0-9]{4}\.' | cut -d. -f1 | sort -u | tail -n 2 | tr '\n' '|')
for a in $(gh release view "$TAG" -R "$REPO" --json assets -q '.assets[].name' | grep -E '^[0-9]{8}T[0-9]{4}\.'); do
  v=${a%%.*}
  case "|$KEEP" in *"|$v|"*) ;; *) gh release delete-asset "$TAG" "$a" -R "$REPO" -y || true ;; esac
done
rm -rf "$UP"
echo "published $ID ($VERSION) on $REPO release $TAG"
