/** JunctionNav app controller: search → place → directions → navigate. */
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/app.css';
import { DemoJunctionProvider, DemoPlaceSearch, DemoPoiProvider, DemoRouter, DemoSurroundProvider, demoTerrain, DemoTunnelProvider } from './demo/providers';
import { buildDemo } from './demo/network';
import { haversine, type LngLat } from './geo/geo';
import { detectJunctions, type JunctionCandidate } from './junction/detect';
import { JunctionDataCache, OverpassProvider, type OsmData } from './junction/osmdata';
import { buildScene, type JunctionScene } from './junction/scene';
import { OverpassSurroundProvider, SurroundCache, type SurroundData } from './junction/surroundings';
import { guessTheme, SIGN_THEMES, type SignTheme } from './junction/signs';
import { ZoomMap } from './junction/zoomMap';
import { TerrainCache, TerrariumProvider, type TerrainPatch } from './junction/terrain';
import { MapView, routeBounds } from './map/mapView';
import { demoStyle, fallbackStyle, resolveStyle } from './map/styles';
import type { StyleSpecification } from 'maplibre-gl';
import { OfflineClient } from './offline/client';
import { enableOfflineMap, offlineStyle } from './offline/offlineMap';
import { HybridJunctionData, HybridPois, HybridRouter, HybridSearch, HybridTunnels, isNetworkError, type OfflineSwitch } from './offline/providers';
import { OfflineStore } from './offline/store';
import { NavEngine, type Fix, type Progress, type Prompt } from './nav/engine';
import { isMajor, OverpassTunnelProvider, TunnelLoader, type TunnelSpan } from './nav/tunnels';
import { currentPosition, GpsSource, ScreenWake, Simulator, Voice, type LocationSource } from './nav/sources';
import { arrivalSpeech, describeStep, formatDistance, formatDuration, lanePhrase, LANGS, spokenInstruction, t, tunnelSpeech, type UiKey } from './routing/instructions';
import { OsrmRouter } from './routing/osrm';
import type { Avoid, Route, Router } from './routing/types';
import { CATEGORIES, CategorySearch, OverpassPoiProvider, type Category, type CategoryPlace } from './search/categories';
import { attachSearch, PhotonSearch, type Place, type PlaceSearchEngine } from './search/places';
import { PlaceStore } from './state/places';
import { ARTIFACT, isNight, lastPosition, loadSettings, overpassList, rememberPosition, saveSettings, type Settings } from './state/settings';
import { Banner } from './ui/banner';
import { h, toast } from './ui/dom';
import { JunctionPanel } from './ui/junctionPanel';
import { JvPreview } from './ui/jvPreview';
import { openSettings } from './ui/settingsDialog';
import { stepsList } from './ui/stepsList';
import { TunnelCard } from './ui/tunnelCard';
import { AUTH_REQUIRED, createAuthProvider, type AuthProvider, type User } from './auth';
import { AuthScreen } from './ui/authScreen';
import { hideSplash, SPLASH_MIN_MS } from './ui/splash';
import { openDrives } from './ui/drivesDialog';
import { driveQuery, KL_DRIVES, type TestDrive } from './sim/drives';
import { TestRun, type CheckId } from './sim/testRun';
import { showTestResult, TestCard, type CheckFix } from './ui/testCard';
import { buildRoadQuery, parseTripLink, resolveTrip, runOverpass, type ResolvedPoint, type TripLinkSpec } from './trip/tripLink';

const KL: LngLat = [101.6869, 3.139];
const MAX_STOPS = 3;
type View = 'browse' | 'results' | 'place' | 'directions' | 'nav';
type NavOverlay = null | 'steps' | 'search' | 'place';

const svg = (body: string) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICON = {
  menu: svg(`<path ${S} d="M4 7h16M4 12h16M4 17h16"/>`),
  search: svg(`<circle ${S} cx="11" cy="11" r="6.5"/><path ${S} d="m16 16 4.5 4.5"/>`),
  back: svg(`<path ${S} d="M15 5l-7 7 7 7"/>`),
  close: svg(`<path ${S} stroke-width="2.4" d="M6 6l12 12M18 6L6 18"/>`),
  swap: svg(`<path ${S} d="M7 4v15M7 4L3.5 7.5M7 4l3.5 3.5M17 20V5M17 20l-3.5-3.5M17 20l3.5-3.5"/>`),
  plus: svg(`<path ${S} d="M12 5v14M5 12h14"/>`),
  star: svg(`<path ${S} d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>`),
  starFill: svg(`<path fill="currentColor" d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>`),
  home: svg(`<path ${S} d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>`),
  work: svg(`<rect ${S} x="3" y="7" width="18" height="13" rx="2"/><path ${S} d="M9 7V5h6v2M3 13h18"/>`),
  copy: svg(`<rect ${S} x="8" y="8" width="12" height="12" rx="2"/><path ${S} d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>`),
  directions: svg(`<path fill="currentColor" d="M21.4 11.3 12.7 2.6a1 1 0 0 0-1.4 0l-8.7 8.7a1 1 0 0 0 0 1.4l8.7 8.7a1 1 0 0 0 1.4 0l8.7-8.7a1 1 0 0 0 0-1.4zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5z"/>`),
  list: svg(`<path ${S} d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>`),
  locate: svg(`<circle ${S} cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path ${S} d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>`),
  volume: svg(`<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9z"/><path ${S} d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/>`),
  mute: svg(`<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9z"/><path ${S} d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>`),
  overview: svg(`<path ${S} d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/>`),
  dot: '<span class="dot" aria-hidden="true"></span>',
};

interface Trip {
  /** null = my location */
  origin: Place | null;
  stops: (Place | null)[];
  destination: Place | null;
}

class App {
  settings: Settings = loadSettings();
  places = new PlaceStore();
  view: View = 'browse';
  showSteps = false;
  navOverlay: NavOverlay = null;
  demo = false;
  map!: MapView;
  /** Offline maps: the pack in browser storage and the worker that routes and searches in it. */
  offline = new OfflineStore();
  offlineClient = new OfflineClient();
  private offlineSw: OfflineSwitch = {
    available: () => this.offline.ready && this.offlineClient.loaded,
    mode: () => this.settings.offlineUse,
    client: this.offlineClient,
  };
  /** The offline map style can be drawn (pack installed and its tiles opened). */
  private offlineMapReady = false;
  private osrm: Router = new OsrmRouter(this.settings.routerUrl);
  router!: Router;
  jdata!: JunctionDataCache;
  osmReady = new Map<string, OsmData | null>();
  surr!: SurroundCache;
  surroundReady = new Map<string, SurroundData>();
  /** Ground elevation around junctions (online terrain tiles; the demo has its own hills). */
  terrain = new TerrainCache(new TerrariumProvider());
  terrainReady = new Map<string, TerrainPatch | null>();
  search!: PlaceSearchEngine;
  /** Stable engine handed to search boxes; forwards to whichever search is active (real or demo). */
  private searchProxy: PlaceSearchEngine = {
    search: (q, near, lang, signal) => this.search.search(q, near, lang, signal),
    reverse: (p, signal) => this.search.reverse(p, signal),
  };
  private simNoticeShown = false;
  private themeSetByApp = false;
  cats!: CategorySearch;
  engine = new NavEngine();
  auth: AuthProvider = createAuthProvider();
  user: User | null = null;
  private signedIn = false;
  private afterSignIn: (() => void)[] = [];
  private authScreen: AuthScreen | null = null;
  tunnelCard = new TunnelCard();
  tunnels = new TunnelLoader(new OverpassTunnelProvider(() => overpassList(this.settings)), (spans) => this.onTunnels(spans));
  private drTimer = 0;
  voice = new Voice();
  wake = new ScreenWake();
  banner = new Banner();
  panel!: JunctionPanel;
  zoom!: ZoomMap;
  preview: JvPreview | null = null;
  myPos: LngLat | null = null;

  trip: Trip = { origin: null, stops: [], destination: null };
  place: Place | null = null;
  results: CategoryPlace[] = [];
  resultsTitle = '';
  resultsLoading = false;
  routes: Route[] = [];
  selected = 0;
  warnings: string[] = [];
  routesLoading = false;
  routeErr = '';
  private routeAbort: AbortController | null = null;
  private routeTimer = 0;

  source: LocationSource | null = null;
  sim: Simulator | null = null;
  activeJ: string | null = null;
  jvDismissed: string | null = null;
  sceneCache = new Map<string, JunctionScene>();
  lastStepIdx = -1;
  rerouting = false;
  lastReroute = 0;
  lastPrefetch = 0;
  arrivedAnnounced = false;
  private endingNav = false;
  private stillSince = 0;
  stopsPassed = 0;
  /** The KL test drive running now, with its checklist. */
  private testRun: TestRun | null = null;
  private testCard = new TestCard((id) => this.checkFix(id));
  navDest: LngLat | null = null;
  navPlace: CategoryPlace | null = null;

  el = {
    app: h('div', { class: 'app' }),
    map: h('div', { class: 'map', id: 'map' }),
    topbar: h('div', { class: 'topbar' }),
    searchCard: h('div', { class: 'card searchcard' }),
    q: h('input', { id: 'q', type: 'text', autocomplete: 'off', enterkeyhint: 'search', role: 'combobox', 'aria-autocomplete': 'list' }) as HTMLInputElement,
    qClear: h('button', { class: 'mini', type: 'button', hidden: true, html: ICON.close, 'aria-label': 'Clear search' }) as HTMLButtonElement,
    suggest: h('ul', { class: 'suggest', hidden: true, role: 'listbox' }),
    chips: h('div', { class: 'chips', role: 'toolbar' }),
    dir: h('div', { class: 'card dir', hidden: true }),
    sheet: h('section', { class: 'sheet card', hidden: true }),
    guide: h('div', { class: 'guide', hidden: true }),
    reroute: h('div', { class: 'reroute', hidden: true }),
    foot: h('div', { class: 'foot', hidden: true }),
    etaMain: h('div', { class: 'eta-main' }),
    etaSub: h('div', { class: 'eta-sub' }),
    speed: h('div', { class: 'speed card' }),
    mute: h('button', { class: 'icon-btn', type: 'button' }) as HTMLButtonElement,
    recenter: h('button', { class: 'chip-btn recenter', type: 'button', hidden: true }) as HTMLButtonElement,
    sim: h('div', { class: 'sim card', hidden: true }),
    simPlay: h('button', { type: 'button' }, 'Pause') as HTMLButtonElement,
    simSpeed: h('button', { type: 'button' }, '×1') as HTMLButtonElement,
    fabs: h('div', { class: 'fabs' }),
  };

