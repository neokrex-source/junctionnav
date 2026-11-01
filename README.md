# JunctionNav

A browser-based navigation app that shows a **junction view** before every decision point where lanes split: highway exits and entrances, forks between expressways, merges, and divider splits such as flyover vs. service road or underpass vs. street level. The view shows the road split in 3D from the driver's side, which lanes to use, the signboard for each branch, and whether your branch goes up a ramp or down into an underpass.

Around that sits the trip planning you'd expect from Yahoo Car Navi, Google Maps or TomTom: a search bar with saved places, category search nearby and along your route, place cards, directions with up to three stops, avoid tolls / highways / ferries, route cards that show distance on toll roads, and a step-by-step list where you can preview each junction view before you drive.

Built on open data: OpenStreetMap roads, OSRM routing, Overpass for junction detail and places, Photon search, and MapLibre with OpenFreeMap tiles (no API keys needed to start).

## Run it

```bash
npm install
npm run dev
```

| URL | What it does |
| --- | --- |
| `http://localhost:5173/?demo` | Offline demo drive on a synthetic network with 5 junction types, using the simulator |
| `http://localhost:5173/lab.html` | Junction View Lab: inspect each junction, drag the distance, switch sign styles, day/night, OSM vs. router-only |
| `http://localhost:5173/` | The real app: search a place (or long-press / right-click the map), tap **Directions**, pick a route, press **Simulate** or **Start** |

In the simulator (which also drops GPS inside tunnels), **Next junction** jumps to the next junction view and **×1** cycles the speed up to ×8. **◀ Lane n/N ▶** moves the simulated car between lanes so you can try the lane alerts; **Auto** (on by default) lets a simulated driver start each lane advice in the wrong lane and move over, promptly at one maneuver and only after the warning at the next.

`npm run build:artifact` makes a single self-contained HTML file (`dist-artifact/junctionnav-preview.html`) that runs the whole app on the demo network with simulated GPS and no network calls, for sandboxed preview pages. Search, routing (including stops), junction detail and category search all use the bundled demo data in that build.

### On your phone

GPS needs HTTPS. Two options:

1. `npm run dev:https` serves on your LAN with a self-signed certificate. Open `https://<your-pc-ip>:5173` on the phone and accept the warning.
2. `npm run build` and upload `dist/` to any static host (Cloudflare Pages, Netlify, Vercel, GitHub Pages). It installs as a home-screen app (PWA manifest included) and asks for a screen wake lock while navigating.

### Splash screen and accounts

The app opens on a splash screen (drawn by `index.html` itself, so it shows before the code has loaded), checks for a saved session, then shows either the app or the sign-in screen. The map loads behind it in the meantime. Demo drives and trip links start once someone is signed in.

**Sign in / Create account.** The header is an overhead sign whose two destinations are the tabs. Registration asks for name, email and a password of at least 8 characters, with a strength hint; "Keep me signed in" decides whether the session survives closing the browser (30 days) or only the tab. Errors name the field to fix. Settings shows the signed-in account with **Sign out** (and **Remove account** for browser accounts). Saved places (Home, Work, favourites, recents) belong to the account.

Two backends, chosen at build time:

| | Accounts in this browser (default) | Supabase |
| --- | --- | --- |
| Setup | None; works on GitHub Pages as is | A free Supabase project; set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` |
| Where accounts live | `localStorage` of that browser; passwords stored only as PBKDF2-SHA256 hashes (310,000 rounds, random salt) | Supabase Auth, on every device |
| Forgot password | Not recoverable; the account can be removed and registered again | Reset link by email, with a "Choose a new password" screen when the link is opened |
| Email confirmation | No | Follows your Supabase project setting |

Browser accounts keep people apart on a shared device and personalise the app, but they are not a security boundary: anyone with the device can read that browser's storage. Use Supabase when accounts must be real. Set `VITE_AUTH_REQUIRED=false` to add "Continue without an account". For GitHub Pages, add these as repository variables; the workflow passes them to the build.

### GitHub Pages

The build uses relative paths, so it works at `https://<user>.github.io/<repo>/` (or any folder on any static host). GitHub Pages serves HTTPS, so GPS works on phones.

