#!/usr/bin/env bash
# Prepare OSRM car routing data (keeps OSM lanes/destination tags the junction view uses).
# Usage: ./setup.sh malaysia | japan | kanto | kansai | <full Geofabrik .osm.pbf URL>
set -euo pipefail
cd "$(dirname "$0")"
IMG=ghcr.io/project-osrm/osrm-backend:v5.27.1
case "${1:-malaysia}" in
  malaysia) URL=https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf ;;
  japan)    URL=https://download.geofabrik.de/asia/japan-latest.osm.pbf ;;   # big: needs ~32 GB RAM to process
  kanto)    URL=https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf ;;
  kansai)   URL=https://download.geofabrik.de/asia/japan/kansai-latest.osm.pbf ;;
  http*)    URL="$1" ;;
  *) echo "unknown region $1"; exit 1 ;;
esac
mkdir -p data
echo "Downloading $URL"
curl -L --fail -o data/region.osm.pbf "$URL"

# The stock car profile can exclude toll, motorway or ferry one at a time. Add the combinations
# so "Avoid tolls" + "Avoid highways" (+ "Avoid ferries") work together in the app.
PATCH="s/^\([[:space:]]*\)Set {'ferry'}[[:space:]]*\$/\1Set {'ferry'},\n\1Set {'toll', 'motorway'},\n\1Set {'toll', 'ferry'},\n\1Set {'motorway', 'ferry'},\n\1Set {'toll', 'motorway', 'ferry'}/"
docker run --rm -t -v "$PWD/data:/data" $IMG sh -c "
  sed -i \"$PATCH\" /opt/car.lua &&
  (grep -q \"Set {'toll', 'motorway'}\" /opt/car.lua && echo 'Profile patched: combined exclusions enabled' || echo 'Profile layout differs: only single exclusions available') &&
  osrm-extract -p /opt/car.lua /data/region.osm.pbf"
docker run --rm -t -v "$PWD/data:/data" $IMG osrm-partition /data/region.osrm
docker run --rm -t -v "$PWD/data:/data" $IMG osrm-customize /data/region.osrm
echo "Done. Start with: docker compose up -d   (then set Routing server to http://<host>:5000/route/v1/driving)"