  get L() {
    return this.settings.lang;
  }
  tr(key: UiKey, vars?: Record<string, string>) {
    return t(this.L, key, vars);
  }

  constructor() {
    this.realProviders();
  }

  /**
   * The online services (OSRM, Overpass, Photon), each falling back to the offline maps when
   * there is no connection, or used after them when the settings say "always offline".
   */
  private realProviders() {
    const sw = this.offlineSw;
    const overpass = () => overpassList(this.settings);
    this.osrm = new OsrmRouter(this.settings.routerUrl);
    this.router = new HybridRouter(() => this.osrm, sw);
    this.jdata = new JunctionDataCache(new HybridJunctionData(new OverpassProvider(overpass()), sw));
    this.surr = new SurroundCache(new OverpassSurroundProvider(overpass));
    const tunnels = new OverpassTunnelProvider(overpass);
    this.tunnels.provider = new HybridTunnels(() => tunnels, sw);
    this.cats = new CategorySearch(new HybridPois(new OverpassPoiProvider(overpass), sw));
    const photon = new PhotonSearch(() => this.settings.photonUrl);
    this.search = new HybridSearch(() => photon, sw);
    this.terrain = new TerrainCache(new TerrariumProvider());
    this.terrainReady.clear();
    this.surroundReady.clear();
    this.osmReady.clear();
    this.sceneCache.clear();
  }

  /** Map style for the real (non-demo) map: the offline maps when they should be used, else the chosen style. */
  private baseStyle(settings = this.settings): string | StyleSpecification {
    if (this.offlineMapReady && (settings.offlineUse === 'always' || !navigator.onLine)) return offlineStyle(isNight(settings), settings.lang);
    return resolveStyle(settings, isNight(settings));
  }

  private mapOnOffline = false;
  /** Switches the map between online and offline styles when the connection or the pack changes. */
  private refreshMapSource(force = false) {
    if (ARTIFACT || this.demo || !this.map) return;
    const style = this.baseStyle();
    const offline = typeof style !== 'string' && !!style.sources?.protomaps && JSON.stringify(style.sources.protomaps).includes('pmtiles://');
    if (!force && offline === this.mapOnOffline) return;
    this.mapOnOffline = offline;
    this.map.setStyle(style);
    this.zoom?.setStyle(style);
  }

  /** Opens an installed pack: worker for routing and search, protocols for the map. */
  private async activateOffline() {
    if (ARTIFACT || !this.offline.installed) return;
    try {
      await this.offlineClient.load(this.offline.installed.dir);
      await enableOfflineMap(this.offline);
      this.offlineMapReady = true;
      this.refreshMapSource();
    } catch (err) {
      console.warn('[offline] could not open the offline maps', err);
      this.offlineMapReady = false;
      this.offlineClient.unload();
      toast('The offline maps could not be opened. Delete them in Settings and download again.', 6000);
    }
  }

  private async initOffline() {
    if (ARTIFACT || !this.offline.supported) return;
    let last = this.offline.state.status;
    let had = !!this.offline.installed;
    this.offline.onChange((st) => {
      const has = !!this.offline.installed;
      const version = this.offline.installed?.dir.join('/');
      if (has && (!had || version !== this.offlineDir)) {
        // New or updated pack: switch the worker and the map over to it.
        const justDownloaded = last === 'downloading';
        this.offlineClient.unload();
        this.offlineMapReady = false;
        void this.activateOffline().then(() => {
          if (justDownloaded && this.offlineMapReady) toast(`Offline maps for ${this.offline.installed?.manifest.name ?? 'your area'} are ready.`, 4500);
        });
      } else if (!has && had) {
        this.offlineClient.unload();
        this.offlineMapReady = false;
        this.refreshMapSource();
      }
      if (st.status === 'error' && last === 'downloading') toast(st.message, 5000);
      had = has;
      this.offlineDir = version;
      last = st.status;
    });
    await this.offline.init();
    this.offlineDir = this.offline.installed?.dir.join('/');
    had = !!this.offline.installed;
    if (had) await this.activateOffline();
    // Losing the connection switches to the offline map at once. Coming back waits until the
    // connection has held for a while and no drive is running, so patchy coverage does not flip the map.
    let back = 0;
    window.addEventListener('offline', () => {
      clearTimeout(back);
      this.refreshMapSource();
    });
    window.addEventListener('online', () => {
      clearTimeout(back);
      back = window.setTimeout(() => {
        if (navigator.onLine && this.view !== 'nav') this.refreshMapSource();
      }, 30_000);
    });
  }
  private offlineDir: string | undefined;