**With GitHub Actions (rebuilds on every push).** `.github/workflows/pages.yml` installs, runs the tests, builds and deploys.

1. Create a repository on GitHub, for example `junctionnav`, and push this project to its `main` branch.
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Open the **Actions** tab and wait for "Deploy to GitHub Pages" to finish (about a minute). The site is at `https://<user>.github.io/junctionnav/`.

**Without a build (upload only).** Run `npm run build`, create a repository, upload the *contents* of `dist/` to it (Add file → Upload files; drag in everything inside `dist`, including the `assets` folder), then **Settings → Pages → Source: Deploy from a branch → main, / (root)**.

Trip links work the same on the hosted site, e.g. `https://<user>.github.io/junctionnav/?to=Suria%20KLCC&sim`.

## Search and directions

- **Search bar.** Type to search (Photon, OSM-based) or paste coordinates like `3.139, 101.6869`. With an empty search box you get Home, Work, saved places and recent destinations, kept in this browser.
- **Categories.** Petrol, EV charging, parking, food, rest areas (R&R, SA/PA) and convenience stores. Results come from OpenStreetMap via Overpass, nearest first, with numbered pins on the map.
- **Place card.** Directions, Start (go straight away on the fastest route), Save, Set as Home / Work, copy coordinates. Long-press or right-click the map to drop a pin.
- **Directions.** From (your location by default), up to 3 stops, and To, with swap. Toggle **Avoid tolls**, **Avoid highways** and **Avoid ferries**; the choice is remembered.
- **Route cards.** Fastest / Toll-free / Shorter / Alternative labels, travel time, arrival time, distance, the main roads used, kilometres on toll roads, and how many junction views the route has. When the fastest routes use tolls, a toll-free option is requested alongside.
- **Steps.** Every maneuver with distance. Tap a step to see it on the map; steps with a junction view have a **Junction view** button that opens a preview with a drive-up slider.
- **Arriving.** Within 300 m of the destination the app says "You have reached your destination" (with the side of the road when known) and voice guidance stops; the map keeps showing the last stretch. Navigation ends at the end of the route, or after the car has been parked for 30 seconds inside that zone. Leaving the route there (into a car park, say) does not trigger a reroute.
- **While driving.** Tap the green banner for the remaining steps. The search button finds categories along the route ahead (within 400 m of it, next 60 km) so you can **Add as stop** or **Go here** instead. The ETA line shows the next stop when you have one.

### Trip links

A URL can plan a trip and start the simulator, so a test drive is one link:

```
http://localhost:5173/?from=road:E2~3&via=Plaza%20Tol%20Sungai%20Besi@auto&via=road:E19|SUKE&to=Suria%20KLCC&sim
```

That one starts on the North–South Expressway (E2) about 3 km before the Sungai Besi toll plaza, goes through the toll, joins SUKE (E19) and ends at KLCC.

| Parameter | Meaning |
| --- | --- |
| `from`, `to` | A place: `lat,lng`, `lat,lng@heading`, free text (searched with the place search), or `here`. `from` defaults to your location. |
| `via` | A stop, repeatable (up to 3 are used). Same formats, plus `road:` points. |
| `road:REF` | A point on a road by ref (`E19`) or name (`SUKE`), with `|` for alternatives. Between two places it is the point with the least detour on the carriageway leading from one to the other; on `from` it is a point on that road about `~km` before the next place (default 3 km). The router is told the direction of travel there, so it snaps to the correct carriageway rather than the opposite one or a road underneath. |
| `name@auto` | Pass this stop in the direction you arrive from (useful for toll plazas). `name@350` gives a heading. |
| `sim` | Start the simulator once the route is ready; `sim=4` for ×4. |
| `avoid` | `tolls`, `highways`, `ferries`, comma separated, for this trip only. |

Road points use Overpass and places use the search service, so trip links need the full app with internet access; the offline preview shows a note instead.

### Lane alerts

Before an exit, entrance ramp, junction, divider split or turn that needs a particular lane, the app tells you early which lane to be in, and warns again if your position says you are not there yet.

