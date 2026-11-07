#!/usr/bin/env bash
# Builds the places data the app downloads for the area around you: Overture Maps places merged
# with OpenStreetMap's, for Malaysia, Singapore and Brunei (src/places/format.ts).
# Runs on GitHub Actions (ubuntu-latest), which can reach Overture's S3 bucket and Geofabrik.
# Usage: scripts/places/build.sh <out dir>
set -euo pipefail
OUT=${1:-places-data}
WORK=${WORK:-$(mktemp -d)}
# Malaysia (Peninsular and Borneo), Singapore and Brunei; places in other countries inside the box
# are dropped by the builder.
BBOX=${BBOX:-99.5,0.8,119.4,7.45}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$WORK"
echo "work dir: $WORK"

command -v osmium >/dev/null || { sudo apt-get update -q && sudo apt-get install -y -q osmium-tool; }

# --- Overture Maps places, latest release (optional: OpenStreetMap alone if it cannot be read)
OVERTURE="$WORK/overture.geojsonseq"
RELEASE=""
rm -f "$OVERTURE"
if python3 -m pip install --quiet --upgrade overturemaps; then
  RELEASE=$(python3 -c 'from overturemaps.core import get_latest_release; print(get_latest_release())' 2>/dev/null || true)
  echo "overture release: ${RELEASE:-unknown}"
  for i in 1 2 3; do
    if overturemaps download --bbox="$BBOX" -f geojsonseq --type=place -o "$OVERTURE"; then break; fi
    echo "overture download failed (try $i)"
    rm -f "$OVERTURE"
    sleep 30
  done
fi
if [ -s "$OVERTURE" ]; then
  echo "overture places in the box: $(wc -l < "$OVERTURE")"
else
  echo "::warning::Overture Maps places could not be downloaded; publishing OpenStreetMap places only."
  OVERTURE=""
fi

# --- OpenStreetMap places
PBF="$WORK/region.osm.pbf"
[ -f "$PBF" ] || curl -fL --retry 3 -o "$PBF" https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf
OSM_DATE=$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$PBF" 2>/dev/null | cut -c1-10 || true)
OSM_DATE=${OSM_DATE:-$(date -u +%F)}
echo "osm data: $OSM_DATE"
osmium tags-filter "$PBF" \
  nwr/amenity nwr/shop nwr/tourism nwr/leisure nwr/healthcare nwr/office nwr/craft nwr/historic \
  n/place=city,town,village,suburb nwr/railway=station,halt nwr/public_transport=station \
  nwr/aeroway=aerodrome,terminal nwr/highway=services,rest_area \
  -o "$WORK/poi.osm.pbf" --overwrite
osmium export "$WORK/poi.osm.pbf" -f geojsonseq -x print_record_separator=false --geometry-types=point,polygon -o "$WORK/osm.geojsonseq" --overwrite
echo "osm features: $(wc -l < "$WORK/osm.geojsonseq")"

node --max-old-space-size=12000 "$HERE/build-places.mjs" \
  ${OVERTURE:+--overture "$OVERTURE"} --osm "$WORK/osm.geojsonseq" --out "$OUT" \
  --overture-release "${RELEASE:-none}" --osm-date "$OSM_DATE" --budget-mb "${PLACES_BUDGET_MB:-260}"
du -sh "$OUT"