  init() {
    const e = this.el;
    document.body.append(e.app);
    e.app.append(e.map);
    this.applyTheme();
    // The hosted preview can only draw the bundled demo roads, so never ask for remote tiles there.
    const startStyle = ARTIFACT ? demoStyle(buildDemo().geojson, isNight(this.settings)) : resolveStyle(this.settings, isNight(this.settings));
    this.map = new MapView(e.map, startStyle, ARTIFACT ? buildDemo().start : lastPosition() ?? KL, ARTIFACT ? 14 : 12);
    // When the usual map cannot load: the offline maps if they are on this device, else a simpler online map.
    const fallback = () => (this.offlineMapReady ? offlineStyle(isNight(this.settings), this.settings.lang) : fallbackStyle(isNight(this.settings)));
    this.map.fallback = fallback;
    this.map.onFallback = () => this.zoom?.setStyle(fallback());
    this.map.onLongPress((p) => this.pickOnMap(p));
    this.map.onUserPan(() => {
      if (this.view === 'nav') e.recenter.hidden = false;
    });
    this.map.onRouteClick((idx) => this.selectRoute(idx));

    this.buildTopbar();
    this.buildNav();
    e.app.append(e.sheet);
    this.applyLang();
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--topbar-h', `${Math.round(e.topbar.getBoundingClientRect().height)}px`);
    }).observe(e.topbar);

    if (ARTIFACT) {
      this.buildNotice();
      this.watchViewerTheme();
      this.startDemo(new URLSearchParams(location.search).has('demo'));
      if (parseTripLink(location.search)) toast('Trip links need the full app with internet access. This preview only has the demo roads.', 6000);
      (window as unknown as { __app: App }).__app = this;
      return;
    }

    currentPosition()
      .then((p) => {
        this.myPos = p;
        rememberPosition(p);
        if (this.view !== 'nav' && !this.demo) {
          this.map.setPuck(p, 0);
          if (this.view === 'browse') this.map.flyTo(p, 14);
        }
      })
      .catch(() => {
        /* no permission yet; GPS starts with navigation */
      });

    void this.initOffline();
    const tripLink = parseTripLink(location.search);
    // Demo drives and trip links start once someone is signed in.
    this.whenSignedIn(() => {
      if (new URLSearchParams(location.search).has('demo')) this.startDemo(true);
      else if (tripLink) void this.openTripLink(tripLink);
    });
    (window as unknown as { __app: App }).__app = this;
  }

  /* ================================================================ top bar */

  private buildTopbar() {
    const e = this.el;
    const menu = h('button', { class: 'mini', type: 'button', html: ICON.menu, 'aria-label': 'Settings' });
    menu.addEventListener('click', () => this.editSettings());
    e.qClear.addEventListener('click', () => {
      e.q.value = '';
      e.qClear.hidden = true;
      this.closePlace();
      e.q.focus();
    });
    e.searchCard.append(h('div', { class: 'searchbar' }, menu, h('span', { class: 'sb-ico', html: ICON.search }), e.q, e.qClear), e.suggest);
    attachSearch(e.q, e.suggest, {
      engine: this.searchProxy,
      near: () => this.near(),
      lang: () => this.L,
      extra: () => this.savedSuggestions(),
      decorate: (p) => this.withDistance(p),
      onInput: (v) => (e.qClear.hidden = !v),
      onPick: (p) => {
        if (!Number.isFinite(p.lngLat[0])) return;
        e.qClear.hidden = false;
        this.openPlace(p);
      },
    });
    e.topbar.append(e.searchCard, e.chips, e.dir);
    e.app.append(e.topbar);

    const locate = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Show my location', html: ICON.locate });
    locate.addEventListener('click', async () => {
      if (ARTIFACT && this.myPos) return this.map.flyTo(this.myPos, 15);
      try {
        const p = await currentPosition();
        this.myPos = p;
        this.map.setPuck(p, 0);
        this.map.flyTo(p, 15);
      } catch (err) {
        toast(`Location unavailable: ${(err as Error).message}`);
      }
    });
    e.fabs.append(locate);
    e.app.append(e.fabs);
  }

  /** One-line note in the hosted preview explaining what is simulated. */
  private buildNotice() {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem('junctionnav.notice') === '1';
    } catch {
      /* storage unavailable */
    }
    if (dismissed) return;
    const close = h('button', { class: 'mini', type: 'button', html: ICON.close, 'aria-label': 'Dismiss' });
    const note = h(
      'div',
      { class: 'card notice', role: 'note' },
      h('p', {}, 'Preview on a demo road network with simulated driving. Search the demo places, open Steps to preview junction views, or press Start.'),
      close,
    );
    close.addEventListener('click', () => {
      note.remove();
      try {
        localStorage.setItem('junctionnav.notice', '1');
      } catch {
        /* storage unavailable */
      }
    });
    this.el.topbar.append(note);
  }

  /** Re-theme the map and views when the viewer switches light/dark. */
  private watchViewerTheme() {
    const refresh = () => {
      if (this.settings.appearance !== 'auto' || !this.demo) return;
      const st = demoStyle(buildDemo().geojson, isNight(this.settings));
      this.map.setStyle(st);
      this.zoom.setStyle(st);
      this.sceneCache.clear();
    };
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refresh);
    new MutationObserver((m) => {
      if (!this.themeMutating && m.some((r) => r.attributeName === 'data-theme')) refresh();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  private themeMutating = false;

  private renderChips(target: HTMLElement, onPick: (c: Category) => void, withDemo: boolean) {
    target.innerHTML = '';
    for (const c of CATEGORIES) {
      const b = h('button', { class: 'cat-chip', type: 'button', html: `${c.icon}<span>${this.tr(c.label)}</span>` });
      b.addEventListener('click', () => onPick(c));
      target.append(b);
    }
    if (withDemo) {
      const d = h('button', { class: 'cat-chip is-demo', type: 'button', id: 'btn-demo' }, this.tr('demo'));
      d.addEventListener('click', () => this.startDemo(false));
      const kl = h('button', { class: 'cat-chip is-demo', type: 'button', id: 'btn-kl' }, this.tr('klDrives'));
      kl.addEventListener('click', () => void this.pickTestDrive());
      target.append(d, kl);
    }
  }

  private near(): LngLat {
    return this.myPos ?? (this.map.map.getCenter().toArray() as LngLat);
  }

  private withDistance(p: Place): Place {
    if (!this.myPos || !Number.isFinite(p.lngLat[0])) return p;
    return { ...p, note: formatDistance(haversine(this.myPos, p.lngLat), this.settings.units) };
  }

  private savedSuggestions(): Place[] {
    const d = this.places.data;
    const out: Place[] = [];
    if (d.home) out.push({ ...d.home, tag: this.tr('home') });
    if (d.work) out.push({ ...d.work, tag: this.tr('work') });
    for (const f of d.favourites.slice(0, 5)) out.push({ ...f, tag: '★' });
    for (const r of d.recents.slice(0, 6)) out.push({ ...r, tag: this.tr('recent') });
    return out.map((p) => this.withDistance(p));
  }

  /* ================================================================ views */

  private setView(v: View) {
    this.view = v;
    const e = this.el;
    const nav = v === 'nav';
    e.topbar.hidden = nav;
    e.searchCard.hidden = v === 'directions';
    e.chips.hidden = v === 'directions' || v === 'place';
    e.dir.hidden = v !== 'directions';
    e.fabs.hidden = nav;
    e.guide.hidden = !nav;
    e.foot.hidden = !nav;
    e.sim.hidden = !(nav && this.sim);
    e.recenter.hidden = true;
    e.app.dataset.view = v;
    if (!nav) {
      this.panel.hide();
      this.navOverlay = null;
    }
    if (v !== 'results' && !(nav && this.navOverlay === 'search')) this.map.setResultMarkers([], () => {});
    this.renderSheet();
  }

  private renderSheet() {
    const s = this.el.sheet;
    s.innerHTML = '';
    s.classList.toggle('is-nav', this.view === 'nav');
    let show = true;
    if (this.view === 'results') this.renderResults(s, this.results, this.resultsTitle, () => this.closePlace(), (p) => this.openPlace(p));
    else if (this.view === 'place' && this.place) this.renderPlace(s, this.place);
    else if (this.view === 'directions') this.showSteps ? this.renderStepsSheet(s) : this.renderRoutes(s);
    else if (this.view === 'nav' && this.navOverlay) this.renderNavOverlay(s);
    else show = false;
    s.hidden = !show;
    s.scrollTop = 0;
  }

  private sheetHead(title: string, onClose: () => void, back = false) {
    const b = h('button', { class: 'mini', type: 'button', html: back ? ICON.back : ICON.close, 'aria-label': back ? this.tr('back') : this.tr('close') });
    b.addEventListener('click', onClose);
    return back ? h('div', { class: 'sheet-head' }, b, h('h2', {}, title)) : h('div', { class: 'sheet-head' }, h('h2', {}, title), b);
  }

  /* ================================================================ search results and places */

  private async runNearby(cat: Category) {
    this.resultsTitle = `${this.tr(cat.label)} · ${this.tr('nearby')}`;
    this.results = [];
    this.resultsLoading = true;
    this.setView('results');
    try {
      this.results = await this.cats.nearby(cat, this.near(), this.L, this.settings.units);
    } catch (err) {
      toast((err as Error).message);
    }
    this.resultsLoading = false;
    if (this.view !== 'results') return;
    this.showResultMarkers(this.results, (p) => this.openPlace(p));
    if (this.results.length) this.map.fitPoints(this.results.map((r) => r.lngLat), this.overviewPadding());
    this.renderSheet();
  }

  private showResultMarkers(list: CategoryPlace[], onPick: (p: CategoryPlace) => void) {
    this.map.setResultMarkers(
      list.map((r, i) => ({ lngLat: r.lngLat, label: String(i + 1), title: r.name })),
      (i) => onPick(list[i]),
    );
  }

  private renderResults(s: HTMLElement, list: CategoryPlace[], title: string, onClose: () => void, onPick: (p: CategoryPlace) => void) {
    s.append(this.sheetHead(title, onClose));
    if (this.resultsLoading) {
      s.append(h('p', { class: 'muted' }, this.tr('searching')));
      return;
    }
    if (!list.length) {
      s.append(h('p', { class: 'muted' }, this.tr('noResults')));
      return;
    }
    const ul = h('ol', { class: 'results' });
    list.forEach((p, i) => {
      const b = h(
        'button',
        { type: 'button' },
        h('span', { class: 'r-num' }, String(i + 1)),
        h('span', { class: 'r-body' }, h('span', { class: 's-name' }, p.name), h('span', { class: 's-sub' }, p.sub)),
        h('span', { class: 's-note' }, p.note ?? ''),
      );
      b.addEventListener('click', () => onPick(p));
      ul.append(h('li', {}, b));
    });
    s.append(ul);
  }

  private openPlace(p: Place) {
    this.place = p;
    this.map.setDestination(p.lngLat);
    this.map.flyTo(p.lngLat, Math.max(15, this.map.map.getZoom()));
    this.setView('place');
  }

  private closePlace() {
    this.place = null;
    this.results = [];
    this.el.q.value = '';
    this.el.qClear.hidden = true;
    this.map.setDestination(null);
    this.setView('browse');
  }

  private renderPlace(s: HTMLElement, p: Place) {
    const fav = this.places.isFavourite(p);
    const dist = this.myPos ? formatDistance(haversine(this.myPos, p.lngLat), this.settings.units) : '';
    s.append(
      this.sheetHead(p.name, () => (this.results.length ? this.setView('results') : this.closePlace())),
      h('p', { class: 'place-sub' }, [p.sub, dist].filter(Boolean).join(' · ')),
    );
    const dirBtn = h('button', { class: 'btn btn-primary', type: 'button', html: `${ICON.directions}<span>${this.tr('directions')}</span>` });
    dirBtn.addEventListener('click', () => this.openDirections(p));
    const go = h('button', { class: 'btn btn-ghost', type: 'button' }, this.tr('start'));
    go.addEventListener('click', () => this.quickStart(p));
    s.append(h('div', { class: 'sheet-row' }, dirBtn, go));
    const small = (icon: string, label: string, fn: () => void, pressed?: boolean) => {
      const b = h('button', { class: 'pill', type: 'button', html: `${icon}<span>${label}</span>`, 'aria-pressed': pressed == null ? null : String(pressed) });
      b.addEventListener('click', fn);
      return b;
    };
    s.append(
      h(
        'div',
        { class: 'pills' },
        small(fav ? ICON.starFill : ICON.star, fav ? this.tr('saved') : this.tr('save'), () => {
          this.places.toggleFavourite(p);
          this.renderSheet();
        }, fav),
        small(ICON.home, this.tr('setHome'), () => {
          this.places.setHome(p);
          toast(`${this.tr('home')}: ${p.name}`);
        }),
        small(ICON.work, this.tr('setWork'), () => {
          this.places.setWork(p);
          toast(`${this.tr('work')}: ${p.name}`);
        }),
        small(ICON.copy, this.tr('copy'), () => {
          const txt = `${p.lngLat[1].toFixed(6)}, ${p.lngLat[0].toFixed(6)}`;
          navigator.clipboard?.writeText(txt).then(
            () => toast(this.tr('copied')),
            () => toast(txt),
          );
        }),
      ),
      h('p', { class: 'coords' }, `${p.lngLat[1].toFixed(5)}, ${p.lngLat[0].toFixed(5)}`),
    );
  }

  private async pickOnMap(p: LngLat) {
    if (this.view === 'nav') return;
    const pin: Place = { name: `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`, sub: this.tr('droppedPin'), lngLat: p };
    if (this.view === 'directions') {
      this.trip.destination = pin;
      this.renderDirEditor();
      this.computeRoutes();
    } else {
      this.openPlace(pin);
    }
    const named = await this.search.reverse(p);
    if (!named) return;
    const better = { ...named, lngLat: p };
    if (this.place?.lngLat === p) {
      this.place = better;
      if (this.view === 'place') this.renderSheet();
    }
    if (this.trip.destination?.lngLat === p) {
      this.trip.destination = better;
      if (this.view === 'directions') this.renderDirEditor();
    }
  }

  /* ================================================================ directions */

  private openDirections(dest: Place | null) {
    if (dest) this.trip.destination = dest;
    this.showSteps = false;
    this.setView('directions');
    this.renderDirEditor();
    this.computeRoutes();
  }

  /* ================================================================ accounts */

  private whenSignedIn(fn: () => void) {
    if (this.signedIn) fn();
    else this.afterSignIn.push(fn);
  }

  /**
   * Start-up: the splash stays up while the saved session is checked (and at least long enough
   * to finish drawing), then either the app or the sign-in screen appears. The map loads behind.
   */
  async boot() {
    const t0 = performance.now();
    let user: User | null = null;
    try {
      user = await this.auth.current();
    } catch {
      user = null;
    }
    const left = SPLASH_MIN_MS - (performance.now() - t0);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    if (user) {
      hideSplash();
      return this.setUser(user, false);
    }
    const screen = (this.authScreen ??= new AuthScreen(this.auth, { allowGuest: !AUTH_REQUIRED }));
    const pending = screen.open();
    hideSplash();
    this.setUser(await pending, true);
  }

  private setUser(user: User | null, fresh: boolean) {
    this.user = user;
    this.places.useScope(user?.id ?? null);
    this.signedIn = true;
    if (fresh && user) toast(`Welcome, ${user.name.split(/\s+/)[0]}`, 2500);
    const todo = this.afterSignIn.splice(0);
    for (const fn of todo) fn();
    if (this.view === 'browse') this.renderSheet();
  }

  private async signOut(removeAccount = false) {
    if (this.view === 'nav') this.endNav();
    try {
      if (removeAccount && this.user && this.auth.deleteAccount) await this.auth.deleteAccount(this.user.email, '');
      else await this.auth.signOut();
    } catch (err) {
      toast((err as Error).message, 5000);
    }
    toast(removeAccount ? 'Account removed' : 'Signed out', 2500);
    this.user = null;
    this.signedIn = false;
    this.places.useScope(null);
    const screen = (this.authScreen ??= new AuthScreen(this.auth, { allowGuest: !AUTH_REQUIRED }));
    this.setUser(await screen.open(), true);
  }

  /** Ready-made KL drives: pick one and it plans the route, starts the simulator and the checklist. */
  private async pickTestDrive() {
    const d = await openDrives(KL_DRIVES, { offlineReady: this.offlineSw.available(), online: navigator.onLine });
    if (d) await this.runTestDrive(d);
  }

  private async runTestDrive(d: TestDrive) {
    const spec = parseTripLink(driveQuery(d));
    if (!spec) return;
    if (this.demo) this.leaveDemo();
    this.stopTest();
    if (this.view === 'nav') this.endNav();
    await this.openTripLink(spec, d);
  }

  /** The checklist starts with the simulator, once the route is planned. */
  private startTest(d: TestDrive) {
    const run = new TestRun(d, (id) => this.testCard.ticked(id));
    this.testRun = run;
    this.testCard.start(run);
    const route = this.engine.route;
    if (route) run.routePlanned(route.provider, route.distance);
  }

  private stopTest() {
    this.testRun = null;
    this.testCard.stop();
  }

  /** Settings a check depends on, with a button to turn them on during the drive. */
  private checkFix(id: CheckId): CheckFix | null {
    const st = this.settings;
    const apply = (change: Partial<Settings>) => {
      this.settings = { ...this.settings, ...change };
      saveSettings(this.settings);
      this.engine.laneMode = this.settings.laneAlerts;
      this.engine.tunnelAlerts = this.settings.tunnelAlerts;
      const cand = this.engine.junctions.find((c) => c.id === this.activeJ);
      if (cand && this.panel.visible) this.showJunction(cand, true);
      this.testCard.refresh();
    };
    if (id === 'map3d' && st.jvMode === 'illustration') return { label: 'Show the map view', run: () => apply({ jvMode: 'both' }) };
    if (id === 'lanes' && st.laneAlerts === 'off') return { label: 'Turn on lane alerts', run: () => apply({ laneAlerts: 'gps' }) };
    if ((id === 'tunnelSign' || id === 'dr') && !st.tunnelAlerts) return { label: 'Turn on tunnel alerts', run: () => apply({ tunnelAlerts: true }) };
    return null;
  }

  /** Plans the trip from a trip link (see src/trip/tripLink.ts) and starts the simulator if asked. */
  private async openTripLink(spec: TripLinkSpec, test?: TestDrive) {
    toast('Planning the trip from the link…', 4000);
    try {
      const pts = await resolveTrip(spec, {
        geocode: async (q, near) => {
          const r = await this.search.search(q, near, this.L);
          return r[0] ? { lngLat: r[0].lngLat, label: r[0].name } : null;
        },
        // Road points: Overpass online, the offline maps without a connection.
        roads: async (names, center, radius) => {
          const offline = () => this.offlineClient.roads(names, center, radius);
          const sw = this.offlineSw;
          if (sw.available() && (sw.mode() === 'always' || !navigator.onLine)) return offline();
          try {
            return await runOverpass(overpassList(this.settings), buildRoadQuery(names, center, radius));
          } catch (e) {
            if (!sw.available()) throw e;
            return offline();
          }
        },
        here: async () => this.myPos ?? (await currentPosition().catch(() => null)),
        near: this.myPos ?? lastPosition() ?? KL,
      });
      const place = (p: ResolvedPoint, sub: string): Place => ({ name: p.label, sub, lngLat: p.lngLat, bearing: p.bearing ?? undefined });
      const stops = pts.slice(1, -1);
      if (stops.length > MAX_STOPS) toast(`Only the first ${MAX_STOPS} stops are used.`, 4000);
      this.trip = {
        origin: spec.from.kind === 'here' ? null : place(pts[0], 'Trip start'),
        stops: stops.slice(0, MAX_STOPS).map((p, i) => place(p, `Stop ${i + 1}`)),
        destination: place(pts[pts.length - 1], 'Destination'),
      };
      if (spec.from.kind === 'here') this.myPos = pts[0].lngLat;
      // Avoid options from the link apply to this trip only.
      if (Object.keys(spec.avoid).length) this.settings = { ...this.settings, avoid: { ...this.settings.avoid, ...spec.avoid } };
      this.openDirections(null);
      if (spec.sim == null) return;
      const started = Date.now();
      const wait = window.setInterval(() => {
        if (this.routesLoading || Date.now() - started < 300) return;
        clearInterval(wait);
        if (!this.routes.length) return;
        this.settings = { ...this.settings, simSpeed: spec.sim! };
        this.startNav(true);
        if (test) this.startTest(test);
      }, 100);
    } catch (err) {
      const msg = isNetworkError(err) && !this.offlineSw.available() ? 'No connection. Download the offline maps in Settings to plan this without internet.' : (err as Error).message;
      toast(`Trip link: ${msg}`, 7000);
    }
  }

  private closeDirections() {
    this.routeAbort?.abort();
    this.routes = [];
    this.map.clearRoutes();
    if (this.demo && !ARTIFACT) return this.leaveDemo();
    if (this.trip.destination) {
      this.place = this.trip.destination;
      this.map.setDestination(this.place.lngLat);
      this.setView('place');
    } else {
      this.closePlace();
    }
  }

  private renderDirEditor() {
    const d = this.el.dir;
    d.innerHTML = '';
    const back = h('button', { class: 'mini', type: 'button', html: ICON.back, 'aria-label': this.tr('back') });
    back.addEventListener('click', () => this.closeDirections());
    const swap = h('button', { class: 'mini', type: 'button', html: ICON.swap, 'aria-label': 'Swap start and destination' });
    swap.addEventListener('click', () => {
      const pts = [this.trip.origin, ...this.trip.stops, this.trip.destination];
      pts.reverse();
      this.trip.origin = pts[0];
      this.trip.destination = pts[pts.length - 1];
      this.trip.stops = pts.slice(1, -1);
      this.renderDirEditor();
      this.computeRoutes();
    });
    const fields = h('div', { class: 'dir-fields' });
    const field = (id: string, value: Place | null, placeholder: string, marker: string, onPick: (p: Place | null) => void, onRemove?: () => void) => {
      const input = h('input', { id, type: 'text', autocomplete: 'off', placeholder, value: value?.name ?? '' }) as HTMLInputElement;
      const list = h('ul', { class: 'suggest', hidden: true });
      const row = h('div', { class: 'dir-field' }, h('span', { class: `dir-mark ${marker}`, 'aria-hidden': 'true' }), input);
      if (onRemove) {
        const rm = h('button', { class: 'mini', type: 'button', html: ICON.close, 'aria-label': 'Remove stop' });
        rm.addEventListener('click', onRemove);
        row.append(rm);
      }
      attachSearch(input, list, {
        engine: this.searchProxy,
        near: () => this.near(),
        lang: () => this.L,
        decorate: (p) => this.withDistance(p),
        extra: () => (id === 'from' ? [{ name: this.tr('myLocation'), sub: 'GPS', lngLat: [NaN, 0] as LngLat }, ...this.savedSuggestions()] : this.savedSuggestions()),
        onPick: (p) => onPick(Number.isFinite(p.lngLat[0]) ? p : null),
      });
      fields.append(row, list);
      return input;
    };
    field('from', this.trip.origin, this.tr('myLocation'), 'is-origin', (p) => {
      this.trip.origin = p;
      if (!p) (document.getElementById('from') as HTMLInputElement).value = '';
      this.computeRoutes();
    });
    this.trip.stops.forEach((st, i) => {
      field(`stop${i}`, st, `${this.tr('stop')} ${i + 1}`, 'is-stop', (p) => {
        this.trip.stops[i] = p;
        this.computeRoutes();
      }, () => {
        this.trip.stops.splice(i, 1);
        this.renderDirEditor();
        this.computeRoutes();
      });
    });
    field('to', this.trip.destination, this.tr('search'), 'is-dest', (p) => {
      this.trip.destination = p;
      this.computeRoutes();
    });
    const add = h('button', { class: 'pill', type: 'button', html: `${ICON.plus}<span>${this.tr('addStop')}</span>` }) as HTMLButtonElement;
    add.disabled = this.trip.stops.length >= MAX_STOPS;
    add.addEventListener('click', () => {
      this.trip.stops.push(null);
      this.renderDirEditor();
      (document.getElementById(`stop${this.trip.stops.length - 1}`) as HTMLInputElement | null)?.focus();
    });
    const avoid = h('div', { class: 'pills', role: 'group', 'aria-label': this.tr('options') });
    const opt = (key: keyof Avoid, label: UiKey) => {
      const b = h('button', { class: 'pill toggle-pill', type: 'button', 'aria-pressed': String(this.settings.avoid[key]) }, this.tr(label));
      b.addEventListener('click', () => {
        this.settings.avoid = { ...this.settings.avoid, [key]: !this.settings.avoid[key] };
        saveSettings(this.settings);
        b.setAttribute('aria-pressed', String(this.settings.avoid[key]));
        this.computeRoutes();
      });
      return b;
    };
    avoid.append(opt('tolls', 'avoidTolls'), opt('motorways', 'avoidHighways'), opt('ferries', 'avoidFerries'));
    d.append(
      h('div', { class: 'dir-top' }, back, h('h2', {}, this.tr('directions')), swap),
      fields,
      h('div', { class: 'dir-bottom' }, add),
      avoid,
    );
  }

  private computeRoutes() {
    clearTimeout(this.routeTimer);
    this.routeTimer = window.setTimeout(() => this.doComputeRoutes(), 120);
  }

  private async doComputeRoutes() {
    if (this.view !== 'directions') return;
    const dest = this.trip.destination;
    this.routeAbort?.abort();
    this.routeErr = '';
    if (!dest) {
      this.routes = [];
      this.map.clearRoutes();
      this.renderSheet();
      return;
    }
    let origin = this.trip.origin?.lngLat ?? this.myPos;
    if (!origin) {
      try {
        origin = await currentPosition();
        this.myPos = origin;
      } catch {
        this.routeErr = 'Waiting for your location. Allow location access or type a start point.';
        this.renderSheet();
        return;
      }
    }
    const ctrl = new AbortController();
    this.routeAbort = ctrl;
    this.routesLoading = true;
    this.renderSheet();
    this.map.setDestination(dest.lngLat);
    try {
      const res = await this.router.route(
        {
          origin,
          destination: dest.lngLat,
          via: this.trip.stops.filter((p): p is Place => !!p).map((p) => p.lngLat),
          viaBearings: this.trip.stops.filter((p): p is Place => !!p).map((p) => p.bearing ?? null),
          bearing: this.trip.origin?.bearing ?? null,
          alternatives: true,
          avoid: this.settings.avoid,
          offerTollFree: !this.settings.avoid.tolls,
        },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      this.routes = res.routes;
      this.warnings = res.warnings;
      this.selected = 0;
      this.map.showRoutes(this.routes, 0);
      this.map.fit(routeBounds(this.routes), this.overviewPadding());
      if (!this.demo) this.places.addRecent(dest);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      this.routes = [];
      this.map.clearRoutes();
      this.routeErr = (err as Error).message;
    } finally {
      if (this.routeAbort === ctrl) this.routesLoading = false;
    }
    this.renderSheet();
  }

  private selectRoute(idx: number) {
    if (this.view !== 'directions' || !this.routes[idx]) return;
    this.selected = idx;
    this.map.showRoutes(this.routes, idx);
    this.renderSheet();
  }

  private routeTollText(r: Route): string {
    if (!r.hasToll) return this.tr('noTolls');
    return r.tollDistance > 100 ? this.tr('tollKm', { d: formatDistance(r.tollDistance, this.settings.units) }) : this.tr('toll');
  }

  private renderRoutes(s: HTMLElement) {
    if (this.routesLoading && !this.routes.length) {
      s.append(h('p', { class: 'muted' }, this.tr('finding')));
      return;
    }
    if (this.routeErr) {
      s.append(h('p', { class: 'warn' }, this.routeErr));
      return;
    }
    if (!this.routes.length) {
      s.hidden = true;
      return;
    }
    for (const w of this.warnings) s.append(h('p', { class: 'warn' }, w));
    const list = h('div', { class: 'routes', role: 'group', 'aria-label': this.tr('routes') });
    const locale = this.L === 'ja' ? 'ja-JP' : this.L === 'ms' ? 'ms-MY' : 'en-GB';
    this.routes.forEach((r, i) => {
      const jCount = detectJunctions(r).length;
      const eta = new Date(Date.now() + r.duration * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      const label = r.label === 'fastest' ? 'fastest' : r.label === 'tollFree' ? 'tollFree' : r.label === 'shortest' ? 'shortest' : 'alternative';
      const b = h(
        'button',
        { class: `route-opt is-${r.label}`, type: 'button', 'aria-pressed': String(i === this.selected) },
        h('span', { class: 'r-label' }, this.tr(label)),
        h('span', { class: 'r-time' }, formatDuration(r.duration)),
        h('span', { class: 'r-eta' }, `${this.tr('arrive')} ${eta}`),
        h('span', { class: 'r-meta' }, `${formatDistance(r.distance, this.settings.units)}${r.summary ? ` · ${this.tr('via')} ${r.summary}` : ''}`),
        h(
          'span',
          { class: 'r-meta' },
          h('span', { class: r.hasToll ? 'r-toll' : 'r-free' }, this.routeTollText(r)),
          ` · ${jCount} ${this.tr('junctionViews')}`,
        ),
      );
      b.addEventListener('click', () => (i === this.selected ? this.toggleSteps(true) : this.selectRoute(i)));
      list.append(b);
    });
    const steps = h('button', { class: 'btn btn-ghost', type: 'button', html: `${ICON.list}<span>${this.tr('steps')}</span>` });
    steps.addEventListener('click', () => this.toggleSteps(true));
    const sim = h('button', { class: 'btn btn-ghost', type: 'button' }, this.tr('simulate'));
    sim.addEventListener('click', () => this.startNav(true));
    const go = h('button', { class: 'btn btn-primary', type: 'button' }, this.tr('start'));
    go.addEventListener('click', () => this.startNav(false));
    s.append(list, h('div', { class: 'sheet-row' }, steps, sim, go));
  }

  private toggleSteps(on: boolean) {
    this.showSteps = on;
    this.renderSheet();
  }

  private junctionMap(route: Route): Map<number, JunctionCandidate> {
    return new Map(detectJunctions(route).map((j) => [j.stepIndex, j]));
  }

  private renderStepsSheet(s: HTMLElement) {
    const r = this.routes[this.selected];
    if (!r) return;
    s.append(this.sheetHead(`${formatDuration(r.duration)} · ${formatDistance(r.distance, this.settings.units)}`, () => this.toggleSteps(false), true));
    s.append(
      stepsList(r, {
        lang: this.L,
        units: this.settings.units,
        junctions: this.junctionMap(r),
        onStep: (st) => this.map.showPoint(st.location, st.bearingBefore),
        onPreview: (cand) => this.openPreview(r, cand),
      }),
    );
  }

  /* ================================================================ junction preview */

  private themeFor(route: Route): SignTheme {
    const id = this.settings.signTheme === 'auto' ? guessTheme(this.demo ? [101.5, 3.1] : route.geometry[0]) : this.settings.signTheme;
    return SIGN_THEMES[id];
  }

  private sceneFor(route: Route, cand: JunctionCandidate): JunctionScene {
    const osm = this.osmReady.get(JunctionDataCache.key(cand.location)) ?? null;
    const surround = this.settings.jvSurround ? this.surroundReady.get(SurroundCache.key(cand.location)) ?? null : null;
    const terrain = this.terrainReady.get(TerrainCache.key(cand.location)) ?? null;
    const key = `${cand.id}|${osm ? 'osm' : 'schematic'}|${surround ? 'surr' : ''}|${terrain ? 'dem' : ''}|${this.L}`;
    let sc = this.sceneCache.get(key);
    if (!sc) {
      try {
        sc = buildScene(route, cand, osm, { lang: this.L, surround, terrain });
      } catch (err) {
        console.warn('[junction] OSM scene failed, using schematic', err);
        sc = buildScene(route, cand, null, { lang: this.L, terrain });
      }
      this.sceneCache.set(key, sc);
    }
    return sc;
  }

  /** Get OSM detail for a junction, then call back (used to upgrade a schematic view). */
  private loadDetail(cand: JunctionCandidate, then: () => void) {
    const k = JunctionDataCache.key(cand.location);
    if (this.osmReady.has(k)) return;
    this.jdata.prefetch([cand.location]);
    this.jdata.peek(cand.location)?.then((d) => {
      if (!d) return;
      this.osmReady.set(k, d);
      then();
    });
  }

  /** Get the ground elevation around a junction, then call back to redraw with hills and valleys. */
  private loadTerrain(cand: JunctionCandidate, then: () => void) {
    const k = TerrainCache.key(cand.location);
    if (this.terrainReady.has(k)) return;
    const cache = this.terrain;
    cache.get(cand.location).then((t) => {
      if (cache !== this.terrain || this.terrainReady.has(k)) return;
      this.terrainReady.set(k, t);
      if (t) then();
    });
  }

  /** Get buildings, land use and places around a junction, then call back to redraw. */
  private loadSurround(cand: JunctionCandidate, then: () => void) {
    if (!this.settings.jvSurround) return;
    const k = SurroundCache.key(cand.location);
    if (this.surroundReady.has(k)) return;
    this.surr.get(cand.location).then((d) => {
      if (!d || this.surroundReady.has(k)) return;
      this.surroundReady.set(k, d);
      then();
    });
  }

  private openPreview(route: Route, cand: JunctionCandidate) {
    this.preview ??= new JvPreview();
    const step = route.steps[cand.stepIndex];
    const d = describeStep(step, this.L);
    const o = { night: isNight(this.settings), lang: this.L, units: this.settings.units };
    this.preview.open(this.sceneFor(route, cand), this.themeFor(route), { ...o, title: d.action, sub: d.primary !== d.action ? d.primary : '' });
    const refresh = () => this.preview?.update(this.sceneFor(route, cand), this.themeFor(route), o);
    this.loadDetail(cand, refresh);
    this.loadSurround(cand, refresh);
    this.loadTerrain(cand, refresh);
  }

  /* ================================================================ demo */

  private startDemo(autoStart: boolean) {
    const demo = buildDemo();
    this.demo = true;
    this.router = new DemoRouter();
    this.jdata = new JunctionDataCache(new DemoJunctionProvider());
    this.surr = new SurroundCache(new DemoSurroundProvider());
    this.tunnels.provider = new DemoTunnelProvider();
    this.terrain = new TerrainCache(demoTerrain());
    this.terrainReady.clear();
    this.surroundReady.clear();
    this.cats = new CategorySearch(new DemoPoiProvider());
    this.search = new DemoPlaceSearch();
    this.osmReady.clear();
    this.sceneCache.clear();
    const style = demoStyle(demo.geojson, isNight(this.settings));
    this.map.setStyle(style);
    this.zoom.setStyle(style);
    if (ARTIFACT) {
      // Simulated "my location" at the start of the demo road.
      this.myPos = demo.start;
      this.map.setPuck(demo.start, 0);
    } else {
      this.map.setPuck(null);
    }
    this.trip = {
      origin: { name: 'Jalan Demo', sub: 'Demo start', lngLat: demo.start },
      stops: [],
      destination: { name: 'Sungai Buloh (demo)', sub: 'Demo destination', lngLat: demo.end },
    };
    this.openDirections(null);
    if (autoStart) {
      const wait = window.setInterval(() => {
        if (this.routes.length && !this.routesLoading) {
          clearInterval(wait);
          this.startNav(true);
        }
      }, 50);
    }
  }

  private leaveDemo() {
    this.demo = false;
    this.realProviders();
    this.refreshMapSource(true);
    this.trip = { origin: null, stops: [], destination: null };
    this.routes = [];
    this.map.clearRoutes();
    if (this.myPos) {
      this.map.setPuck(this.myPos, 0);
      this.map.flyTo(this.myPos, 14);
    }
    this.closePlace();
  }

  /* ================================================================ navigation UI */

  private buildNav() {
    const e = this.el;
    this.panel = new JunctionPanel(e.guide, {
      onClose: () => (this.jvDismissed = this.activeJ),
      onModeChange: (m) => {
        this.settings.jvMode = m;
        saveSettings(this.settings);
        this.syncZoomMap();
      },
    });
    e.guide.prepend(this.banner.el, this.banner.then, e.reroute);
    e.guide.append(this.tunnelCard.el);
    // Junction view size follows the banner (lane cue, "then" chip) and the window.
    const relayout = () => this.layoutJv();
    new ResizeObserver(relayout).observe(this.banner.el);
    new ResizeObserver(relayout).observe(this.banner.then);
    new ResizeObserver(relayout).observe(e.reroute);
    window.addEventListener('resize', relayout);
    this.banner.el.classList.add('is-tappable');
    this.banner.el.addEventListener('click', () => this.toggleNavOverlay('steps'));
    this.zoom = new ZoomMap(this.panel.mapSlot, ARTIFACT ? demoStyle(buildDemo().geojson, isNight(this.settings)) : this.baseStyle());

    const overview = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Route overview', html: ICON.overview });
    overview.addEventListener('click', () => {
      const r = this.engine.route;
      if (!r) return;
      this.map.fit(routeBounds([r]), this.overviewPadding());
      e.recenter.hidden = false;
    });
    const find = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Search along route', html: ICON.search });
    find.addEventListener('click', () => this.toggleNavOverlay('search'));
    const end = h('button', { class: 'icon-btn danger', type: 'button', 'aria-label': 'End navigation', html: ICON.close });
    end.addEventListener('click', () => this.endNav());
    e.mute.addEventListener('click', () => {
      this.settings.voice = !this.settings.voice;
      saveSettings(this.settings);
      this.paintMute();
      if (!this.settings.voice) window.speechSynthesis?.cancel();
    });
    this.paintMute();
    e.foot.append(h('div', { class: 'eta card' }, h('div', { style: 'min-width:0' }, e.etaMain, e.etaSub), h('div', { class: 'eta-btns' }, find, e.mute, overview, end)), e.speed);
    e.recenter.addEventListener('click', () => {
      this.map.startFollowing();
      e.recenter.hidden = true;
      const p = this.engine.progress;
      if (p) this.map.follow(p.snapped, p.heading, { speed: p.speed, distToNext: p.distToNext, padding: this.followPadding(), wide: this.panel.visible });
    });

    e.simPlay.addEventListener('click', () => {
      if (!this.sim) return;
      this.sim.paused = !this.sim.paused;
      e.simPlay.textContent = this.sim.paused ? 'Play' : 'Pause';
    });
    e.simSpeed.addEventListener('click', () => {
      if (!this.sim) return;
      const next = this.sim.factor >= 8 ? 1 : this.sim.factor * 2;
      this.sim.factor = next;
      this.settings.simSpeed = next;
      saveSettings(this.settings);
      e.simSpeed.textContent = `×${next}`;
    });
    const jump = h('button', { type: 'button' }, 'Next junction');
    jump.addEventListener('click', () => {
      if (!this.sim) return;
      const s = this.engine.progress?.s ?? 0;
      const nextJ = this.engine.junctions.find((j) => j.showFromS > s + 20 || (j.hideAtS > s && j.s - s > 150));
      if (!nextJ) return toast('No more junctions on this route');
      this.sim.jumpTo(Math.max(s, nextJ.showFromS + 5));
    });
    const laneLeft = h('button', { type: 'button', 'aria-label': 'Move simulated car one lane left' }, '◀');
    const laneRight = h('button', { type: 'button', 'aria-label': 'Move simulated car one lane right' }, '▶');
    const manualLane = (d: number) => {
      if (!this.sim) return;
      this.sim.autoLanes = false;
      this.sim.setLane(this.sim.lane + d);
      this.paintSimLane();
    };
    laneLeft.addEventListener('click', () => manualLane(-1));
    laneRight.addEventListener('click', () => manualLane(1));
    this.simAuto.addEventListener('click', () => {
      if (!this.sim) return;
      this.sim.autoLanes = !this.sim.autoLanes;
      this.paintSimLane();
    });
    e.sim.append(
      h('span', { class: 'sim-label' }, 'Sim'),
      e.simPlay,
      e.simSpeed,
      jump,
      h('span', { class: 'sim-lanes', role: 'group', 'aria-label': 'Simulated lane' }, laneLeft, this.simLaneLabel, laneRight, this.simAuto),
      this.testCard.button,
      this.testCard.panel,
    );
    e.app.append(e.guide, e.foot, e.recenter, e.sim);
  }

  private toggleNavOverlay(o: NavOverlay) {
    this.navOverlay = this.navOverlay === o ? null : o;
    if (this.navOverlay !== 'search' && this.navOverlay !== 'place') this.map.setResultMarkers([], () => {});
    if (this.navOverlay === 'search') this.results = [];
    this.renderSheet();
  }

  private renderNavOverlay(s: HTMLElement) {
    const route = this.engine.route;
    const p = this.engine.progress;
    if (!route) return;
    if (this.navOverlay === 'steps') {
      s.append(this.sheetHead(this.tr('remaining'), () => this.toggleNavOverlay(null)));
      s.append(
        stepsList(route, {
          lang: this.L,
          units: this.settings.units,
          from: p?.next.index ?? 1,
          progressS: p?.s,
          junctions: this.junctionMap(route),
          onPreview: (cand) => this.openPreview(route, cand),
        }),
      );
    } else if (this.navOverlay === 'search') {
      s.append(this.sheetHead(this.tr('alongRoute'), () => this.toggleNavOverlay(null)));
      const chips = h('div', { class: 'chips in-sheet' });
      this.renderChips(chips, (c) => this.runAlongRoute(c), false);
      s.append(chips);
      if (this.resultsTitle && (this.results.length || this.resultsLoading)) {
        const box = h('div', {});
        this.renderResults(box, this.results, this.resultsTitle, () => {
          this.results = [];
          this.resultsTitle = '';
          this.map.setResultMarkers([], () => {});
          this.renderSheet();
        }, (pl) => {
          this.navPlace = pl;
          this.navOverlay = 'place';
          this.renderSheet();
        });
        s.append(box);
      }
    } else if (this.navOverlay === 'place' && this.navPlace) {
      const pl = this.navPlace;
      s.append(this.sheetHead(pl.name, () => {
        this.navOverlay = 'search';
        this.renderSheet();
      }, true));
      s.append(h('p', { class: 'place-sub' }, [pl.sub, pl.note].filter(Boolean).join(' · ')));
      const add = h('button', { class: 'btn btn-primary', type: 'button' }, this.tr('addAsStop'));
      add.addEventListener('click', () => this.addStopWhileDriving(pl));
      const go = h('button', { class: 'btn btn-ghost', type: 'button' }, this.tr('goHere'));
      go.addEventListener('click', () => this.goHereInstead(pl));
      s.append(h('div', { class: 'sheet-row' }, add, go));
    }
  }

  private async runAlongRoute(cat: Category) {
    const route = this.engine.route;
    if (!route) return;
    this.resultsTitle = `${this.tr(cat.label)} · ${this.tr('alongRoute')}`;
    this.results = [];
    this.resultsLoading = true;
    this.renderSheet();
    try {
      this.results = await this.cats.alongRoute(cat, route, this.engine.progress?.s ?? 0, this.L, this.settings.units);
    } catch (err) {
      toast((err as Error).message);
    }
    this.resultsLoading = false;
    if (this.navOverlay !== 'search') return;
    this.showResultMarkers(this.results, (pl) => {
      this.navPlace = pl;
      this.navOverlay = 'place';
      this.renderSheet();
    });
    this.renderSheet();
  }

  private remainingStops(): Place[] {
    return this.trip.stops.filter((p): p is Place => !!p).slice(this.stopsPassed);
  }

  private addStopWhileDriving(p: Place) {
    this.trip.stops = [p, ...this.remainingStops()];
    this.stopsPassed = 0;
    this.navOverlay = null;
    this.map.setResultMarkers([], () => {});
    this.renderSheet();
    const fix = this.lastFix;
    if (fix) this.reroute(fix, true);
  }

  private goHereInstead(p: Place) {
    this.trip.destination = p;
    this.trip.stops = [];
    this.stopsPassed = 0;
    this.navDest = p.lngLat;
    this.navOverlay = null;
    this.map.setResultMarkers([], () => {});
    this.renderSheet();
    const fix = this.lastFix;
    if (fix) this.reroute(fix, true);
  }

  private simLaneLabel = h('span', { class: 'sim-lane-label' }, 'Lane');
  private simAuto = h('button', { type: 'button', 'aria-pressed': 'true', title: 'Simulated driver follows lane advice' }, 'Auto') as HTMLButtonElement;
  private simLaneStep = -1;
  private simLaneT0 = 0;
  private simLaneLast = 0;
  private simLaneWarnedAt = 0;

  private paintSimLane() {
    const sim = this.sim;
    if (!sim) return;
    this.simLaneLabel.textContent = `Lane ${sim.lane + 1}/${sim.laneCount}`;
    this.simAuto.setAttribute('aria-pressed', String(sim.autoLanes));
  }

  /**
   * The simulated driver starts each lane advice in the wrong lane. At every other maneuver it
   * is distracted and only moves over after the GPS lane warning, so both cases can be seen.
   */
  private driveSimLanes(p: Progress) {
    const sim = this.sim;
    if (!sim) return;
    const lane = p.lane;
    if (lane) sim.setLaneCount(lane.target.count);
    this.paintSimLane();
    if (!sim.autoLanes) return;
    if (!lane) {
      // Between decisions the car keeps to the middle of the road line.
      sim.setLaneCount(3);
      sim.setLane(1);
      return;
    }
    const t = lane.target;
    const now = performance.now();
    const inTarget = sim.lane >= t.from && sim.lane <= t.to;
    if (t.step.index !== this.simLaneStep) {
      this.simLaneStep = t.step.index;
      this.simLaneT0 = now;
      this.simLaneLast = now;
      this.simLaneWarnedAt = 0;
      if (inTarget) sim.setLane(t.side === 'left' ? t.count - 1 : t.side === 'right' ? 0 : t.from > 0 ? 0 : t.count - 1, true);
      return;
    }
    if (inTarget || sim.laneChanging) return;
    const f = Math.max(1, sim.factor);
    const distracted = t.step.index % 2 === 1 && this.engine.laneMode === 'gps';
    if (distracted) {
      // Waits for the warning (real seconds, as the engine times it), or gives up waiting.
      const heard = this.simLaneWarnedAt > 0 && now - this.simLaneWarnedAt > 2500;
      if (!heard && now - this.simLaneT0 < 30000 / f) return;
      if (now - this.simLaneLast < 3000 / f) return;
    } else if (now - this.simLaneT0 < 4500 / f || now - this.simLaneLast < 3000 / f) return;
    this.simLaneLast = now;
    sim.setLane(sim.lane + (sim.lane < t.from ? 1 : -1));
  }

  /** Spoken text for a prompt: maneuvers get a lane hint, lane prompts their own phrasing. */
  private promptText(pr: Prompt): string {
    const units = this.settings.units;
    switch (pr.kind) {
      case 'laneEarly':
        return lanePhrase('early', pr.lane!, this.L, units);
      case 'laneWrong':
        return lanePhrase('wrong', pr.lane!, this.L, units);
      case 'laneLate':
        return lanePhrase('late', pr.lane!, this.L, units);
      case 'tunnel':
        return tunnelSpeech(pr.tunnel!, this.L, units);
      default: {
        const base = spokenInstruction(pr.step, pr.distance, this.L, units);
        return pr.lane && pr.distance != null && pr.lane.status !== 'ok' ? `${base} ${lanePhrase('hint', pr.lane, this.L, units)}` : base;
      }
    }
  }

  private paintMute() {
    this.el.mute.innerHTML = this.settings.voice ? ICON.volume : ICON.mute;
    this.el.mute.setAttribute('aria-label', this.settings.voice ? 'Mute voice' : 'Unmute voice');
    this.voice.enabled = this.settings.voice;
  }

  private applyLang() {
    document.documentElement.lang = this.L;
    this.el.q.placeholder = this.tr('search');
    this.el.recenter.textContent = this.tr('recenter');
    this.el.reroute.textContent = this.tr('rerouting');
    this.renderChips(this.el.chips, (c) => this.runNearby(c), !ARTIFACT);
    if (this.view === 'directions') this.renderDirEditor();
    this.renderSheet();
  }

  private applyTheme() {
    const root = document.documentElement;
    this.themeMutating = true;
    if (ARTIFACT && this.settings.appearance === 'auto') {
      // Leave the viewer's own theme alone; only undo an override this page set.
      if (this.themeSetByApp) delete root.dataset.theme;
      this.themeSetByApp = false;
    } else {
      root.dataset.theme = isNight(this.settings) ? 'dark' : 'light';
      this.themeSetByApp = true;
    }
    this.themeMutating = false;
  }

  /* ================================================================ navigation */

  private quickStart(p: Place) {
    this.trip = { origin: null, stops: [], destination: p };
    this.openDirections(null);
    const wait = window.setInterval(() => {
      if (this.view !== 'directions') return clearInterval(wait);
      if (!this.routesLoading && (this.routes.length || this.routeErr)) {
        clearInterval(wait);
        if (this.routes.length) this.startNav(false);
      }
    }, 80);
  }

  private startNav(simulate: boolean) {
    const route = this.routes[this.selected];
    if (!route) return;
    if (ARTIFACT && !simulate) {
      simulate = true;
      if (!this.simNoticeShown) toast('Simulated drive: GPS is not available in this preview.', 4000);
      this.simNoticeShown = true;
    }
    this.engine.setRoute(route, detectJunctions(route));
    this.engine.laneMode = this.settings.laneAlerts;
    this.engine.tunnelAlerts = this.settings.tunnelAlerts;
    this.tunnelCard.hide();
    this.tunnels.setRoute(route);
    this.simLaneStep = -1;
    this.prefetch(0);
    this.voice.unlock();
    this.wake.on();
    this.activeJ = null;
    this.jvDismissed = null;
    this.lastStepIdx = -1;
    this.arrivedAnnounced = false;
    this.endingNav = false;
    this.stillSince = 0;
    this.stopsPassed = 0;
    this.navDest = route.geometry[route.geometry.length - 1];
    this.trip.stops = this.trip.stops.filter((p): p is Place => !!p);
    this.map.showRoutes([route], 0);
    this.map.setDestination(this.navDest);
    this.source?.stop();
    if (simulate) {
      this.sim = new Simulator(route, this.settings.simSpeed);
      this.sim.outages = this.outagesFor(this.tunnels.spans);
      this.source = this.sim;
      this.el.simPlay.textContent = 'Pause';
      this.el.simSpeed.textContent = `×${this.sim.factor}`;
    } else {
      this.sim = null;
      this.source = new GpsSource();
    }
    this.setView('nav');
    this.map.startFollowing();
    // Dead reckoning: keeps the position moving through tunnels when GPS fixes stop.
    window.clearInterval(this.drTimer);
    this.drTimer = window.setInterval(() => {
      if (this.view !== 'nav' || this.sim?.paused) return;
      const f = this.engine.deadReckon(Date.now(), { rate: this.sim?.factor ?? 1 });
      if (f) this.onFix(f);
    }, 300);
    this.source.start(
      (f) => this.onFix(f),
      (err) => toast(err.message),
    );
    const first = route.steps[1];
    if (first) this.say(spokenInstruction(first, first.s > 300 ? first.s : null, this.L, this.settings.units));
  }

  private endNav() {
    const run = this.testRun;
    this.stopTest();
    if (run) window.setTimeout(() => showTestResult(run, () => void this.runTestDrive(run.drive)), 400);
    this.source?.stop();
    this.source = null;
    this.sim = null;
    window.clearInterval(this.drTimer);
    this.tunnels.stop();
    this.tunnelCard.hide();
    this.wake.off();
    window.speechSynthesis?.cancel();
    this.engine.route = null;
    this.panel.hide();
    this.activeJ = null;
    this.lastFix = null;
    if (ARTIFACT && this.demo) this.myPos = buildDemo().start;
    if (this.myPos && (!this.demo || ARTIFACT)) this.map.setPuck(this.myPos, 0);
    this.map.setManeuver(null, null);
    this.showSteps = false;
    if (navigator.onLine) this.refreshMapSource();
    this.setView('directions');
    this.renderDirEditor();
    if (this.routes.length) {
      this.map.showRoutes(this.routes, this.selected);
      this.map.fit(routeBounds(this.routes), this.overviewPadding());
    }
    this.computeRoutes();
  }

  private say(text: string, urgent = true) {
    this.voice.speak(text, LANGS[this.L].speechLang, urgent);
  }

  /** New tunnel detail for the active route: engine, map and the simulator's GPS gaps. */
  private onTunnels(spans: TunnelSpan[]) {
    this.engine.setTunnels(spans);
    this.map.setTunnels(spans);
    if (this.sim) this.sim.outages = this.outagesFor(spans);
  }

  private outagesFor(spans: TunnelSpan[]): [number, number][] {
    return spans.filter(isMajor).map((t) => [t.fromS + 15, t.toS - 10]);
  }

  private lastFix: Fix | null = null;

  private onFix(fix: Fix) {
    const p = this.engine.update(fix);
    const route = this.engine.route;
    if (!p || !route) return;
    this.lastFix = fix;
    this.myPos = fix.lngLat;
    if (!this.sim && !fix.dr && Math.random() < 0.05) rememberPosition(fix.lngLat);
    const units = this.settings.units;
    const locale = this.L === 'ja' ? 'ja-JP' : this.L === 'ms' ? 'ms-MY' : 'en-GB';

    this.map.setPuck(p.snapped, p.heading);
    this.map.setProgress(p.s);
    if (p.next.index !== this.lastStepIdx) {
      this.lastStepIdx = p.next.index;
      this.map.setManeuver(route, p.next);
      if (this.navOverlay === 'steps') this.renderSheet();
    }
    this.map.follow(p.snapped, p.heading, { speed: p.speed, distToNext: p.distToNext, padding: this.followPadding(), wide: this.panel.visible });

    this.driveSimLanes(p);
    this.banner.update(p.next, p.after, p.distToNext, this.L, units, true, p.lane);
    const eta = p.eta.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    this.el.etaMain.innerHTML = `${eta}<small>${this.tr('arrival')}</small>`;
    this.el.etaSub.textContent = p.nextStop
      ? `${this.tr('stop')} ${p.nextStop.number}: ${p.nextStop.eta.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} · ${formatDistance(p.nextStop.dist, units)}`
      : `${formatDuration(p.remainingTime)} · ${formatDistance(p.remaining, units)}`;
    this.tunnelCard.update(this.settings.tunnelAlerts ? p.tunnel : null, { lang: this.L, units, theme: this.themeFor(route), dr: p.dr });
    const kmh = Math.round(p.speed * 3.6);
    this.el.speed.innerHTML = `<div>${units === 'imperial' ? Math.round(kmh / 1.609) : kmh}<small>${units === 'imperial' ? 'mph' : 'km/h'}</small></div>`;

    const prompts = this.engine.prompts(p);
    for (const pr of prompts) {
      const text = this.promptText(pr);
      if (pr.kind === 'laneWrong') {
        if (!this.simLaneWarnedAt) this.simLaneWarnedAt = performance.now();
        this.voice.chime();
        window.setTimeout(() => this.say(text), 420);
      } else {
        // "Now" prompts and lane warnings interrupt; advance notices queue behind what is playing.
        this.say(text, pr.kind === 'laneLate' || (pr.kind === 'maneuver' && pr.distance == null));
      }
    }
    this.testRun?.progress(p, prompts, this.settings.tunnelAlerts);
    if (p.stopsPassed > this.stopsPassed) {
      this.stopsPassed = p.stopsPassed;
      toast(describeStep(route.steps.find((st) => st.waypoint === p.stopsPassed) ?? p.next, this.L).action);
    }
    try {
      this.handleJunction(p);
    } catch (err) {
      console.error('[junction] view failed', err);
    }

    // Arrival: announced within 300 m of the destination; navigation ends at the end of the
    // route, or once the car has been parked for half a minute inside that zone.
    if (p.nearDestination && !this.arrivedAnnounced) {
      this.arrivedAnnounced = true;
      const arrive = route.steps[route.steps.length - 1];
      const m = arrive.modifier ?? '';
      const msg = arrivalSpeech(this.L, m.includes('left') ? 'left' : m.includes('right') ? 'right' : undefined);
      this.say(msg);
      toast(msg, 5000);
    }
    if (this.arrivedAnnounced) {
      this.stillSince = p.speed < 1.5 ? this.stillSince || Date.now() : 0;
      const parked = this.stillSince > 0 && Date.now() - this.stillSince > 30_000;
      if ((p.arrived || parked) && !this.endingNav) {
        this.endingNav = true;
        window.setTimeout(() => this.view === 'nav' && this.endNav(), p.arrived ? 6000 : 1500);
      }
    }

    // Inside the arrival zone (car parks, side streets) leaving the route is expected.
    if (p.offRoute && !this.sim && !this.demo && !this.arrivedAnnounced) this.reroute(fix);
    else if (!this.rerouting) this.el.reroute.hidden = true;

    if (Date.now() - this.lastPrefetch > 15000) this.prefetch(p.s);
  }

  /** Fetch OSM detail for upcoming junctions (a few queries per route). */
  private prefetch(s: number) {
    this.lastPrefetch = Date.now();
    this.tunnels.ensure(s);
    // Surroundings are heavier: only the next junctions within a few kilometres.
    for (const j of this.engine.junctions.filter((c) => c.s >= s - 50 && c.s - s <= 4000).slice(0, 3)) {
      const redraw = () => {
        if (this.activeJ === j.id) this.showJunction(j, true);
      };
      this.loadSurround(j, redraw);
      this.loadTerrain(j, redraw);
    }
    const upcoming = this.engine.junctions.filter((j) => j.s >= s - 50 && j.s <= s + 12000).slice(0, 12);
    const todo = upcoming.filter((j) => !this.osmReady.has(JunctionDataCache.key(j.location)));
    if (!todo.length) return;
    this.jdata.prefetch(todo.map((j) => j.location));
    for (const j of todo) {
      this.loadDetail(j, () => {
        if (this.activeJ === j.id) this.showJunction(j, true);
      });
    }
  }

  private showJunction(cand: JunctionCandidate, force = false) {
    const route = this.engine.route;
    if (!route || (this.jvDismissed === cand.id && !force)) return;
    this.layoutJv();
    const scene = this.sceneFor(route, cand);
    this.testRun?.junctionShown(cand, scene);
    this.panel.show(scene, this.themeFor(route), {
      night: isNight(this.settings),
      lang: this.L,
      units: this.settings.units,
      mode: this.settings.jvMode,
      total: cand.s - cand.showFromS,
    });
    this.syncZoomMap();
  }

  private syncZoomMap() {
    const cand = this.engine.junctions.find((c) => c.id === this.activeJ);
    if (!cand || !this.engine.route || this.settings.jvMode === 'illustration' || !this.panel.visible) return;
    const route = this.engine.route;
    const scene = this.sceneFor(route, cand);
    requestAnimationFrame(() => this.zoom.show(route, cand, scene, isNight(this.settings)));
  }

  private handleJunction(p: Progress) {
    if (p.junction) {
      const cand = p.junction.cand;
      if (this.activeJ !== cand.id) {
        this.activeJ = cand.id;
        if (
          !this.osmReady.has(JunctionDataCache.key(cand.location)) ||
          !this.surroundReady.has(SurroundCache.key(cand.location)) ||
          !this.terrainReady.has(TerrainCache.key(cand.location))
        )
          this.prefetch(p.s);
        this.showJunction(cand);
      }
      if (this.panel.visible) {
        this.panel.setDistance(p.junction.dist);
        if (this.settings.jvMode !== 'illustration' && this.zoom.updatePuck(p.snapped, p.heading) && this.testRun && this.panel.current)
          this.testRun.map3dShown(this.panel.current);
      }
    } else if (this.activeJ) {
      this.activeJ = null;
      this.panel.hide();
    }
  }

  private async reroute(fix: Fix, force = false) {
    if (this.rerouting || (!force && Date.now() - this.lastReroute < 8000) || !this.navDest) return;
    this.rerouting = true;
    this.lastReroute = Date.now();
    this.el.reroute.hidden = false;
    try {
      const res = await this.router.route({
        origin: fix.lngLat,
        destination: this.navDest,
        via: this.remainingStops().map((p) => p.lngLat),
        bearing: fix.heading,
        avoid: this.settings.avoid,
      });
      const r = res.routes[0];
      if (res.warnings.length) toast(res.warnings[0], 5000);
      this.trip.stops = this.remainingStops();
      this.stopsPassed = 0;
      this.routes = [r];
      this.selected = 0;
      this.engine.setRoute(r, detectJunctions(r));
      this.engine.laneMode = this.settings.laneAlerts;
      this.engine.tunnelAlerts = this.settings.tunnelAlerts;
      this.tunnels.setRoute(r);
      if (this.sim) {
        this.sim.route = r;
        this.sim.jumpTo(0);
      }
      this.map.showRoutes([r], 0);
      this.map.setDestination(this.navDest);
      this.activeJ = null;
      this.lastStepIdx = -1;
      this.prefetch(0);
      const first = r.steps[1];
      if (first) this.say(spokenInstruction(first, first.s > 200 ? first.s : null, this.L, this.settings.units));
    } catch (err) {
      toast(`Reroute failed: ${(err as Error).message}`);
    } finally {
      this.rerouting = false;
      this.el.reroute.hidden = true;
    }
  }

  /* ================================================================ layout helpers */

  private wide() {
    return window.matchMedia('(min-width: 900px)').matches;
  }

  private landscape() {
    return window.matchMedia('(min-aspect-ratio: 5/4) and (min-width: 700px)').matches;
  }

  /**
   * Junction view height, kept at 1:3 with the main map: stacked under the banner it gets a
   * quarter of the space below the banner (the map the other three quarters); docked beside
   * the map it is a third of the map's height.
   */
  private layoutJv() {
    const e = this.el;
    const H = window.innerHeight;
    let jvH: number;
    if (this.landscape()) {
      jvH = H / 3;
    } else {
      let top = 0;
      for (const el of [this.banner.el, this.banner.then, e.reroute]) {
        if (el.hidden || !el.isConnected) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0) top = Math.max(top, r.bottom);
      }
      jvH = (H - top) / 4;
    }
    jvH = Math.round(Math.max(110, jvH));
    if (e.guide.style.getPropertyValue('--jv-h') !== `${jvH}px`) e.guide.style.setProperty('--jv-h', `${jvH}px`);
    const compact = String(jvH < 240);
    if (this.panel.el.dataset.compact !== compact) this.panel.el.dataset.compact = compact;
  }

  private followPadding() {
    const H = window.innerHeight;
    const g = this.el.guide.getBoundingClientRect();
    // Keep the car above whatever sits at the bottom: the ETA card, and the simulator bar.
    let obstacle = H - 70;
    for (const el of [this.el.foot.querySelector('.eta'), this.el.sim]) {
      if (!el || (el as HTMLElement).hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0) obstacle = Math.min(obstacle, r.top);
    }
    const below = (top: number) => Math.min(Math.max(70, H - obstacle + 12), H - top - 40);
    if (this.landscape()) {
      const top = H * 0.38;
      return { top, bottom: below(top), left: g.width, right: 10 };
    }
    const top = Math.min(H - 160, g.bottom + (H - g.bottom) * 0.32);
    return { top, bottom: below(top), left: 0, right: 0 };
  }

  private overviewPadding() {
    const tb = this.el.topbar.getBoundingClientRect();
    const sheet = this.el.sheet.hidden ? null : this.el.sheet.getBoundingClientRect();
    if (this.wide()) return { top: 50, bottom: 50, left: Math.max(tb.right, sheet?.right ?? 0) + 40, right: 60 };
    return { top: Math.max(80, tb.bottom + 20), bottom: Math.max(60, (sheet?.height ?? 0) + 40), left: 40, right: 40 };
  }

  private async editSettings() {
    const u = this.user;
    const next = await openSettings(this.settings, {
      preview: ARTIFACT,
      pack: ARTIFACT ? undefined : this.offline,
      account: u
        ? {
            name: u.name,
            email: u.email,
            kind: this.auth.kind,
            onSignOut: () => void this.signOut(),
            onRemove: this.auth.kind === 'local' ? () => void this.signOut(true) : undefined,
          }
        : this.signedIn
          ? null
          : undefined,
      onSignIn: () => void this.signOut(),
    });
    if (!next) return;
    this.engine.laneMode = next.laneAlerts;
    this.engine.tunnelAlerts = next.tunnelAlerts;
    const prev = this.settings;
    this.settings = next;
    saveSettings(next);
    this.applyTheme();
    this.applyLang();
    this.paintMute();
    if (this.demo && prev.appearance !== next.appearance) {
      const st = demoStyle(buildDemo().geojson, isNight(next));
      this.map.setStyle(st);
      this.zoom.setStyle(st);
    }
    if (!this.demo) {
      if (prev.routerUrl !== next.routerUrl || prev.overpassUrls !== next.overpassUrls) this.realProviders();
      const changed = (a: string | StyleSpecification, b: string | StyleSpecification) => (typeof a === 'string' || typeof b === 'string' ? a !== b : JSON.stringify(a) !== JSON.stringify(b));
      if (changed(this.baseStyle(next), this.baseStyle(prev))) this.refreshMapSource(true);
    }
    this.sceneCache.clear();
  }
}

const app = new App();
app.init();
void app.boot();

// Keep the app itself on the device so it opens without internet (the map pack is stored separately).
if (import.meta.env.PROD && !ARTIFACT && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href).catch((e) => console.warn('[sw]', e));
  });
}