- **Early advice.** When the lanes matter, a voice prompt like "Exit 114 in 1.2 kilometres. Move to the left lane." comes well ahead of the maneuver. How early depends on your speed and how many lanes you may need to cross: on highways 0.9 to 3 km out, in town 220 to 800 m. Lane data comes from the router (OSM `turn:lanes`); without it the app only advises on fast roads where the side is obvious ("Start moving left").
- **On screen.** The banner's lane row marks the lanes to use and, when known, the lane you are in. A cue strip under it says "Use the left lane · 1.1 km", turns amber with "Move one lane left" when you are outside the right lanes, and green with "You're in a correct lane" once you are.
- **GPS lane check.** The app smooths your sideways position over a few seconds and compares it with the lane layout (3.5 m lanes around the road line). It only calls a lane when GPS accuracy is 6 m or better and the position is clearly inside a lane; it only warns when you are most of a lane outside the advised ones for at least 4 seconds. Then it plays a short chime and says "You're not in a lane for exit 114. Move 2 lanes to the left." At most three warnings per maneuver, spaced out so they do not nag.
- **Too late.** Close to the split (about 6 seconds out on highways) it stops asking you to move and says once: "If you can't change lanes safely, stay in your lane. The route will update." Missing an exit is cheaper than a last-second lane change; the app reroutes.
- **Settings.** Lane alerts: *Early lane advice + GPS lane check* (default), *Early lane advice only*, or *Off*.

Phone GPS is usually accurate to 3 to 5 m in open sky and worse between tall buildings, under flyovers and in tunnels, and OSM road lines are not always on the carriageway centre. So the lane check is deliberately cautious: it stays quiet when unsure instead of guessing, and the early advice works without it. A phone with dual-frequency GPS (L1 + L5) gives noticeably better lane estimates.

### Tunnel signs

Before a tunnel the app shows an advance sign under the banner, says it out loud, and keeps guiding inside even when GPS drops out.

- **The sign.** A tunnel pictogram, a name plate with the tunnel's name and length, and a headlights panel, drawn in the style of the signboard theme: a yellow diamond warning sign for Malaysia and the US, a blue square information sign for Japan, Europe and the UK. Plate colours follow the expressway or ordinary road colours of the theme. Next to it: the distance to the entrance. It appears about 1 km before the tunnel on fast roads and 400 m in town, for tunnels of 150 m or more (short underpasses below junctions are skipped). Tap it to hide it for that tunnel.
- **Voice.** For tunnels of 250 m or more, one prompt at the first quiet moment within about 650 m (260 m in town): "Tunnel ahead in 600 metres: Bukit Demo Tunnel, 500 metres long. Turn on your headlights." Tunnels over 1 km add that GPS may drop out inside and guidance carries on.
- **Inside.** The card turns dark and shows the distance to the exit with a progress bar. On the map, tunnel stretches of the route are drawn dashed.
- **No GPS in the tunnel.** When fixes stop, or arrive with poor accuracy or far off the road, the position is estimated along the route at your last speed (dead reckoning), up to 150 m past the exit. The card says "No GPS · position estimated", there is no false off-route or reroute, and the first good fix after the tunnel corrects the estimate, also backwards if you were stuck in traffic.
- **Lanes and tunnels.** When a junction comes soon after a tunnel, the lane advice moves to before the entrance, because changing lanes inside is often not allowed: "The junction in 1.8 kilometres, after the tunnel. Move to the right 2 lanes before the tunnel." The GPS lane check is off inside tunnels.
- **Data.** Tunnel stretches come from the router (OSRM marks roads with the `tunnel` class at each intersection) and from OSM: one Overpass query per 20 km of route ahead fetches tunnel ways along the route line and matches them onto it (same direction, within 14 m), which gives exact ends and the name from `tunnel:name` (or `tunnel:name:en`, `tunnel:name:ja` for the UI language). Without Overpass the router's stretches still work, with "Tunnel" as the name.
- **Settings.** *Tunnels: Tunnel sign and voice warning* turns the card and prompt off. Dead reckoning always stays on.

The demo route starts with a 500 m tunnel through a hill, Terowong Bukit Demo, just before the first junction. The simulator stops sending GPS inside it, so you can watch the estimate carry the position through.

### Offline maps (Peninsular Malaysia)

Download the whole of Peninsular Malaysia (with Singapore) once, and the app keeps working with no signal: the map, directions with lane advice and junction views, place search, the category buttons and tunnel signs.

