#!/usr/bin/env bash
# Builds the offline pack for Peninsular Malaysia (and Singapore, which falls inside the box).
# Runs on GitHub Actions (ubuntu-latest), which can reach Geofabrik and Protomaps.
# Usage: scripts/offline/build-pack.sh <out dir>
set -euo pipefail
OUT=${1:-offline-pack}
WORK=${WORK:-$(mktemp -d)}
BBOX=${BBOX:-99.45,1.15,104.65,6.85}
ID=${PACK_ID:-peninsular-my}
NAME=${PACK_NAME:-Peninsular Malaysia}
MAXZOOM=${MAXZOOM:-15}
HERE=$(cd "$(dirname "$0")" && pwd)
# Land outside this outline (Sumatra, southern Thailand) is left out to keep the pack small.
REGION=${REGION:-$HERE/peninsular-my.geojson}
mkdir -p "$OUT" "$WORK"
echo "work dir: $WORK"

command -v osmium >/dev/null || { sudo apt-get update -q && sudo apt-get install -y -q osmium-tool; }

# --- OpenStreetMap extract
PBF="$WORK/region.osm.pbf"
[ -f "$PBF" ] || curl -fL --retry 3 -o "$PBF" https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf
osmium extract -p "$REGION" "$PBF" -o "$WORK/pen.osm.pbf" --overwrite

# --- roads -> routing graph
osmium tags-filter "$WORK/pen.osm.pbf" \
  w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link,unclassified,residential,living_street,service,road \
  n/highway=motorway_junction r/type=restriction -o "$WORK/roads.osm.pbf" --overwrite
osmium add-locations-to-ways "$WORK/roads.osm.pbf" -o "$WORK/roads-loc.osm.pbf" --overwrite
osmium cat "$WORK/roads-loc.osm.pbf" -f opl,add_metadata=false,locations_on_ways=true -o "$WORK/roads.opl" --overwrite
node --max-old-space-size=12000 "$HERE/build-graph.mjs" "$WORK/roads.opl" "$WORK/graph.bin" "$WORK/streets.jsonl" --bbox "$BBOX" --side left
rm -f "$WORK/roads.opl" "$WORK/roads.osm.pbf" "$WORK/roads-loc.osm.pbf"

# --- named places -> search index
osmium tags-filter "$WORK/pen.osm.pbf" \
  nwr/place nwr/amenity nwr/shop nwr/tourism nwr/leisure nwr/healthcare nwr/office \
  nwr/building=commercial,retail,hospital,university,school,mosque,temple,church,train_station \
  nwr/railway=station,halt nwr/aeroway=aerodrome,terminal nwr/highway=services,rest_area,motorway_junction,toll_gantry \
  nwr/barrier=toll_booth \
  -o "$WORK/places.osm.pbf" --overwrite
osmium export "$WORK/places.osm.pbf" -f geojsonseq -x print_record_separator=false --geometry-types=point,polygon -o "$WORK/places.geojsonseq" --overwrite
node --max-old-space-size=8000 "$HERE/build-places.mjs" "$WORK/places.geojsonseq" "$WORK/streets.jsonl" "$WORK/places.bin"
rm -f "$WORK/places.geojsonseq" "$WORK/places.osm.pbf"

# --- map tiles from the latest Protomaps planet build
if ! command -v pmtiles >/dev/null; then
  # GH_TOKEN (the workflow token) lets gh read the public release.
  gh release download -R protomaps/go-pmtiles -p 'go-pmtiles_*_Linux_x86_64.tar.gz' -D "$WORK" --clobber
  tar -xzf "$WORK"/go-pmtiles_*_Linux_x86_64.tar.gz -C "$WORK" pmtiles
  PMTILES="$WORK/pmtiles"
else
  PMTILES=pmtiles
fi
BUILD=$(curl -fsSL https://build-metadata.protomaps.dev/builds.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s);console.log(b[b.length-1].key)})')
echo "protomaps build: $BUILD"
"$PMTILES" extract "https://build.protomaps.com/$BUILD" "$WORK/tiles.pmtiles" --region="$REGION" --maxzoom="$MAXZOOM"
# Keep the whole site under GitHub Pages' 1 GB: drop the most detailed zoom if needed.
if [ "$(stat -c %s "$WORK/tiles.pmtiles")" -gt $((700 * 1024 * 1024)) ]; then
  echo "tiles over 700 MB at z$MAXZOOM; extracting to z14"
  "$PMTILES" extract "https://build.protomaps.com/$BUILD" "$WORK/tiles.pmtiles" --region="$REGION" --maxzoom=14
fi

node "$HERE/finish-pack.mjs" "$WORK" "$OUT" --id "$ID" --name "$NAME" --bbox "$BBOX" --side left
du -sh "$OUT"
