#!/usr/bin/env bash
# Builds one offline pack: a country or region (Peninsular Malaysia and Singapore by default).
# Runs on GitHub Actions (ubuntu-latest), which can reach Geofabrik and Protomaps. The settings for
# each region come from scripts/offline/region.mjs (PBF_URL, REGION, CLIP, BBOX, SIDE, MAXZOOM,
# TERRAIN_ZOOM, PACK_ID, PACK_NAME).
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
PBF_URL=${PBF_URL:-https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf}
# 1: cut the outline out of the extract; 0: the extract is the region already.
CLIP=${CLIP:-1}
SIDE=${SIDE:-left}
# The site (GitHub Pages) has 1 GB: tiles over this size drop their most detailed zoom.
MAX_TILES_MB=${MAX_TILES_MB:-700}
mkdir -p "$OUT" "$WORK"
echo "work dir: $WORK"

command -v osmium >/dev/null || { sudo apt-get update -q && sudo apt-get install -y -q osmium-tool; }

# --- OpenStreetMap extract
PBF="$WORK/region.osm.pbf"
[ -f "$PBF" ] || curl -fL --retry 3 -o "$PBF" "$PBF_URL"
if [ "$CLIP" = "1" ]; then
  osmium extract -p "$REGION" "$PBF" -o "$WORK/pen.osm.pbf" --overwrite
  rm -f "$PBF"
else
  mv "$PBF" "$WORK/pen.osm.pbf"
fi

# --- roads -> routing graph
osmium tags-filter "$WORK/pen.osm.pbf" \
  w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link,unclassified,residential,living_street,service,road \
  n/highway=motorway_junction r/type=restriction -o "$WORK/roads.osm.pbf" --overwrite
osmium add-locations-to-ways "$WORK/roads.osm.pbf" -o "$WORK/roads-loc.osm.pbf" --overwrite
osmium cat "$WORK/roads-loc.osm.pbf" -f opl,add_metadata=false,locations_on_ways=true -o "$WORK/roads.opl" --overwrite
node --max-old-space-size=12000 "$HERE/build-graph.mjs" "$WORK/roads.opl" "$WORK/graph.bin" "$WORK/streets.jsonl" --bbox "$BBOX" --side "$SIDE"
rm -f "$WORK/roads.opl" "$WORK/roads.osm.pbf" "$WORK/roads-loc.osm.pbf"

# --- named places -> search index
osmium tags-filter "$WORK/pen.osm.pbf" \
  nwr/place nwr/amenity nwr/shop nwr/tourism nwr/leisure nwr/healthcare nwr/office \
  nwr/building=commercial,retail,hospital,university,school,mosque,temple,church,train_station \
  nwr/railway=station,halt nwr/aeroway=aerodrome,terminal nwr/highway=services,rest_area,motorway_junction,toll_gantry,speed_camera \
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
if [ "$(stat -c %s "$WORK/tiles.pmtiles")" -gt $((MAX_TILES_MB * 1024 * 1024)) ] && [ "$MAXZOOM" -gt 13 ]; then
  echo "tiles over $MAX_TILES_MB MB at z$MAXZOOM; extracting to z$((MAXZOOM - 1))"
  "$PMTILES" extract "https://build.protomaps.com/$BUILD" "$WORK/tiles.pmtiles" --region="$REGION" --maxzoom=$((MAXZOOM - 1))
fi

# --- ground heights for the 3D junction views (hills) without internet
# Optional: if the elevation tiles cannot be fetched, the pack goes out without them and the
# app keeps using the online heights.
rm -f "$WORK/terrain.bin"
if [ "${TERRAIN_ZOOM:-12}" = "0" ]; then
  echo "no ground heights for this region"
elif ! node --max-old-space-size=8000 "$HERE/build-terrain.mjs" "$REGION" "$WORK/terrain.bin" --zoom "${TERRAIN_ZOOM:-12}" --max-mb "${TERRAIN_MAX_MB:-40}"; then
  echo "::warning::Ground heights could not be built; the offline pack goes out without them."
  rm -f "$WORK/terrain.bin"
fi

node "$HERE/finish-pack.mjs" "$WORK" "$OUT" --id "$ID" --name "$NAME" --bbox "$BBOX" --side "$SIDE"
du -sh "$OUT"