- **Download.** Settings → *Offline maps* → **Download**. It shows the size first (about 280 MB to download, 320 MB on the phone), then a progress bar. **Pause** and **Resume** work, also after closing the app: finished parts are kept. Wi‑Fi is best, and the page has to stay open while it downloads.
- **Using it.** *Use them when there is no internet* (default) keeps the online services and switches to the offline maps the moment the connection drops or a server does not answer. *Always use them* saves mobile data. The switch back to the online map waits until the connection has held for 30 seconds and you are not driving, so patchy coverage does not flip the map.
- **Updates.** The maps are rebuilt every month with fresh OpenStreetMap data. *Check for update* shows when newer maps are out; the old ones keep working until the new download finishes. **Delete** frees the space.
- **Opening with no internet.** A service worker keeps the app itself on the phone, so it opens without a connection once it has been opened online.
- **What is different offline.** Routes come from the app's own router (A* over a compact road graph with one-way streets, turn restrictions, toll and highway avoidance, exits, `destination` signs and `turn:lanes`). It is simpler than OSRM: no traffic, plainer timing at junctions, and long trips stick to main roads once they are well away from both ends. Buildings around junction views need internet. Browsers: Chrome, Edge or Samsung Internet on Android, Chrome or Edge on a computer (iPhone Safari cannot write the files yet).

**How it is built and hosted.** `.github/workflows/offline-pack.yml` runs `scripts/offline/build-pack.sh` on GitHub's servers: OSM data from Geofabrik clipped to `scripts/offline/peninsular-my.geojson` with osmium; `build-graph.mjs` turns the roads into `graph.bin` (vertices, segments, shapes, way classes and speeds, flags, restrictions, exit numbers and a spatial grid, all typed arrays); `build-places.mjs` makes `places.bin` from named places, businesses and streets; `pmtiles extract` cuts vector tiles (zoom 15, or 14 if they would not fit) from the latest Protomaps build; `finish-pack.mjs` adds fonts and map symbols, compresses, splits everything into 45 MB parts and writes `manifest.json`. The pack goes into the Actions cache and the Pages workflow publishes the newest one with the site under `offline/` (GitHub Pages allows 1 GB per site). The pack workflow runs separately, so app updates deploy in a couple of minutes and never cancel it; it rebuilds on the 2nd of each month, when the builder scripts change, or from **Actions → Offline maps → Run workflow**, and starts a fresh Pages deploy when a new pack is ready. A build takes 10 to 20 minutes; until the first one finishes, Settings says the maps are being prepared and checks again on its own. If a build fails, the site keeps the previous pack. Set the repository variable `OFFLINE_MAPS` to `off` to skip it.

In the browser the pack lives in the origin private file system: compressed files are unpacked while they download, tiles stay in their parts and are joined as one Blob that MapLibre reads through the PMTiles protocol, and a web worker loads the road graph and place index to answer routing, search, junction and tunnel queries.

### Route options and the routing server

Avoid options use OSRM's `exclude` parameter. Public servers may not support it, or only support one exclusion at a time. The app detects this, applies what the server accepts, shows a note ("This routing server can't avoid toll roads…"), and lists routes that honour your choice first. Your own OSRM built with `server/osrm/setup.sh` supports tolls, highways and ferries in any combination (the script patches the car profile before processing).

## How the junction view works

