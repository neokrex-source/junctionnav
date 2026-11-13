# JunctionNav

Developed by **Dr. Mohd Anuaruddin Ahmadon**, Universiti Teknologi PETRONAS.

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

### Android app

**Install:** on the phone, open [JunctionNav.apk](https://github.com/neokrex-source/junctionnav/releases/download/android/JunctionNav.apk) (also linked from the website's Settings), tap the downloaded file, allow installs from your browser when Android asks, and tap **Install**. It needs Android 7 or newer with an up to date Android System WebView. New versions install over the old one and keep the account, saved places and offline maps.

It is this same web app packed with [Capacitor](https://capacitorjs.com), so every file is inside the installer and it opens with no internet from the very first start. Inside the app:

- **Voice** uses Android's own text to speech (`@capacitor-community/text-to-speech`), since the Android WebView has no speech synthesis. Install a Malay or Japanese voice in Android's settings for those languages.
- **The screen stays on** while navigating (`@capacitor-community/keep-awake`), as the Wake Lock API does in the browser.
- **GPS** asks for location permission the first time, like the browser does.
- **Offline maps** download from the website (`VITE_PACK_URL` in `.env.android`) into the app's own storage, which Android never clears to make room.
- **The back button** closes Settings, sheets and the junction preview first; while navigating it sends the app to the background instead of closing it.
- **Status bar** icons follow the theme: light over the purple banner and at night, dark over the day map.
- **App version** (Settings, only in the app): *Built into the app* runs the copy inside the installer; it opens with no internet from the first start and changes when a newer installer is installed. *Latest from the website* downloads the newest website build into the app (the files listed in the site's `app-files.json`, about 2.3 MB, each checked against its size) and runs it in place of the built-in copy, by pointing Capacitor's WebView server at that folder (`src/native/appMode.ts`). The address stays `https://localhost`, so both modes share the account, saved places and offline maps, and Android's voice, keep-awake and the back button keep working (the website build recognises the app from Capacitor's bridge, `src/platform.ts`). At each start website mode looks for a newer build and switches to it, or after the drive if you are navigating; offline it runs the copy it has. After a new installer, Capacitor starts the built-in copy once and website mode moves on to the latest build again. Features that need new native parts (a new plugin) still arrive with a new installer.

**Build:** `.github/workflows/android.yml` runs on every push that touches the app: `npm run build:android` (the web app in mode `android`, without the service worker, then `cap sync`), Gradle `assembleRelease`, and publishes `JunctionNav.apk` on the `android` release of the public site repository (see Publishing), with the run number as the version. It then installs the debug build on an Android emulator, drives it with Playwright (sign up, offline storage, voice, keeping awake, GPS, the places around you, a Google Maps share link and a rough address in search, the demo drive's 3D junction view, the back button) and pushes screenshots and `report.json` to the `android-check` branch. Locally, with Android Studio or the SDK installed: `npm run build:android`, then `cd android && ./gradlew assembleDebug` (or open `android/` in Android Studio).

**Signing:** set the repository secrets `ANDROID_KEYSTORE_BASE64` (a base64 keystore), `ANDROID_KEYSTORE_PASSWORD` and optionally `ANDROID_KEY_ALIAS` (default `junctionnav`) to sign with your own key. Without them, the first build makes a key and keeps it in the Actions cache (`android-signing-v1`), so later builds sign with the same key and install as updates; the weekly run keeps it from expiring. Switching keys later means uninstalling the app once.

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

**Sign in with Google and Apple.** With Supabase, the sign-in screen also offers **Continue with Google** and **Continue with Apple**, each shown only when it is turned on in the Supabase project (the app asks the project's `/auth/v1/settings`). On the website the page goes to Google's or Apple's sign-in and comes back signed in; *Keep me signed in* applies as for email. In the Android app the sign-in page opens in the phone's browser (Google does not allow it inside an app) and comes back to the app by its own link, `io.github.neokrexsource.junctionnav://auth-callback`. Cancelling, or a provider that is not turned on, comes back to the sign-in screen with a line saying so. (`src/auth/supabaseAuth.ts`, `src/native/social.ts`.)

**Setting up Supabase** (free plan; once):

1. Create a project at [supabase.com](https://supabase.com). In **Project Settings → API** copy the *Project URL* and the *anon public* key, and add them in this repository under **Settings → Secrets and variables → Actions → Variables** as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The Pages and Android workflows pass them to their builds.
2. **SQL Editor → New query**: paste [`supabase/shared-places.sql`](supabase/shared-places.sql) and run it. It makes the shared places table with its rules (below); running it again is harmless.
3. **Authentication → URL Configuration**: *Site URL* `https://neokrex-source.github.io/junctionnav/`, and under *Redirect URLs* add `https://neokrex-source.github.io/junctionnav/**` and `io.github.neokrexsource.junctionnav://auth-callback` (the Android app).
4. **Google**: in [Google Cloud console](https://console.cloud.google.com) → *APIs & Services* → set up the *OAuth consent screen*, then *Credentials → Create credentials → OAuth client ID → Web application*, with the authorised redirect URI `https://<project>.supabase.co/auth/v1/callback`. Paste its client ID and secret in Supabase under **Authentication → Sign In / Providers → Google**, and turn it on.
5. **Apple** needs the paid Apple Developer Program. In *Certificates, Identifiers & Profiles*: an App ID with *Sign in with Apple*, a *Services ID* (its identifier is the client ID) whose web domain is `<project>.supabase.co` and return URL `https://<project>.supabase.co/auth/v1/callback`, and a *Sign in with Apple* key (.p8). Supabase's Apple page makes the client secret from the key, Key ID, Team ID and Services ID; that secret runs out after six months, so make a new one before then. Turn on **Authentication → Sign In / Providers → Apple**.
6. Run **Actions → Deploy to GitHub Pages** and **Android app**. Accounts made in a browser before this stay in that browser; people sign up again (or with Google or Apple) to have one account everywhere.

### GitHub Pages

The build uses relative paths, so it works at `https://<user>.github.io/<repo>/` (or any folder on any static host). GitHub Pages serves HTTPS, so GPS works on phones.

**Publishing.** `.github/workflows/pages.yml` installs, runs the tests, builds, adds the offline maps and places, and publishes; `android.yml` puts the installer on the `android` release and `traffic-news.yml` writes the traffic feed to the `traffic-news` branch. Where they publish is the repository variable `SITE_REPO` (default `neokrex-source/junctionnav`):

- **One public repository** (the simple setup): `SITE_REPO` is the repository itself. In it, **Settings → Pages → Build and deployment → Source: GitHub Actions**; the site is at `https://<user>.github.io/<repo>/`.
- **Private source, public site.** The source lives in a private repository (`neokrex-source/junctionnav-src`) and only the built app is published to the public `neokrex-source/junctionnav`: the website with its offline maps and places on the `gh-pages` branch (GitHub Pages serves it at `https://neokrex-source.github.io/junctionnav/`), a short front page on `main` (`scripts/site/public/README.md`), the `android` release and the `traffic-news` branch. The addresses are the ones the site always had, so links, the traffic feed and the apps already installed keep working. The workflows write there with `scripts/site/publish.sh`, which pushes a folder as the one commit of a branch (fetching the previous commit without its files first, so unchanged offline maps and places are not sent again), and with `gh release` for the installer, using the `SITE_TOKEN` secret.

  Setting it up, on github.com: (1) rename the repository to `junctionnav-src` (Settings → General → Repository name); (2) create a new **public** repository named `junctionnav`, empty; (3) make a fine-grained personal access token (Settings → Developer settings → Fine-grained tokens → Generate new token) with **Repository access: Only select repositories → junctionnav** and **Repository permissions → Contents: Read and write**, and copy it; (4) in `junctionnav-src`, **Settings → Secrets and variables → Actions → New repository secret**, name `SITE_TOKEN`, paste the token; (5) run **Actions → Deploy to GitHub Pages → Run workflow** (and Android app, Traffic news) in `junctionnav-src`; (6) in `junctionnav`, **Settings → Pages → Deploy from a branch → gh-pages, / (root)**; (7) in `junctionnav-src`, **Settings → General → Change repository visibility → Private**. When the token expires, publishing stops with a "Cannot publish" note in Actions (the site keeps its last version): make a new one and replace the secret.

**Without a build (upload only).** Run `npm run build`, create a repository, upload the *contents* of `dist/` to it (Add file → Upload files; drag in everything inside `dist`, including the `assets` folder), then **Settings → Pages → Source: Deploy from a branch → main, / (root)**.

Trip links work the same on the hosted site, e.g. `https://<user>.github.io/junctionnav/?to=Suria%20KLCC&sim`.

## Look: three themes, each by day and by night

Settings → Map → *Theme* has three looks. Each has a bright day version and a dark night version, and each changes everything together: the page, the map, the route line, the speed instrument and the 3D junction views.

| Theme | Day | Night | Type | Speed instrument |
| --- | --- | --- | --- | --- |
| **JunctionNav** (the default) | White panels on light grey, violet banner and route | Near-black, deep purple panels, glowing lilac route | Saira, Saira Condensed | A round bubble, the limit as a road sign on its corner |
| **Fighter jet** | Dark inks on a light grey-green moving map | Phosphor green on black, like a head-up display | B612, the typeface Airbus drew for cockpit displays | A HUD speed tape (below) |
| **Casual** | Cream map with mint parks and peach expressways, coral accents | Cosy navy with warm roads | Nunito, rounded | A dial with green, amber and red zones |

- **Fighter jet.** The instruments of a fighter's head-up display. The speed is a **speed tape**: the scale runs past a boxed readout of your speed, and the speed limit is the red and white "barber pole" band an aircraft's tape has above its maximum speed, with an amber band below it for the warning margin. `LIM 110` and `HDG 284` (your heading) are printed on it. The box turns amber near the limit and blinks red over it. The route on the map is the **magenta line** of a flight plan over green vector roads, amber through junctions; panels are dark glass with thin lit outlines and square corners; a speed camera's chip carries a threat diamond.
- **Casual.** Warm and friendly: pill-shaped buttons, a rounded banner in coral, a teal route, and the speed on a small dial whose green, amber and red zones end at your limit.
- **JunctionNav.** Purple with white, light grey and black, as before: the guidance banner in violet with white lettering by day and dark plum with a lilac arrow by night, a lit lane line along its lower edge, and the route line the brightest thing on the map. Warnings use amber, confirmations green.
- **Junction views.** The 3D views take the look too: the greys of roads, decks and buildings carry each look's cast (purple, green, warm cream or navy), under its own sky. The route through a junction stays orange in every look (amber in the jet's), so the junction view and the map always match (`src/theme/tint.ts`).

- **Day and night switch on their own.** With Settings → Appearance on *Automatic*, the app turns dark at sunset and bright at sunrise where you are (worked out from the sun's position, so it is right in Kuala Lumpur in June and in Tokyo in December). It checks every minute and switches everything at once: the page, the map, the route line, the junction views and the map under them. *Always bright* and *Always dark* are there too.
- **Map.** The JunctionNav map style is drawn in the theme's palette from TomTom's or OpenFreeMap's vector tiles online and from the offline pack's Protomaps tiles offline: quiet grey land, water and parks, and roads in three tiers with expressways tinted purple: white by day, and at night soft lavender greys that get brighter with the size of the road, so streets, main roads and expressways each stand out clearly from the dark ground and from one another while the glowing route line stays the brightest thing on the map. Labels have no icons. The junction views (3D and map) use the same hues.
- **Type.** Each theme's typefaces are bundled with the app so they also work offline (the browser fetches only the ones of the theme in use). Road signs in the junction view keep their own condensed lettering.
- **Code.** JunctionNav's CSS tokens at the top of `src/styles/app.css`, the other two themes' in `src/styles/themes.css` (under `:root[data-skin="jet"]` and `:root[data-skin="casual"]`); the same colours for the map and route line in `src/theme/palette.ts` (`THEMES`); map styles in `src/map/techStyle.ts` and `src/map/tomtomStyle.ts`; the speed instrument in `src/ui/speedMeter.ts`; the sun in `src/state/daylight.ts`. `scripts/dev/speed-check.cjs` opens all six looks in a browser and checks colours, typefaces, instruments and that nothing overlaps.

### Logo

The mark is the road ahead from the driver's seat, splitting at the horizon: the approach in perspective with its lane dashes, the branch not taken fading off to the left, and the branch taken curving right, lit from lilac into the orange the app gives every junction, ending in an arrowhead. It is drawn once, in `scripts/brand/mark.mjs`, which writes the app icon (`public/icon.svg`), a maskable version and the mark on its own; `scripts/brand/icons.cjs` makes every bitmap from those (web icons, the Android launcher icons with their adaptive and themed layers, and the Android launch screens). The web splash draws the same mark stroke by stroke. To change the logo, edit `mark.mjs` and run `node scripts/brand/mark.mjs && node scripts/brand/icons.cjs`.

## Search and directions

- **Search bar.** Type a place or an address (TomTom with a key, else Photon, together with the places around you). With an empty search box you get Home, Work, saved places and recent destinations, kept in this browser. The search box also takes (`src/search/smartSearch.ts`):
  - **Coordinates** in the forms people copy them: `3.139, 101.6869`, `101.6869, 3.139` (longitude first), `3.139°N 101.6869°E`, `N 3.139 E 101.6869`, degrees, minutes and seconds the way Google Maps writes them (`3°08'20.4"N 101°41'12.8"E`), degrees and decimal minutes, and `geo:` links. Picking the point shows what is there.
  - **Plus codes**: full (`6PM35P56+4W`) or short with the town (`5P56+4W Kuala Lumpur`), completed from the town, or from where you are when there is none.
  - **Google Maps links**, on their own or inside shared text: a place (its exact position), a dropped pin, a map view, a search (looked up on the map it showed) or directions (the destination). Short share links (`maps.app.goo.gl/…`) work in the Android app, which follows the link itself; a web page is not allowed to read where another site's link leads, so the website says to open it and paste the long link from the address bar instead.
  - **Rough addresses** like `No 12, Jln SS2/24, 47300 PJ`: shorthand is written out (Jln, Tmn, Kg, Lrg, Bkt, Sg, PJ, KL and so on) and unit, floor, block and lot numbers left out before searching. When the exact address is not found, broader versions are tried in turn (without the house number, the street and area, the postcode and town) and the result is marked **Approx.** The places around you add where a street or postcode roughly is, from their own addresses: the middle of the places on that street (in that postcode or town), or with that postcode, also marked **Approx.**, and that works without internet too.
- **Categories.** Petrol, EV charging, parking, food, rest areas (R&R, SA/PA) and convenience stores. Results come from TomTom (or OpenStreetMap via Overpass) plus the places around you (below), nearest first, with numbered pins on the map.
- **Places around you.** Restaurants, cafés, shops, petrol stations, clinics, mosques, schools, banks and more for the area within 100 km of where you are (see below), as icons on the map, in search and in the category buttons, also without internet.
- **Place card.** Directions, Start (go straight away on the fastest route), Save, Set as Home / Work, copy coordinates.
- **Pins.** The pin button on the map (or a long-press, or a right-click) drops a pin. With the button a crosshair comes up: move the map or tap where the pin goes, and pick its **direction of travel**: along the road under it either way (read from the map itself, with the road's name, and only the allowed way on a one-way street), any direction, or turned by hand on the ring around it (the arrow keys turn it too). Pins stay on the map until you remove them, can be dragged to a new spot, and are listed in the search box with your saved places. Tap one for its card: Directions, Start, its direction of travel, Move, Remove pin, Save, Set as Home or Work. In the directions, the pin button beside From, a stop or To chooses that point on the map the same way, and tapping one of your pins makes it the destination. Settings → Map shows how many pins there are, with **Remove all pins**. Pins are kept in this browser with your account (`src/pins/`, `src/map/pinsLayer.ts`). `scripts/dev/pins-check.cjs` checks it all in a browser.
- **Arriving in a direction.** A destination with a direction of travel (a pin's, or a trip link's `@heading`) is routed to arrive that way, so the route ends on the right carriageway of a divided road. OSRM and the offline router take it as the destination's bearing. TomTom has no such setting, so the app keeps TomTom's routes that already arrive that way, else asks for one through a point 45 m before the destination along the heading (folded back into one leg); if that does not work either, the OpenStreetMap router plans it, without live traffic, and the route options say so. The route options show "Arriving heading west (270°)" and the map draws the direction as an arrow beside the destination. Reroutes keep it.
- **Directions.** From (your location by default), up to 3 stops, and To, with swap. Toggle **Avoid tolls**, **Avoid highways** and **Avoid ferries**; the choice is remembered.
- **Route cards.** Fastest / Toll-free / Shorter / Alternative labels, travel time, arrival time, distance, the main roads used, kilometres on toll roads, and how many junction views the route has. When the fastest routes use tolls, a toll-free option is requested alongside.
- **Steps.** Every maneuver with distance. Tap a step to see it on the map; steps with a junction view have a **Junction view** button that opens a preview with a drive-up slider.
- **Arriving.** Within 300 m of the destination the app says "You have reached your destination" (with the side of the road when known) and voice guidance stops; the map keeps showing the last stretch. Navigation ends at the end of the route, or after the car has been parked for 30 seconds inside that zone. Leaving the route there (into a car park, say) does not trigger a reroute.
- **Map scale and recenter.** While navigating, the button above the speed shows the map scale, the length the scale bar stands for at your car: 1 km shows the area around, 100 m the streets close up. Tap it to step through *Auto*, 1 km, 500 m, 200 m and 100 m; Auto keeps 100 m between turns and junctions, junction view open or not, and 20 m at each one (see below). Pinching or the mouse wheel sets the scale too, settling on 100, 150, 200, 300, 500, 700 m or 1 km, and the choice is remembered. Move the map away and the button turns into **Re-centre**, which brings the map back to your car at the same scale. The scale bar above it is measured at the car (on a tilted map the middle of the screen is much further away).
- **The car stays in view.** Moving the map by hand stops it following the car. As soon as the car icon comes within about an eighth of the screen of the edge of the visible map (the area between the guidance panels and the bottom cards), or leaves it, the map goes back to following it, centred and turned to the direction of travel. The same happens after 25 seconds of driving without touching the map. A finger on the map within the last 4 seconds means you are looking around, so it waits that long. A touch whose release the phone never reports cannot freeze the camera either: after 6 seconds without any touch the camera moves on. Between GPS fixes the icon glides to its new position in step with the camera, so it stays put on screen instead of jumping ahead each second.
- **Alternative routes ready.** During a single-destination drive the app keeps up to three alternative routes in hand: the other routes from planning to begin with, then fresh ones from the car's position every two minutes or 3 km (and right after any reroute), compared by shape so each really differs (`src/nav/alternatives.ts`). Leave the route onto one of them and guidance switches to it at once, with no wait for the router and no connection needed, and says the new arrival time; the old route becomes one of the alternatives. Off every alternative, the router plans a new route from where you are as before, and its other routes become the new alternatives.
- **When the map cannot load.** A failed start (no signal yet when the app opens, a dropped request) is retried twice, after 3 and 8 seconds. If the usual map still does not come, the offline maps (when downloaded) or OpenStreetMap's simpler map take over, and the app keeps checking the usual map's server every 45 seconds and whenever the connection comes back, switching back as soon as it answers.
- **Close-up at turns and junctions.** On every scale, the map zooms in to 20 m at every turn, fork, divider, ramp, exit, entrance and junction, and comes back out to 100 m (or the scale picked with the scale button) once past it: it is all the way in within 100 m either side of the junction (the dark orange stretch of the route), eases in over the few seconds before (starting a little earlier at speed, so the camera is really at 20 m by the 100 m mark) and back out over the 80 m after (`closeWeight` and `CLOSE_WITHIN` in `src/map/mapView.ts`). While it is in close, the route line and the turn arrow are drawn thin so the road and its lanes show beside them. The other roads at the split are drawn in grey from the junction's OSM detail (the same geometry as the 3D junction view, `forks` in `src/junction/scene.ts`): solid for a road branching off, dashed for a road joining at a merge. Settings → *Close-up at splits* turns it off.
- **Orange through junctions.** The junction view comes up 300 m before each split (`JUNCTION_LEAD` in `src/junction/detect.ts`), and from that point the route line on the map turns orange, its outline and night glow too. For the 100 m either side of the split itself (`JUNCTION_CORE`) it is dark orange, so the junction you are about to take stands out from the road leading to it and from the next one; after that it is the usual purple again. The route in the junction views (3D illustration, zoomed map and its 3D roads) is orange as well, so the map and the view match, and the other roads at the split are grey: only the orange line is your way.
- **While driving.** The banner shows the next turn, exit or split with its distance and, under it, about how long until you reach it (in fives of seconds under a minute), from the route's times and slowed by the traffic ahead like the arrival time. Tap the banner for the remaining steps. The search button finds categories along the route ahead (within 400 m of it, next 60 km) so you can **Add as stop** or **Go here** instead. The ETA line shows the next stop when you have one.

### Places around you

The map's own points of interest come from OpenStreetMap, which in Malaysia lists far fewer businesses than Google Maps. So the app keeps a much fuller set of places for the area around you on the device, and brings it up to date now and then.

- **Where the places come from.** `.github/workflows/places.yml` runs every week (and when its scripts change, or from **Actions → Places → Run workflow**). `scripts/places/build.sh` downloads the latest [Overture Maps](https://overturemaps.org) places release (businesses and points of interest from Meta, Microsoft and other sources, open data under CDLA Permissive 2.0) for Malaysia, Singapore and Brunei with the `overturemaps` tool, and the day's OpenStreetMap extract from Geofabrik. `scripts/places/build-places.mjs` merges them: a place in both (a similar name within 80 m) is kept once, with OpenStreetMap's position and name and the details of both (address, phone, website, opening hours, cuisine, brand); Overture places below 0.6 confidence, closed ones and ones in other countries are left out, as are duplicates. The first build had 699,367 places (OpenStreetMap alone: 165,124), 104 MB in 558 cells of 0.25° (about 28 km), each listed in `manifest.json` with a hash. The Pages workflow publishes the newest build with the site under `places/`.
- **On the device.** The places worker (`src/places/places.worker.ts`) downloads the cells within 50, 100 or 150 km of where you are (100 by default), keeps them in browser storage (IndexedDB) and in memory, and answers the map, search and category questions off the main thread. An update reads the manifest and downloads only the cells that are new or changed, a few at a time, each kept as soon as it arrives; cells now out of reach are dropped. Within 100 km of Kuala Lumpur that is about 250,000 places and 38 MB on the device (Johor Bahru 152,000 and 23 MB, George Town 89,000 and 13 MB, Kota Kinabalu 25,000 and 4 MB), and much less over the network since GitHub Pages compresses it.
- **When it updates** (`src/places/schedule.ts`): on the schedule picked in **Settings → Downloads → Places around you** (every week, 2 weeks, month (default) or 3 months, or only when you tap **Update now**), as soon as you are half the distance away from where the places were fetched (a new city), and when the distance setting changes. It checks at start, every half hour while the app is open and when it comes back to the front, never while navigating, not on mobile data when *Download only on Wi-Fi* is on (the default), not with the phone's data saver on, and waits six hours after a failed try. The section shows how many places are on the device, around which town, when they were updated and how big they are, with **Update now** and **Remove**.
- **On the map** (`src/map/placesLayer.ts`). Each place is an icon in its kind's colour (food orange, cafés brown, groceries and shops blue, petrol teal, health red, worship grey, hotels pink and so on), named from street level. The most useful kinds show first as you zoom in (malls, stations and rest areas from zoom 12 or 13, petrol and attractions from 14, food and groceries from 15, small shops and services at street level), prominent places a little earlier, at most 450 at a time, under the route line. While driving, offices, small shops and services are left off. Where the places cover the map, the base map's own points of interest are hidden (they are the OpenStreetMap subset of the same places). The JunctionNav map style shows the tiles' points of interest with the same icons elsewhere. *Show places on the map* in Settings turns the layer off.
- **A place's card.** Tap an icon: the name with the kind's icon, the kind ("Malaysian restaurant") and the distance, then opening hours, address, phone (tap to call), website and cuisine where known, and where the details come from. While driving it opens over the map with **Add as stop**. Long-pressing right on a place names the dropped pin after it.
- **Search and categories.** Typing in the search box looks through the places around you at the same time as TomTom or Photon (about 20 ms for 250,000 places): strong matches nearby come first, a place both find is listed once with the local details, and with no connection the local results still come. The category buttons add the places around you to TomTom's or Overpass's results.
- **Limits.** Overture's businesses come largely from online listings, so a few may have moved or closed; the confidence threshold keeps most of the doubtful ones out. Outside Malaysia, Singapore and Brunei there is no places data yet (the map keeps its own points of interest there).

### My places: register places, private or public

Places that are missing, misplaced or out of date can be put right in the app itself.

- **Adding one.** Open any place (a search result, a category result, a place on the map) or drop a pin, and tap **Add to my places**. The form takes the name, the kind of place, a note (opening hours, which entrance, what to know), phone and website, where it is (with **Move pin**, the same crosshair as pins, which also sets the **direction of travel** there so a route arrives on the right side of a divided road) and **who can see it**: *Private*, only you, or *Public*, everyone using JunctionNav, with your first name on it. Details the card already had are filled in; a pin's address is not taken as the name. A place made from a pin replaces the pin.
- **Using them.** Your places are on the map with a violet ring, everyone's public places with a teal ring (yours from zoom 8, others' from zoom 11, named from zoom 13). In search they come first, and **a registered place stands in for a place of the same name within 500 m** from TomTom, Photon or the places around you, so the corrected one is the one you find. They also answer the category buttons (petrol, EV, parking, food and cafés, rest areas, convenience stores), name a long-press right on them, and are listed under an empty search box (*Mine*).
- **Your place's card**: its note, whether it is public, **Edit** (and **Delete**, with a second tap), **Share** and **Google Maps**. **Someone else's**: who added it, its note, **Save to my places** (a private copy to change as you like), **Share**, **Report** (wrong location, closed or gone, wrong details, spam or offensive) and **Google Maps**. A place reported by three people is hidden from everyone but its owner, whose card says so.
- **Sharing.** A public place is shared as a link to it (`?sp=<id>`), so the link shows it as it is now. A private place is shared with its details in the link (`?place=lat,lng&name=…&kind=…&hd=…&note=…`), so it can go to a friend without being published; their card says *Shared with you* with **Save to my places**.
- **Where they are kept.** Without Supabase (the site as it is today), your places are private and kept in this browser with your account, like pins. With Supabase and a signed-in account they are also kept in the project, so they are on every device you sign in on, and public ones are shared. Changes are made on the device first and sent when there is a connection, so adding a place with no signal works (Settings → Map → *My places* shows anything not uploaded yet). Public places are fetched for the area on the map, a tile of about 20 km at a time, every ten minutes at most. (`src/community/`, `src/map/communityLayer.ts`, `src/ui/placeForm.ts`.)
- **The rules are in the database** (`supabase/shared-places.sql`, row level security): anyone may read public places that are not hidden; only the signed-in owner can read their private places and add, change or delete their own; the owner, the report count and *hidden* cannot be set by the app; you can report a public place of someone else once; and a trigger hides a place at three reports. Names are 1 to 80 characters, notes up to 500. `tests/sharedPlaces.sql.test.ts` runs the file in PGlite (Postgres in WebAssembly) and checks each rule as a signed-in owner, another person and a visitor.
- **Google Maps on every card.** The **Google Maps** button opens the spot in Google Maps (a plain Maps link, free and without a key), to compare a place with what Google has there.

### Google Maps places in search

With a Google Cloud key (the site's `VITE_GOOGLE_MAPS_KEY`, or your own in **Settings → Map → Google Maps places**), search adds **Search Google Maps for "…"** under the results. It opens Google's own search list for what was typed, near you, and Google's place card for the one you pick (rating, opening hours, photos, as Google draws them, with Google's attribution), with **Directions**, **Open in Google Maps** and **Back to the list**. Directions plans the route to that spot with JunctionNav's own routing, named by JunctionNav's own address search.

This is the one way Google's terms allow its places beside another company's map: the **Places UI Kit**, which the Maps Platform service terms let an app show with any map, a non-Google one included, or with none. The Places API itself (place search and details as data) must not be shown on a non-Google map, so the app does not use it, and nothing from Google is copied into the app, saved, or added to My places: only the spot's position (which the terms let an app keep for up to 30 days) is used for the route. Turn on the *Maps JavaScript API* and the *Places UI Kit* for the key, restrict it to the site (`https://neokrex-source.github.io/*`, plus `https://localhost/*` for the Android app) and to those two APIs. Google requires a billing account; the first 10,000 searches a month are free, and a budget alert keeps it there. (`src/google/placesKit.ts`.)

### Trip links

A URL can plan a trip and start the simulator, so a test drive is one link:

```
http://localhost:5173/?from=road:E2~3&via=Plaza%20Tol%20Sungai%20Besi@auto&via=road:E19|SUKE&to=Suria%20KLCC&sim
```

That one starts on the North–South Expressway (E2) about 3 km before the Sungai Besi toll plaza, goes through the toll, joins SUKE (E19) and ends at KLCC.

| Parameter | Meaning |
| --- | --- |
| `from`, `to` | A place: `lat,lng`, `lat,lng@heading`, free text (searched with the place search), or `here`. `from` defaults to your location. Coordinates can carry a name for the trip editor: `3.0393,101.7056@0 (Plaza Tol Sungai Besi)`. |
| `via` | A stop, repeatable (up to 3 are used). Same formats, plus `road:` points. |
| `road:REF` | A point on a road by ref (`E19`) or name (`SUKE`), with `|` for alternatives. Between two places it is the point with the least detour on the carriageway leading from one to the other; on `from` it is a point on that road about `~km` before the next place (default 3 km). The router is told the direction of travel there, so it snaps to the correct carriageway rather than the opposite one or a road underneath. |
| `name@auto` | Pass this stop in the direction you arrive from (useful for toll plazas). `name@350` gives a heading. |
| `sim` | Start the simulator once the route is ready; `sim=4` for ×4. |
| `avoid` | `tolls`, `highways`, `ferries`, comma separated, for this trip only. |

Road points use Overpass and places use the search service when online. With the offline maps downloaded, both work without internet too (road points come from the offline road graph, places from the offline index). The self-contained preview has only the demo roads and shows a note instead.

### KL test drives

The **KL test drives** button (next to Demo drive) lists short simulated drives through Kuala Lumpur interchanges, each aimed at a set of functions. They take 2 to 4 minutes at the default ×2.

| Drive | Length | What it tests |
| --- | --- | --- |
| Sungai Besi toll onto SUKE | 5.3 km | Toll plaza, lane advice, ramp climbing onto the elevated SUKE (+11 m), 3D map view |
| DASH to Penchala Link and its tunnel | 7 km | Exit number (3110A), drop off the elevated DASH (−9.6 m), climb at the Penchala Link fork (+6.9 m), 3D map view, tunnel sign, guidance without GPS through the 726 m Penchala tunnel |
| MEX down to Jalan Tun Razak | 4.8 km | Exit number (2001), ramp down to street level, 3D map view, tunnel sign, no GPS in the tunnel |
| DUKE into the Wangsa Maju underpass | 4.4 km | Lane advice, exit number (3306A), underpass (−6.4 m), junction leading into a tunnel, 3D map view, tunnel sign, no GPS |
| SMART tunnel | 8.1 km | Lane advice at the tunnel fork, tunnel sign, 4.2 km of guidance without GPS |

Every drive also checks that the route is planned, junction views appear and arrival is announced.

**Checklist.** While a test drive runs, a **Checks 2/9** button sits in the simulator bar. Tap it for the list: each function with what to look for, ticked as the app actually does it, with what it saw (the height of a ramp, the exit number, which lanes, the tunnel's name and length). The button shows each tick for a moment ("✓ Ramp climbs onto a flyover"). When a check depends on a setting that is off (lane alerts, tunnel alerts, or the junction view in 3D only, which hides the map), the list has a button to turn it on. At the end of the drive (or when you end it early) a result lists what passed, what was not seen, and every junction view on the way, with **Drive again**.

Each drive is a trip link (`src/sim/drives.ts`) with named coordinates, so it plans with the normal router or the offline maps. The checks live in `src/sim/testRun.ts` and are fed by the same events the screen shows.

`.github/workflows/drives.yml` replays every drive on the real Peninsular Malaysia pack (after each pack build and whenever the navigation, junction or simulator code changes) the way the simulator drives it: same speeds, GPS cut in tunnels with dead reckoning filling in, the navigation engine's prompts, and the junction views built from the offline road data and terrain. It feeds the same checklist and fails if any of a drive's checks would not tick. The report lists every junction view (what the road does, how high, how steep), each check with where it ticked, other functions the drive happens to show, and a suggested shorter version of the drive. The same run measures the speed data on real roads (`tests/speed.real.test.ts`): 15 trips around KL and along the North–South, LEKAS, Guthrie and Karak expressways, with how much of each has a limit from OpenStreetMap or the national one, and the speed cameras on the route's own carriageway.

### Lane alerts

Before an exit, entrance ramp, junction, divider split or turn that needs a particular lane, the app tells you early which lane to be in, and warns again if your position says you are not there yet.

- **Early advice.** When the lanes matter, a voice prompt like "Exit 114 in 1.2 kilometres. Move to the left lane." comes well ahead of the maneuver. How early depends on your speed and how many lanes you may need to cross: on highways 0.9 to 3 km out, in town 220 to 800 m. Lane data comes from the router (OSM `turn:lanes`); without it the app only advises on fast roads where the side is obvious ("Start moving left").
- **On screen.** The banner's lane row marks the lanes to use and, when known, the lane you are in. A cue strip under it says "Use the left lane · 1.1 km", turns amber with "Move one lane left" when you are outside the right lanes, and green with "You're in a correct lane" once you are.
- **GPS lane check.** The app smooths your sideways position over a few seconds and compares it with the lane layout (3.5 m lanes around the road line). It only calls a lane when GPS accuracy is 6 m or better and the position is clearly inside a lane; it only warns when you are most of a lane outside the advised ones for at least 4 seconds. Then it plays a short chime and says "You're not in a lane for exit 114. Move 2 lanes to the left." At most three warnings per maneuver, spaced out so they do not nag.
- **Too late.** Close to the split (about 6 seconds out on highways) it stops asking you to move and says once: "If you can't change lanes safely, stay in your lane. The route will update." Missing an exit is cheaper than a last-second lane change; the app reroutes.
- **Settings.** Lane alerts: *Early lane advice + GPS lane check* (default), *Early lane advice only*, or *Off*.

Phone GPS is usually accurate to 3 to 5 m in open sky and worse between tall buildings, under flyovers and in tunnels, and OSM road lines are not always on the carriageway centre. So the lane check is deliberately cautious: it stays quiet when unsure instead of guessing, and the early advice works without it. A phone with dual-frequency GPS (L1 + L5) gives noticeably better lane estimates.

### Voice guidance for turns

Every maneuver is announced ahead and again a few seconds before it: on fast roads at 2 km, 1 km and 400 m, in town at 500 m and 180 m, where the stretch before it is long enough for each. A turn on a short block (in town under about 300 m, on fast roads under about 500 m) gets one heads-up with the real distance as you pass the maneuver before it ("In 250 metres, turn right onto Jalan Raja Chulan"), so no turn is first heard at the corner. Slight turns are said as "Bear left" and "Bear right" in English.

Settings → Drive → *Voice* picks a **female or male voice**, and *Which voice* any voice your phone or browser has for the app's language (each marked male or female where its name says so), with **Test voice** to hear it. On Android these are the phone's text-to-speech voices (Google's have a few of each for English and Japanese; more can be added in Android Settings → Text-to-speech output); in a browser, the browser's voices (Chrome and Edge have male voices for English and Malay). When no male voice is known for the language, the usual voice speaks a little lower and Settings says so. `scripts/dev/voice-check.cjs` checks it with a set of browser voices.

The first heads-up of a turn also says which lane to be in. With lane data from the router it is the lane advice below ("Use the right 2 lanes."); without it, for turns, U-turns, the end of the road and slight bends, it is the turn's side: "In 500 metres, turn right onto Jalan Kuching. Move into the right lane." (*Masuk ke lorong kanan.* in Malay, *右車線に寄ってください。* in Japanese). A U-turn takes the lane by the middle of the road, the right one where traffic keeps left. Lane alerts *Off* in Settings leaves this out too.

### Toll plazas: get your Touch 'n Go ready

Before each toll plaza on the route the app reminds you to have the toll card ready.

- **Voice.** At the first quiet moment within about 1 km on expressways (400 m in town): "Plaza Tol Sungai Besi in 900 metres. Get your Touch n Go card ready." Then, about 300 m out (120 m in town): "Toll plaza ahead. Prepare your Touch n Go." The second one is skipped when the first was said less than 15 seconds before. Neither ever talks over a turn prompt. In Malay: "Plaza Tol Sungai Besi dalam 900 meter. Sediakan kad Touch n Go anda." In Japan the reminder asks for the ETC card instead; in Singapore (automatic road pricing) there is none, and elsewhere it asks you to have the toll payment ready (`tollPayment` in `src/nav/tolls.ts`).
- **On screen.** From where the reminder starts until the plaza is passed, a slim amber line over the arrival time shows the plaza, the distance counting down and "Touch 'n Go", and the plaza has an amber booth icon on the map.
- **Data.** Toll gates TomTom reports on its routes, and OSM toll booths (`barrier=toll_booth`, one Overpass query per 20 km of route ahead, within 35 m of the route line), grouped into one plaza per 300 m with the plaza's name from OSM. Offline, the named toll plazas in the offline maps take over. The demo drive has one, Plaza Tol Demo, on the E1 entrance ramp.
- **Settings.** *Toll plazas: Remind me to get Touch 'n Go ready* turns the voice, the line and the map icons off.

### Speed limits and speed cameras

The speed limit shows beside your speed, the app warns as you come up to it and when you pass it, and speed cameras are announced ahead.

- **The limit.** Beside the speed, as a round road sign (in the Fighter jet theme: `LIM 110` and the red band on the speed tape). It comes from, in order: TomTom's own speed limits on its routes; OpenStreetMap's `maxspeed` on the road the route runs along (matched by position and direction, so a crossing road, a frontage road or the other carriageway does not count); and where neither has one, the national limit on expressways, **110 km/h in Malaysia** (100 in Japan). Ramps get no national limit, since they are signed lower.
- **Approaching the limit.** Within 5 km/h of it (3 or 10 in Settings) the speed turns amber, with one soft tone and "Approaching the speed limit of 110". Once per stretch: it comes again only after you have been well below the limit for 20 seconds, or on a new limit.
- **Over the limit.** After a second and a half over it: red and pulsing, three quick beeps and "Slow down. The speed limit is 110", again every 30 seconds while it lasts (four times at most on one limit). A moment over the limit, while overtaking say, does not count.
- **Speed cameras.** 800 m before a camera on fast roads (300 m in town): a falling two-tone and "Speed camera in 800 metres. Speed limit 110", with "Slow down" when you are over it, and once more 300 m out if you still are. The camera shows on the map and in a slim red line over the arrival time with the distance counting down. Only cameras on your own carriageway count: on the road the route runs along and in your direction, or on a pole on your side of the road or in the median (not one across the other carriageway).
- **Average speed checks.** Where the map has one (a stretch between two cameras): "Average speed check for 12 kilometres" as it starts, your average so far on the screen while you are in it, and "End of the average speed check".
- **Data.** Cameras are OpenStreetMap's (`highway=speed_camera`, and `enforcement` relations for fixed cameras and average speed checks), which holds the fixed AWAS cameras people have mapped; police speed traps set up for a day are not in any map. One Overpass query per 20 km of route ahead fetches limits, cameras and the toll booths together (`src/nav/speed.ts`). Without internet both come from the offline maps: the Peninsular Malaysia pack of November 2026 holds 301 speed cameras, 222 of them with their limit. On about 560 km of expressway on test routes around Kuala Lumpur and down to Melaka, over 90% has its limit in OpenStreetMap and the national 110 km/h fills in most of the rest; the same routes pass nine mapped cameras, among them the AWAS ones at Kajang (90 km/h, northbound), on LEKAS, on the Guthrie Corridor and at Alor Gajah in both directions (`tests/speed.real.test.ts`); in town about half of the roads have a mapped limit, and TomTom's routes bring their own. Walking-pace figures mapped on toll booth lanes and gates (under 30 km/h on a main road) are not taken for the road's limit. The limit can be out of date where a sign changed and the map did not: the sign on the road is the one that counts.
- **Settings.** Drive → *Speed limits*: warnings by tone and voice, tone only, the sign only, or off; how far before the limit to warn; and speed cameras on or off. Malay and Japanese prompts follow the app language ("Hampir mencapai had laju 110", 「制限速度は110キロです」), and with miles as the unit everything is in mph.
- **Try it.** The demo drive's road has limits (80, 110, 90), a camera on E35 and an average speed check on E1. Its simulated driver creeps over the limit now and then (the **Speeding** button in the simulator bar turns that on and off in any simulated drive).

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

### TomTom first, OpenStreetMap when TomTom cannot answer

Settings → Traffic → *Map, routing and places* has two choices:

- **TomTom first** (the default). With a TomTom key (see below), these come from TomTom:
  - the **map**: TomTom's own vector map drawn in the JunctionNav look, light purple by day and dark purple by night, with the same road tiers, labels and place icons as the OpenStreetMap version (`src/map/tomtomStyle.ts`). TomTom's routes and traffic then lie on the roads they were planned on. One tile near you is asked for first (TomTom's classic map service, else Orbis, whichever the key is set up for) and must come back in the layout the style draws; the next start opens on the TomTom map straight away (`src/map/tomtomMap.ts`). Tiles are fetched up to zoom 16 and drawn larger beyond, to go easy on the free allowance;
  - **routes** with today's traffic already in the times, up to two alternatives and a toll-free option, avoid tolls, highways and ferries, and **rerouting** and the **alternatives kept ready during the drive**, all with traffic. TomTom's lane guidance, toll, motorway, tunnel and ferry stretches, exits and signposts are mapped onto the app's own route shape (`src/tomtom/routing.ts`), so junction views, lane advice, tunnel signs and the voice work on TomTom routes as on OSRM ones;
  - **place search** (typed search near you, and the address for a point on the map);
  - the **category buttons** (petrol, EV charging, parking, food, rest areas, convenience stores), nearby and along the route, where along-route results are the ones worth at most a five-minute detour.

  When TomTom cannot answer (no key, key refused, the day's free allowance used up, too busy, no answer), OpenStreetMap takes over by itself for that request and TomTom rests for a while: about a minute after an error, twenty minutes after a refused key (traffic requests rest too then). For the map that means the JunctionNav look on OpenFreeMap's tiles, with a short note when it happens during a drive, and TomTom's map again once it answers. The route options say who planned them: "Routes by TomTom, with live traffic in the times", or "TomTom could not plan this (key refused or daily allowance used up), so these routes come from OpenStreetMap". Without internet the offline maps answer, as before. **Test key** in Settings checks the map, routing, search and traffic at once.
- **OpenStreetMap only**: the OpenFreeMap map, OSRM routing, Photon search and Overpass places, as before. Live traffic still uses TomTom when a key is set and *Show live traffic* is on.

The TomTom map is used with the JunctionNav map style (the default); the other styles in Settings (OpenFreeMap, MapTiler, your own) stay as they are. The junction views' road detail, the ground under the 3D junction view and tunnel names always come from OpenStreetMap, since the 3D roads are built from it. TomTom's free tier is 2,500 requests a day (routing, search and traffic together) and 50,000 map tiles; a day of normal driving uses a small part of it. `scripts/dev/tomtom-map-check.cjs` checks the TomTom map in a browser with tiles in TomTom's layout made from saved OpenFreeMap tiles (`scripts/dev/tt-tiles.cjs`): the look by day and night, the classic and Orbis services, the next start, pins, and the fallbacks for a refused key, a key refused while driving, tiles in another layout and *OpenStreetMap only*. TomTom routes already carry traffic, so they need no extra travel-time requests on the route cards or for the prepared alternatives. `scripts/dev/tomtom-check.cjs` checks all of this in a browser with TomTom, OSRM, Photon and Overpass answered by the check itself.

#### Routes on the map's roads

A route planned on one map and drawn on another can run a few metres beside the road (more at interchanges, where a ramp leaves the main road at another place). So a route is moved onto the roads of the map being shown when it was planned on the other one (`src/routing/align.ts`, `src/routing/aligner.ts`): TomTom routes when the map is OpenStreetMap's (TomTom cannot draw it right now, or another map style is chosen), and OSRM or offline routes when the map is TomTom's (TomTom could not plan the route). The roads are read from the same tiles the map draws (`src/map/roadTiles.ts`: OpenFreeMap's at zoom 14, TomTom's at zoom 15), shared with the map through the browser's cache. A route planned on the map's own data is left as it is.

- the route is walked in 4 m steps; each step looks at the roads within 25 m going its way (one-way roads only in their own direction), TomTom's motorway and tunnel stretches preferring motorways and tunnels;
- one road is picked for every step with a hidden Markov model (Viterbi): near roads are likely, keeping the spacing along one road is likely, and changing to a road that does not meet the current one (a road alongside) is not, so the route does not hop between parallel roads;
- the steps are snapped onto their roads and a change of road passes through the point where the two roads meet, so a ramp leaves the main road where the map has it;
- a stretch with no such road nearby (a road too new for the map) stays as TomTom drew it;
- the maneuvers, stops and toll gates move with the line, so guidance, junction views and the car on the line all follow the map's roads.

Routes come back after at most 1.5 s of waiting for road tiles. A long route whose far end was not in by then comes back lined up as far as the tiles go, and the rest follows a few seconds later: swapped in while the routes are on offer, or taken over quietly during the drive (same maneuvers, nothing said again, never in the middle of a junction view). 
`.github/workflows/route-align.yml` measures this on GitHub Actions with ten real routes around KL and from UTP to Ipoh: OSRM routes lie within about half a metre of the map's roads, and the same routes redrawn up to 9 m off (the way another map would have them) come back within 0.3 m of the map's roads (99% of points) and on the same roads as OSRM for 98 to 100% of their length. With a `TOMTOM_KEY` secret it measures TomTom's own routes too. `scripts/dev/align-check.cjs` checks it in the app in a browser with the saved tiles.

### Live traffic and traffic news

Two sources, each used when it is there:

- **Live traffic (TomTom).** Paste a free TomTom API key in Settings (sign up at [developer.tomtom.com](https://developer.tomtom.com/user/register), no card; the key is on your dashboard) and press **Test key**. Then:
  - **Icons.** Jams use a car traffic jam icon (cars queuing), as does the traffic button on the map; accidents, closures and the rest have their own.
  - **On the map**, roads slower than usual are coloured (yellow, red, dark red; free-flowing roads stay clear), and accidents, closures, lane closures, roadworks, floods, weather and broken-down vehicles show as lines with an icon. Tap an icon for what it is, from where to where and the delay. While browsing, the traffic button (above the locate button) lists what is going on in view, nearest first.
  - **On the route cards**, each route's time comes from TomTom with today's traffic, with "+12 min traffic" (or "No traffic delays").
  - **While driving**, the route line is see-through so the congestion colours under it show, stretches of the route that are slow or closed get a coloured edge along it (the route keeps its own colours and orange through junctions), a chip above the arrival time names the next one ("Accident · in 2.1 km · +5 min") and opens into a slim bar within 500 m of it, about 5% of the screen (what it is, the distance counting down, then "600 m left" while you drive through it, and the delay; close it with ×, tap it for the details), and the voice guides you through it (see below).
  - **Arrival time** counts traffic, for the destination and the next stop: the rest of the route is sent to TomTom as points along it, so the time is for your route, not one TomTom would pick, and it counts down as you drive between answers. When that answer is missing or older than 15 minutes (a failed request, the moment after a new route), the delays the incidents ahead report count instead (overlapping ones once). When an incident ahead appears, clears or changes by 2 minutes or more, the travel time is asked again at once. "+X min traffic" shows under it. Tap the arrival time for the traffic list: incidents ahead, news about your roads, other news.
  - **Voice guide for traffic**, one thing at a time and never over a turn prompt:
    - at the start: "Traffic on your route adds about 13 minutes. Arriving at 19:12." (or "No traffic delays on your route");
    - a warning 3 km ahead at speed, 1.5 km in town: "Accident ahead, in 2 kilometres. About 5 minutes' delay." Closures, accidents, floods and hazards always; slow traffic and roadworks when they cost time;
    - a short reminder at 500 m: "Slow traffic in 400 metres.";
    - "Traffic is clearing." once through a slow stretch;
    - when fresh traffic moves the arrival by 5 minutes or more (at most every 5 minutes): "Traffic update: arriving at 19:22, 10 minutes later.";
    - news naming a road on the route: the headline when it is in the language the app speaks, else "There is traffic news about DUKE on your route.";
    - the faster route offer: "A faster route is available, saving 9 minutes. Switching in 15 seconds unless you stay on this route." and, when it switches by itself, "Switched to the faster route."

    In English, Malay and Japanese. The mute button silences it with the rest of the voice; *Voice guide for traffic* in Settings turns just this off.
  - **Faster route.** The alternatives kept ready for rerouting are timed too. When one saves at least 5 minutes and 10%, a slim bar offers it ("9 min faster via Jalan Ampang") with **Switch** and **Stay**, and the app says so once. The Switch button counts down (its fill running out) and the app takes the faster route by itself when it reaches zero, unless you tap **Stay** to keep your route; tap **Switch** to take it straight away. The countdown waits while a sheet covers the bar. Settings → Traffic → *When a faster route opens up*: switch by itself after 10, 15 (default) or 30 seconds, or only offer it (Switch and ×). It is offered only while you can still take it.
  - **Allowance.** Incidents for the road ahead every 4 minutes (sooner near the end of the stretch it asked about or after a new route), the travel time every 5, the alternatives every 10, nothing when not driving except the map in view. The free tier (2,500 incident requests, 20,000 route requests and 200,000 traffic tiles a month) covers well over an hour of driving every day. A site owner can set the repository variable `VITE_TOMTOM_KEY` to give everyone a key; a key in Settings takes its place.
- **Traffic news (no key).** `.github/workflows/traffic-news.yml` runs `scripts/traffic/news.mjs` every 20 minutes on GitHub: it reads Malaysian news feeds (Google News searches in English and Malay, The Star, Malay Mail, Free Malaysia Today, New Straits Times, Berita Harian, Harian Metro, Bernama), keeps headlines from the last 12 hours about jams, accidents, closures, floods and roadworks on a road (not trafficking, summonses and the like), tags the roads they name (PLUS, NKVE, DUKE, MEX, Federal Highway, Jalan Tun Razak and 35 more, by name, abbreviation or route number, from `src/traffic/roads.ts`) and publishes `news.json` on the `traffic-news` branch. The app reads it every 10 minutes; while driving, news naming a road on your route is flagged in the chip and at the top of the traffic list. Tap a headline to read it. *Traffic news from Malaysian news sites* in Settings turns it off.

The demo and the hosted preview have no traffic. `scripts/dev/traffic-check.cjs` checks it all in a browser with TomTom, the router and the feed answered by the check itself.

### Offline maps (Peninsular Malaysia)

Download the whole of Peninsular Malaysia (with Singapore) once, and the app keeps working with no signal: the map, directions with lane advice and junction views (hills included), place search, the category buttons and tunnel signs.

- **Download.** Settings → Downloads → *Offline maps* → **Download**. It shows the size first (about 290 MB to download, 335 MB on the phone, of which 14 MB are the ground heights), then a progress bar. **Pause** and **Resume** work, also after closing the app: finished parts are kept. Wi‑Fi is best, and the page has to stay open while it downloads.
- **Using it.** *Use them when there is no internet* (default) keeps the online services and switches to the offline maps the moment the connection drops or a server does not answer. *Always use them* saves mobile data. The switch back to the online map waits until the connection has held for 30 seconds and you are not driving, so patchy coverage does not flip the map.
- **Updates.** The maps are rebuilt every month with fresh OpenStreetMap data. *Check for update* shows when newer maps are out; the old ones keep working until the new download finishes.
- **Keeping them.** The app asks the browser to keep the maps even when the phone runs low on space (persistent storage), when the download starts and again each time the app opens. Settings shows the answer: a green dot when they are kept, or **Keep them** to ask again. Chrome, Edge and Safari decide on their own and usually agree once JunctionNav is added to the home screen; Firefox asks you.
- **Deleting them.** Settings → Downloads → *Offline maps* → **Delete offline maps** (below the other options, with the space it frees) removes the maps and any unfinished update after a confirmation. The app goes back to the online map at once.
- **Opening with no internet.** A service worker keeps the app itself on the phone, so it opens without a connection once it has been opened online.
- **What is different offline.** Routes come from the app's own router (A* over a compact road graph with one-way streets, turn restrictions, toll and highway avoidance, exits, `destination` signs and `turn:lanes`). It is simpler than OSRM: no traffic, plainer timing at junctions, and long trips stick to main roads once they are well away from both ends. Buildings around junction views need internet; the hills come from the pack's ground heights, and the map under the 3D view from the offline tiles. Browsers: Chrome, Edge or Samsung Internet on Android, Chrome or Edge on a computer (iPhone Safari cannot write the files yet).

**How it is built and hosted.** `.github/workflows/offline-pack.yml` runs `scripts/offline/build-pack.sh` on GitHub's servers: OSM data from Geofabrik clipped to `scripts/offline/peninsular-my.geojson` with osmium; `build-graph.mjs` turns the roads into `graph.bin` (vertices, segments, shapes, way classes and speeds, flags, restrictions, exit numbers and a spatial grid, all typed arrays); `build-places.mjs` makes `places.bin` from named places, businesses and streets; `pmtiles extract` cuts vector tiles (zoom 15, or 14 if they would not fit) from the latest Protomaps build; `build-terrain.mjs` stores ground heights for the 3D views in `terrain.bin` (Terrarium tiles at zoom 12, about 38 m apart, or zoom 11 if they would pass 40 MB; whole metres, predicted from their neighbours and zlib compressed tile by tile, so the app reads only the one to four tiles a junction needs; if the tiles cannot be fetched the pack goes out without heights); `finish-pack.mjs` adds fonts and map symbols, compresses, splits everything into 45 MB parts and writes `manifest.json`. The pack goes into the Actions cache and the Pages workflow publishes the newest one with the site under `offline/` (GitHub Pages allows 1 GB per site). The pack workflow runs separately, so app updates deploy in a couple of minutes and never cancel it; it rebuilds on the 2nd of each month, when the builder scripts change, or from **Actions → Offline maps → Run workflow**, and starts a fresh Pages deploy when a new pack is ready. A build takes 10 to 20 minutes; until the first one finishes, Settings says the maps are being prepared and checks again on its own. If a build fails, the site keeps the previous pack. Set the repository variable `OFFLINE_MAPS` to `off` to skip it.

In the browser the pack lives in the origin private file system: compressed files are unpacked while they download, tiles stay in their parts and are joined as one Blob that MapLibre reads through the PMTiles protocol, and a web worker loads the road graph and place index to answer routing, search, junction and tunnel queries.

### Route options and the routing server

Avoid options use OSRM's `exclude` parameter. Public servers may not support it, or only support one exclusion at a time. The app detects this, applies what the server accepts, shows a note ("This routing server can't avoid toll roads…"), and lists routes that honour your choice first. Your own OSRM built with `server/osrm/setup.sh` supports tolls, highways and ferries in any combination (the script patches the car profile before processing).

## How the junction view works

1. **Route.** OSRM (`steps=true`) returns each maneuver's type (`off ramp`, `on ramp`, `fork`, `merge`…), the lanes at the maneuver with the valid ones flagged, destination and exit-number text, and the bearings of every road at the intersection.
2. **Detection** (`src/junction/detect.ts`). Ramps, exits, forks and merges always get a view. Turns and "continue" maneuvers get one when another enterable road leaves within 50° of yours, which catches divider splits and flyover/underpass forks. The view appears 1 km out on highways and about 380 m out in town.
3. **Detail** (`src/junction/osmdata.ts`). One Overpass query per batch of up to 6 junctions fetches the roads within 450 m, and main roads (tertiary and up, with their ramps) and every bridge and tunnel within 900 m, so the flyovers around a junction are known and their heights come out right: `lanes`, `turn:lanes`, `destination`, `destination:ref`, `layer`, `bridge`, `tunnel`, `maxheight`, and `motorway_junction` exit numbers and names. Results are cached and prefetched about 12 km ahead.
4. **Scene** (`src/junction/scene.ts`). Builds a small road graph around the decision node, walks each branch, lines the branch lane groups up with the router's lane data (so the exit lane really peels off the correct side), works out the height of every road (below), and writes a sign spec for each branch. Without OSM detail it falls back to a schematic built from the router's bearings and lanes, so a view is always available.
   - *The route on the junction's own roads* (`src/junction/snap.ts`). A TomTom route is drawn on TomTom's map, not OpenStreetMap's: its line can run a few metres to the side and its maneuver can sit 20 to 40 m before or after the split as OSM has it. So the kilometre of route around each junction is first laid on the fetched OSM roads (the same matching as *Routes on the map's roads*), and the view is built on that line.
   - *The real split.* On that line the scene looks for the node where the route and the other road part (within 110 m on highways, 70 m in town; for exits and entrances, the node where a ramp leaves), and checks it: 30 m on, the route must be on the side the maneuver says against the other road, or the node is passed over. The view, the orange stretch on the map and the 20 m close-up are then centred on that node, not on the router's point.
   - *Side check.* When the router's lanes would put the taken lanes on the side opposite both the maneuver ("keep left") and the roads themselves, the lanes are laid out from the roads instead; the sketch without OSM detail puts the route on the maneuver's side.
   - `tests/junctionSides.real.test.ts` (in the KL test drives) builds every junction view of 15 Klang Valley trips from OSRM routes and from TomTom-like routes (line moved 8 m to the side, no lanes, maneuver 25 m early or late) and fails on any view with the route on the wrong side.
5. **Heights** (`src/junction/vertical.ts`, `terrain.ts`). Every road's height is the ground under it plus the structure it is on.
   - *Structures.* Where two roads cross on different OSM levels, the upper deck clears the lower road by its signed headroom (`maxheight` plus 1.3 m of deck) or a standard 6.8 m (5.4 m headroom, 1.4 m deck); stacked levels add 6.8 m each. Underpasses and cut-and-cover tunnels sit the same way below the road above. Long bridges and viaducts stay up between crossings, short bridges over a drain get a small hump, and every structure meets the ground at its ends.
   - *Grades.* Roads climb and descend at realistic grades: 4.5 % on expressways, 5 % on main roads, 6.5 % on ramps, 7 % on minor roads. The ramp starts climbing where the geometry allows, not where the OSM bridge tag starts.
   - *Who climbs.* Roads are settled in order (expressways, main roads, minor roads, ramps), and each starts from the points already fixed, so an expressway keeps its level where a ramp joins it and the ramp does the climbing.
   - *Terrain.* Ground heights come from public terrain tiles (AWS Terrain Tiles, Terrarium encoding; set `VITE_TERRAIN_URL` for another source). The data is a surface model, so trees, buildings and decks narrower than about 90 m are filtered out, and road bases are smoothed along the network the way roads are graded. Bridges span valleys and tunnels run at their portals' level instead of following the ground. Without internet the heights come from the offline pack (`terrain.bin`, `src/offline/offlineTerrain.ts`), sampled and cleaned the same way; without either, the ground is flat and structure heights still work.
   - *What you see.* The 3D view puts roads, embankments, pillars, tunnel portals, land use, buildings and trees on that ground, and the camera rides the approach road's real height. A height pill in the junction chip (in 3D and map mode) shows the route's profile through the junction, the other road dashed, the car's position, and the climb or drop with the steepest grade: "Up onto the flyover · +6.8 m · 5%", "Down into the tunnel · −6.7 m · 7%", "Down to street level" when leaving an elevated road, "Up to street level" when coming out of an underpass.
6. **Render** (`src/junction/render3d.ts`). A three.js camera sits on the approach and glides toward the split as you get closer. It draws asphalt, lane markings, guardrails, embankment walls and viaducts with pillars, trenches and tunnel portals, the opposite carriageway, trees, an overhead gantry, and a large arrow along your lane group.
7. **Signs** (`src/junction/signs.ts`). Canvas-drawn signboards with route shields and exit tabs, themed for Malaysia, Japan, the US, continental Europe, the UK, or generic. The theme is picked from the route location unless you choose one.
8. **Surroundings** (`src/junction/surroundings.ts`, `surroundRender.ts`). For the next few junctions the app also fetches what is around them from OSM: buildings (extruded using `height` or `building:levels`), land use and water, rivers and railways, oil palm estates (drawn as palm rows), forests and parks (trees), and labels for nearby roads, petrol stations, rest areas, landmarks and town names. Turn it off in Settings to save data; the view then shows roads only.

   **Map on the ground** (`src/junction/groundMap.ts`). The 3D view lies on the map itself: a hidden MapLibre map takes a top-down snapshot of the 1.8 km around each upcoming junction with the app's current map style (online or offline, day or night), and the view drapes it over the ground and the terrain. So the streets, parks, rivers, lakes and building footprints around the junction are where the map has them, and every flyover, bridge, ramp and tunnel within 900 m stands up in 3D at its real height around the route, the way the driver sees it. The snapshot leaves out labels and the map's own bridges and tunnels (the 3D roads draw those at height; painted flat under their deck they would look like a second road), and the roads the view draws are painted out of it too, so a map road a few metres off never peeks out beside a 3D one. Trees grow only where the map is green. Settings → *Lay the map under the 3D view* turns it off.
9. **Modes.** "3D" illustration, "Map" (a tilted MapLibre close-up of the real junction), or "Both" side by side. Tap the mode button on the view to switch. In Map mode the junction stands up in 3D on the real map (`src/junction/zoom3d.ts`, a three.js custom layer in MapLibre's own GL context): elevated expressways and flyovers on pillars or walled embankments with their shadow on the map, ramps sloping up and down, underpasses in trenches, and the route as a ribbon that rides up and down with the road, with the car on top at its real height. Heights are drawn 1.8× so a 7 m deck reads on a phone, and the camera looks at the climb or drop from slightly to the side.
10. **Size.** The button with the ratio on the view (and Settings → View size) picks how much room it takes: **1:3**, the view and the main map sharing the space under the banner 1 to 3 (docked beside the map, a third of its height); **2:3**, two to three; or **Full**, the view filling the screen down to the ETA card while it is up (docked beside the map, the whole width and height under the banner). Signs, chips and buttons shrink for short views so the split stays visible.
11. **On the map.** A radar pulse spreads from the car icon on the ground, and while navigating short bright impulses run along the route ahead of the car towards the destination, spaced and sized to the map scale (none with reduced motion turned on).

## Data sources and limits

| Purpose | Default | Notes |
| --- | --- | --- |
| Base map | JunctionNav day and night map on TomTom's vector map (with a key, *TomTom first*), else on OpenFreeMap vector tiles | TomTom: 50,000 free tiles a day. OpenFreeMap: no key. OpenFreeMap's own styles (Liberty, Bright, Positron, Dark), MapTiler (key) and any MapLibre style URL can be picked in Settings. |
| Routing | TomTom (with a key, *TomTom first*), else `routing.openstreetmap.de` (FOSSGIS OSRM) | TomTom: traffic in the times, alternatives, lanes. OSRM: public demo server for light use; self-host for real driving (below). |
| Junction detail | `overpass-api.de`, `overpass.kumi.systems` | Shared public servers with rate limits. Fine for testing and personal use. |
| Search | TomTom (with a key, *TomTom first*), else `photon.komoot.io` | Photon is OSM-based and allows search-as-you-type, fair use only. The category buttons use TomTom, else Overpass. |
| Places around you | Overture Maps places merged with OpenStreetMap, built weekly by a GitHub job | 699k places for Malaysia, Singapore and Brunei, published with the site; the app keeps the area within 100 km. |
| Speed limits and cameras | TomTom's limits on its routes; OpenStreetMap `maxspeed`, speed cameras and enforcement relations by Overpass; the offline maps | Checked against the national 110 km/h on Malaysian expressways. Fixed cameras only, as far as they are mapped. |
| Terrain | AWS Terrain Tiles (Terrarium) | One or two small images per junction, for hills and valleys in junction views. |
| Offline maps | Geofabrik OSM extract, Protomaps tiles | Built monthly on GitHub Actions, served from your GitHub Pages site (soft limit 100 GB of traffic a month, so roughly 350 full downloads). |
| Live traffic | TomTom Traffic and Routing APIs | Optional, with a free key per user (or one for the site). Congestion tiles, incidents, travel times with traffic. |
| Traffic news | Malaysian news feeds, collected by a GitHub job | No key. Headlines only, linked to the outlet. |

Map data © OpenStreetMap contributors, traffic © TomTom. Attribution is shown on the map.

### Why not Google Maps?

Google's Maps Platform service terms say content from the Directions, Routes and Places APIs must not be used with a non-Google map (the Places UI Kit is the exception, see *Google Maps places in search*), and the web routing APIs return maneuver types but not per-lane guidance or signboard text, which this view depends on. Google's turn-by-turn product (Navigation SDK) is for native Android and iOS apps. Showing a Google base map under an OSRM route would be possible, but the OSM stack gives you everything the junction view needs.

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
| `VITE_TERRAIN_URL` | AWS Terrain Tiles, `…/terrarium/{z}/{x}/{y}.png` (any Terrarium-encoded source works) |
| `VITE_TOMTOM_KEY` | empty (each user pastes their own key in Settings) |
| `VITE_TRAFFIC_NEWS_URL` | set by the Pages and Android builds to the `traffic-news` branch's `news.json` |
| `VITE_PLACES_URL` | the site's `places/` folder (from `VITE_WEB_APP_URL`); set it to use places data published elsewhere |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | empty (accounts and your places in each browser); with them, accounts on every device, Google and Apple sign-in, shared places |
| `VITE_AUTH_REQUIRED` | `true`; `false` adds "Continue without an account" |
| `VITE_GOOGLE_MAPS_KEY` | empty (each user can paste their own key in Settings); turns on *Search Google Maps* |

Users can also change map style, sign style, language (English, Bahasa Melayu, Japanese), units, voice, junction-view mode and server URLs in **Settings**, which is in five tabs: *Map* (map style, theme, appearance, signboards), *Drive* (voice, lane alerts, speed limits, close-up at splits, junction view, surroundings, tunnels, tolls), *Traffic* (TomTom key, routing and place search, live traffic, traffic voice and news), *Downloads* (places around you, offline maps) and *App* (account, language, units, app version, servers). Save and Cancel stay at the bottom whichever tab is open, the arrow keys move between tabs, and Settings opens on the tab used last.

## Project layout

```
src/
  main.ts                 app controller (plan → preview → navigate, rerouting, prompts)
  geo/geo.ts              distances, bearings, polylines, local metric frames
  routing/                OSRM adapter (avoid options, stops, toll distance), instruction text (en/ms/ja)
  search/                 place search (Photon), coordinates, plus codes, Google Maps links and rough addresses
                          (smartSearch.ts), category search nearby / along route (Overpass)
  tomtom/                 TomTom first: routing adapter, place and category search, fallback to the OSM services
  routing/align.ts        moves a route onto the map's roads (HMM map matching on the map's own road lines)
  places/                 places around you: data format and categories, worker (storage, updates, index),
                          update schedule, search and category merging
  traffic/                live traffic (TomTom incidents, travel times, congestion tiles), traffic news feed,
                          matching incidents and news to the route, Malaysian road names, texts (en/ms/ja)
  community/              My places: registered places (types and words), the shared places service (Supabase REST),
                          the local-first store with sync, public places by area, search and category merging, links
  google/placesKit.ts     Google Maps places in search (Places UI Kit) and Google Maps links
  auth/                   accounts: in this browser, or Supabase (email, Google, Apple)
  state/                  settings and saved places
  nav/engine.ts           snapping, current maneuver, off-route, voice prompt timing
  nav/lanes.ts            lane advisor: target lanes, advice distance, GPS lane estimate
  nav/tunnels.ts          tunnel stretches (router classes + OSM ways), loading ahead, state
  nav/tolls.ts            toll plazas (TomTom toll gates + OSM toll booths), loading ahead, how the toll is paid
  nav/speed.ts            speed limits (TomTom, OSM maxspeed, national) and speed cameras on the route, loading ahead
  nav/speedWatch.ts       the speed against the limit: near, over, cameras and average speed checks, and their warnings
  nav/sources.ts          GPS, simulator, speech, screen wake lock
  offline/                offline maps: pack storage and download, road graph, router, place index,
                          worker, offline map style, online/offline provider switch
  map/                    MapLibre main map, style registry, offline demo style, the map's road lines (roadTiles.ts),
                          the TomTom map in the JunctionNav look and when to use it (tomtomStyle.ts, tomtomMap.ts)
  junction/detect.ts      which maneuvers get a junction view
  junction/osmdata.ts     Overpass fetch, batching and cache
  junction/scene.ts       junction geometry, lane alignment, height profile, sign specs
  junction/vertical.ts    road heights: crossings, headroom, grades, priorities, terrain base
  junction/terrain.ts     terrain tiles: fetch, decode, clean (opening + blur), cache
  junction/render3d.ts    three.js junction renderer
  junction/signs.ts       signboard drawing (direction and tunnel signs) and country themes
  junction/zoomMap.ts     tilted map close-up
  junction/zoom3d.ts      3D decks, ramps, underpasses and route ribbon on the map close-up
  junction/groundMap.ts   map snapshot laid on the ground of the 3D view
  ui/                     banner, junction panel and preview, tunnel card, speed instrument (speedMeter.ts),
                          steps list, icons, settings
  theme/                  the three themes' map and route colours (palette.ts), junction view tints (tint.ts)
  styles/                 app.css (layout and the JunctionNav theme), themes.css (Fighter jet, Casual, speed), fonts
  demo/                   synthetic OSM + OSRM data and offline providers for the demo and tests
  lab/lab.ts              Junction View Lab page
scripts/offline/          offline pack builder (run by the Pages workflow)
scripts/traffic/          traffic news collector (run every 20 minutes by the Traffic news workflow)
scripts/places/           places data builder: Overture Maps + OpenStreetMap into cells (run weekly by the Places workflow)
scripts/android/          emulator check for the Android app (run by the Android workflow)
scripts/brand/            the logo: mark.mjs draws it, icons.cjs makes every icon and launch screen from it
scripts/dev/              browser checks (TomTom, traffic, places, pins, voice, route alignment, speed and themes,
                          My places with Google and Apple sign-in against a fake Supabase and Google)
supabase/shared-places.sql  the shared places table and its rules (run once in the Supabase project)
android/                  the Android app's native project (Capacitor; web assets are synced in at build)
src/platform.ts           browser or Android app, and the addresses that differ between them
scripts/sw-plugin.ts      writes the service worker that keeps the app shell for offline use
server/osrm/              Docker setup for your own OSRM
tests/                    vitest suites
```

## Customising signboards

`SIGN_THEMES` in `src/junction/signs.ts` holds, per country: sign colours for expressways and ordinary roads, the exit-tab label, the lane edge-line colour, and shield rules (a regex on the route ref mapped to a shape and colours). `guessTheme()` picks a theme from rough country bounding boxes. The themes are close approximations of local practice; adjust them to match the signs you drive past.

## Tests

```bash
npm test          # geometry, OSRM parsing, route options, stops, instructions, nav engine, lane alerts, tunnels, toll plazas, speed limits and
                  # cameras, the three themes, places, scene builder, offline pack (builds a pack from the demo network with the real
                  # scripts, then routes, searches, reads junctions, speed limits and cameras), My places (store and sync, search merging,
                  # links, Google and Apple sign-in) and the shared places SQL rules (in PGlite)
npm run typecheck
```

## Known limits and next steps

- **Traffic news is headlines only.** It is as good as the outlets' reporting and an hour or so behind live data; roads are matched by name, so a story naming a road but about the other direction is still flagged. Live traffic needs a TomTom key.
- **No toll fees.** Routes show kilometres on toll roads, not ringgit or yen; open fee tables (PLUS, NEXCO) would be needed for that.
- **Stops and alternatives.** OSRM only returns alternative routes for trips without stops.
- **Data quality follows OSM tagging.** Where `lanes`, `turn:lanes` or `destination` tags are missing, the view falls back to typical lane counts and signs that show road names or refs.
- **Public servers are not for production.** Long routes trigger several Overpass queries; the app batches, caches and backs off, but self-hosting is the reliable path.
- **Phone GPS cannot tell levels apart and only roughly tells lanes apart.** Off-route detection on a flyover vs. the road below only triggers once the roads separate horizontally; the lane check stays quiet when GPS is not clearly good enough (see Lane alerts).
- Speed cameras are the fixed ones mapped in OpenStreetMap; mobile speed traps and time-of-day limits (school zones) are not known to the app.
- Not yet: roundabout junction views, OSM `destination_sign` relations for real gantry layouts, and lazy-loading three.js to shrink the first load (about 300 KB gzipped for the app plus 150 KB for the 3D view).
- iOS Safari needs a tap before speech works (handled by the Start button) and pauses GPS when the screen locks.

Keep your eyes on the road: set the destination before driving, mount the phone, and follow actual road signs where they differ from the app.