1. **Route.** OSRM (`steps=true`) returns each maneuver's type (`off ramp`, `on ramp`, `fork`, `merge`…), the lanes at the maneuver with the valid ones flagged, destination and exit-number text, and the bearings of every road at the intersection.
2. **Detection** (`src/junction/detect.ts`). Ramps, exits, forks and merges always get a view. Turns and "continue" maneuvers get one when another enterable road leaves within 50° of yours, which catches divider splits and flyover/underpass forks. The view appears 1 km out on highways and about 380 m out in town.
3. **Detail** (`src/junction/osmdata.ts`). One Overpass query per batch of up to 6 junctions fetches the roads within 320 m: `lanes`, `turn:lanes`, `destination`, `destination:ref`, `layer`, `bridge`, `tunnel`, and `motorway_junction` exit numbers and names. Results are cached and prefetched about 12 km ahead.
4. **Scene** (`src/junction/scene.ts`). Builds a small road graph around the decision node, walks each branch, lines the branch lane groups up with the router's lane data (so the exit lane really peels off the correct side), turns OSM layers into deck heights so ramps climb to flyovers or drop into underpasses, and writes a sign spec for each branch. Without OSM detail it falls back to a schematic built from the router's bearings and lanes, so a view is always available.
5. **Render** (`src/junction/render3d.ts`). A three.js camera sits on the approach and glides toward the split as you get closer. It draws asphalt, lane markings, guardrails, embankment walls and viaducts with pillars, trenches and tunnel portals, the opposite carriageway, trees, an overhead gantry, and a large arrow along your lane group.
6. **Signs** (`src/junction/signs.ts`). Canvas-drawn signboards with route shields and exit tabs, themed for Malaysia, Japan, the US, continental Europe, the UK, or generic. The theme is picked from the route location unless you choose one.
7. **Surroundings** (`src/junction/surroundings.ts`, `surroundRender.ts`). For the next few junctions the app also fetches what is around them from OSM: buildings (extruded using `height` or `building:levels`), land use and water, rivers and railways, oil palm estates (drawn as palm rows), forests and parks (trees), and labels for nearby roads, petrol stations, rest areas, landmarks and town names. Turn it off in Settings to save data; the view then shows roads only.
8. **Modes.** "3D" illustration, "Map" (a tilted MapLibre close-up of the real junction), or "Both" side by side. Tap the mode button on the view to switch.
9. **Size.** The view and the main map share the screen 1:3. On a phone held upright the view takes a quarter of the space under the banner and the map the other three quarters; with the guidance docked beside the map (landscape, desktop) the view is a third of the map's height. Signs, chips and buttons shrink for the shorter view so the split stays visible.

## Data sources and limits

| Purpose | Default | Notes |
| --- | --- | --- |
| Base map | OpenFreeMap (Liberty, Bright, Positron, Dark) | No key. MapTiler styles need a key. Any MapLibre style URL works. |
| Routing | `routing.openstreetmap.de` (FOSSGIS OSRM) | Public demo server for light use. Self-host for real driving (below). |
| Junction detail | `overpass-api.de`, `overpass.kumi.systems` | Shared public servers with rate limits. Fine for testing and personal use. |
| Search | `photon.komoot.io` | OSM-based, allows search-as-you-type. Fair use only. |
| Offline maps | Geofabrik OSM extract, Protomaps tiles | Built monthly on GitHub Actions, served from your GitHub Pages site (soft limit 100 GB of traffic a month, so roughly 350 full downloads). |

Map data © OpenStreetMap contributors. Attribution is shown on the map.

### Why not Google Maps?

Google's Maps Platform service terms say content from the Directions and Routes APIs must not be used with a non-Google map, and the web routing APIs return maneuver types but not per-lane guidance or signboard text, which this view depends on. Google's turn-by-turn product (Navigation SDK) is for native Android and iOS apps. Showing a Google base map under an OSRM route would be possible, but the OSM stack gives you everything the junction view needs.

If you later want commercial data, Mapbox, HERE and TomTom routing APIs include lane guidance and signpost text, and some providers sell pre-drawn junction-view images for certain countries. Check what is available for your region. Routing is behind a small `Router` interface (`src/routing/types.ts`), so another provider can be added as an adapter.

## Self-host routing

OSRM keeps the OSM `lanes`, `turn:lanes` and `destination` tags the junction view uses.

```bash
cd server/osrm
./setup.sh malaysia      # also: japan, kanto, kansai, or a Geofabrik .osm.pbf URL
docker compose up -d
```

Then set `VITE_ROUTER_URL=http://<host>:5000/route/v1/driving` in `.env` (or in the app's Settings). Malaysia/Singapore/Brunei processes in a few GB of RAM; all of Japan needs roughly 32 GB, so start with a region extract.

For heavy use of junction detail, run your own Overpass instance on a regional extract (for example the `wiktorn/overpass-api` Docker image) and point `VITE_OVERPASS_URLS` at it.

## Configuration

Copy `.env.example` to `.env`. Every value is optional.

| Variable | Default |
| --- | --- |
| `VITE_ROUTER_URL` | FOSSGIS OSRM car endpoint |
| `VITE_OVERPASS_URLS` | two public Overpass endpoints, tried in order |
| `VITE_PHOTON_URL` | `https://photon.komoot.io` |
| `VITE_MAP_STYLE` | `ofm-liberty` |
| `VITE_MAPTILER_KEY`, `VITE_CUSTOM_STYLE_URL` | empty |

Users can also change map style, sign style, language (English, Bahasa Melayu, Japanese), units, voice, junction-view mode and server URLs in **Settings**.

## Project layout

```
src/
  main.ts                 app controller (plan → preview → navigate, rerouting, prompts)
  geo/geo.ts              distances, bearings, polylines, local metric frames
  routing/                OSRM adapter (avoid options, stops, toll distance), instruction text (en/ms/ja)
  search/                 place search (Photon) and category search nearby / along route (Overpass)
  state/                  settings and saved places
  nav/engine.ts           snapping, current maneuver, off-route, voice prompt timing
  nav/lanes.ts            lane advisor: target lanes, advice distance, GPS lane estimate
  nav/tunnels.ts          tunnel stretches (router classes + OSM ways), loading ahead, state
  nav/sources.ts          GPS, simulator, speech, screen wake lock
  offline/                offline maps: pack storage and download, road graph, router, place index,
                          worker, offline map style, online/offline provider switch
  map/                    MapLibre main map, style registry, offline demo style
  junction/detect.ts      which maneuvers get a junction view
  junction/osmdata.ts     Overpass fetch, batching and cache
  junction/scene.ts       junction geometry, lane alignment, elevation, sign specs
  junction/render3d.ts    three.js junction renderer
  junction/signs.ts       signboard drawing (direction and tunnel signs) and country themes
  junction/zoomMap.ts     tilted map close-up
  ui/                     banner, junction panel and preview, tunnel card, steps list, icons, settings
  demo/                   synthetic OSM + OSRM data and offline providers for the demo and tests
  lab/lab.ts              Junction View Lab page
scripts/offline/          offline pack builder (run by the Pages workflow)
scripts/sw-plugin.ts      writes the service worker that keeps the app shell for offline use
server/osrm/              Docker setup for your own OSRM
tests/                    vitest suites
```

## Customising signboards

`SIGN_THEMES` in `src/junction/signs.ts` holds, per country: sign colours for expressways and ordinary roads, the exit-tab label, the lane edge-line colour, and shield rules (a regex on the route ref mapped to a shape and colours). `guessTheme()` picks a theme from rough country bounding boxes. The themes are close approximations of local practice; adjust them to match the signs you drive past.

## Tests

```bash
npm test          # geometry, OSRM parsing, route options, stops, instructions, nav engine, lane alerts, tunnels, scene builder,
                  # offline pack (builds a pack from the demo network with the real scripts, then routes, searches and reads junctions)
npm run typecheck
```

## Known limits and next steps

- **No toll fees.** Routes show kilometres on toll roads, not ringgit or yen; open fee tables (PLUS, NEXCO) would be needed for that.
- **Stops and alternatives.** OSRM only returns alternative routes for trips without stops.
- **Data quality follows OSM tagging.** Where `lanes`, `turn:lanes` or `destination` tags are missing, the view falls back to typical lane counts and signs that show road names or refs.
- **Public servers are not for production.** Long routes trigger several Overpass queries; the app batches, caches and backs off, but self-hosting is the reliable path.
- **Phone GPS cannot tell levels apart and only roughly tells lanes apart.** Off-route detection on a flyover vs. the road below only triggers once the roads separate horizontally; the lane check stays quiet when GPS is not clearly good enough (see Lane alerts).
- Not yet: roundabout junction views, traffic, offline maps, speed limits, OSM `destination_sign` relations for real gantry layouts, and lazy-loading three.js to shrink the first load (about 300 KB gzipped for the app plus 150 KB for the 3D view).
- iOS Safari needs a tap before speech works (handled by the Start button) and pauses GPS when the screen locks.

Keep your eyes on the road: set the destination before driving, mount the phone, and follow actual road signs where they differ from the app.
