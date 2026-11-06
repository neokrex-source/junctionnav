/**
 * Keeps live traffic for the drive up to date without spending the free TomTom allowance:
 * incidents on the road ahead every few minutes (sooner after a new route or when the car nears
 * the end of the stretch it asked about), the travel time with traffic every five minutes, the
 * prepared alternatives' times every ten, and the news feed every ten. Driven by the navigation's
 * position updates, so nothing runs when nobody is driving or looking at the map.
 */
import type { LngLat } from '../geo/geo';
import type { Route } from '../routing/types';
import { fetchNews } from './news';
import { boxAhead, incidentDelayAhead, incidentsOnRoute, newsForRoute, pointsAhead, recentNews, routeRoads, routeTimeFrom } from './onRoute';
import { TomTomTraffic, type Bbox } from './tomtom';
import type { Incident, NewsItem, RouteIncident, TrafficEta } from './types';

export const INCIDENTS_EVERY = 4 * 60_000;
export const ETA_EVERY = 5 * 60_000;
export const ALTS_EVERY = 10 * 60_000;
export const NEWS_EVERY = 10 * 60_000;
/** Browsing the map: incidents for the view at most this often. */
export const BROWSE_EVERY = 3 * 60_000;

/** An alternative's travel time with traffic against the current route's, asked at the same moment. */
export interface AltEta {
  route: Route;
  /** Where the car is along the alternative. */
  s: number;
  travelTime: number;
  delay: number;
  /** The current route's time with traffic from the same place, asked in the same round. */
  mainTime: number;
  at: number;
}

export interface TrafficOptions {
  key: () => string;
  newsUrl: () => string;
  newsOn: () => boolean;
  incidentsOn: () => boolean;
  now?: () => number;
  online?: () => boolean;
}

export class TrafficService {
  readonly tomtom: TomTomTraffic;
  /** Incidents in the last box asked about (for the map). */
  incidents: Incident[] = [];
  /** Incidents on the route being driven, from the car on. */
  onRoute: RouteIncident[] = [];
  eta: TrafficEta | null = null;
  altEtas: AltEta[] = [];
  news: NewsItem[] = [];
  routeNews: NewsItem[] = [];
  newsUpdated = '';
  /** The last TomTom problem, for Settings and the traffic list ('' when fine). */
  error = '';
  /** When the incidents last arrived (ms). */
  incidentsAt = -Infinity;
  /** Called whenever any of the above changes. */
  onChange: (() => void) | null = null;

  private route: Route | null = null;
  /** The roads (HIGHWAYS keys) of the route being driven. */
  roads: string[] = [];
  private alts: Route[] = [];
  private s = 0;
  private incAt = -Infinity;
  private incToS = 0;
  private incBusy = false;
  private etaAt = -Infinity;
  private etaBusy = false;
  /** What the incidents ahead added up to when the travel time was asked, to ask again when that changes. */
  private incDelayAtEta = 0;
  private altsAt = -Infinity;
  private altsBusy = false;
  private newsAt = -Infinity;
  private newsBusy = false;
  private browseAt = -Infinity;
  private browseBox: Bbox | null = null;
  private ctrl = new AbortController();
  private now: () => number;
  private online: () => boolean;

  constructor(private o: TrafficOptions) {
    this.tomtom = new TomTomTraffic(o.key);
    this.now = o.now ?? (() => Date.now());
    this.online = o.online ?? (() => navigator.onLine !== false);
  }

  get live(): boolean {
    return this.tomtom.enabled && this.o.incidentsOn();
  }

  /** A new route to drive (or none): its traffic is asked for at the next tick. */
  setRoute(route: Route | null, s = 0) {
    if (route === this.route) return;
    this.ctrl.abort();
    this.ctrl = new AbortController();
    this.incBusy = this.etaBusy = this.altsBusy = false;
    this.route = route;
    this.roads = route ? routeRoads(route) : [];
    this.s = s;
    this.onRoute = [];
    this.eta = null;
    this.altEtas = [];
    this.incAt = this.etaAt = -Infinity;
    // Alternatives' times wait a little after a new route, so its own come first.
    this.altsAt = this.now() - ALTS_EVERY + 60_000;
    this.routeNews = route ? newsForRoute(this.news, this.roads, this.now()) : [];
    if (route && this.incidents.length) this.onRoute = incidentsOnRoute(route, this.incidents, s);
    this.onChange?.();
  }

  /** A travel time with traffic already known for the route (from planning). */
  seed(eta: TrafficEta) {
    if (!this.route) return;
    this.eta = eta;
    this.etaAt = eta.at;
    this.incDelayAtEta = incidentDelayAhead(this.onRoute, eta.fromS);
    this.onChange?.();
  }

  /** Forget the news (turned off). */
  clearNews() {
    this.news = [];
    this.routeNews = [];
    this.newsAt = -Infinity;
    this.onChange?.();
  }

  setAlternatives(routes: Route[]) {
    this.alts = routes;
    this.altEtas = this.altEtas.filter((a) => routes.includes(a.route));
  }

  /** The car is `s` metres along the route: starts whatever is due. */
  tick(s: number) {
    this.s = s;
    const now = this.now();
    if (this.onRoute.length && this.onRoute[0].endS < s) {
      this.onRoute = this.onRoute.filter((i) => i.endS >= s);
      this.onChange?.();
    }
    if (this.o.newsOn() && now - this.newsAt > NEWS_EVERY) void this.refreshNews();
    const route = this.route;
    if (!route || !this.live || !this.online()) return;
    const nearEnd = this.incToS < route.line.length - 100 && s > this.incToS - 5000;
    if (!this.incBusy && (now - this.incAt > INCIDENTS_EVERY || (nearEnd && now - this.incAt > 60_000))) void this.refreshIncidents(route);
    if (!this.etaBusy && now - this.etaAt > ETA_EVERY && route.line.length - s > 1000) void this.refreshEta(route);
    if (!this.altsBusy && this.alts.length && now - this.altsAt > ALTS_EVERY && route.line.length - s > 3000) void this.refreshAlts(route);
  }

  /** Not driving: incidents for what the map shows (wide views are skipped). */
  browse(bbox: Bbox, zoom: number) {
    if (this.route || !this.live || !this.online() || zoom < 10 || document.hidden) return;
    const now = this.now();
    const inside = this.browseBox && bbox[0] >= this.browseBox[0] && bbox[1] >= this.browseBox[1] && bbox[2] <= this.browseBox[2] && bbox[3] <= this.browseBox[3];
    if (this.incBusy || now - this.browseAt < (inside ? BROWSE_EVERY : 45_000)) return;
    // Ask for a little more than the view, so small moves need nothing new.
    const mx = (bbox[2] - bbox[0]) * 0.25;
    const my = (bbox[3] - bbox[1]) * 0.25;
    const box: Bbox = [bbox[0] - mx, bbox[1] - my, bbox[2] + mx, bbox[3] + my];
    this.browseAt = now;
    this.browseBox = box;
    this.incBusy = true;
    const signal = this.ctrl.signal;
    this.tomtom
      .incidents(box, signal)
      .then((list) => {
        if (signal.aborted || this.route) return;
        this.incidents = list;
        this.incidentsAt = this.now();
        this.error = '';
        this.onChange?.();
      })
      .catch((err) => this.fail(err, signal))
      .finally(() => (this.incBusy = false));
  }

  /** Forget the traffic (key removed, traffic turned off). */
  clear() {
    this.ctrl.abort();
    this.ctrl = new AbortController();
    this.incBusy = this.etaBusy = this.altsBusy = false;
    this.incidents = [];
    this.onRoute = [];
    this.eta = null;
    this.altEtas = [];
    this.error = '';
    this.incAt = this.etaAt = this.browseAt = this.incidentsAt = -Infinity;
    this.browseBox = null;
    this.onChange?.();
  }

  /** Travel times with traffic for the routes being compared before a drive (from their start). */
  async planTimes(routes: Route[], signal?: AbortSignal): Promise<({ travelTime: number; delay: number } | null)[]> {
    if (!this.live || !this.online()) return routes.map(() => null);
    return Promise.all(
      routes.map((r) =>
        this.tomtom.travelTime(pointsAhead(r, 0, 300, 100), signal).catch((err) => {
          this.fail(err, signal);
          return null;
        }),
      ),
    );
  }

  async refreshNews(force = false) {
    const url = this.o.newsUrl();
    if (!url || this.newsBusy || (!force && this.now() - this.newsAt < 60_000)) return;
    this.newsBusy = true;
    this.newsAt = this.now();
    try {
      const feed = await fetchNews(url);
      this.news = recentNews(feed.items, this.now());
      this.newsUpdated = feed.updated;
      this.routeNews = this.route ? newsForRoute(this.news, this.roads, this.now()) : [];
      this.onChange?.();
    } catch (err) {
      console.warn('[traffic] news', (err as Error).message);
    } finally {
      this.newsBusy = false;
    }
  }

  private async refreshIncidents(route: Route) {
    this.incBusy = true;
    this.incAt = this.now();
    const signal = this.ctrl.signal;
    const fromS = this.s;
    const { bbox, toS } = boxAhead(route, fromS);
    try {
      const list = await this.tomtom.incidents(bbox, signal);
      if (signal.aborted || this.route !== route) return;
      this.incidents = list;
      this.incidentsAt = this.now();
      this.incToS = toS;
      this.onRoute = incidentsOnRoute(route, list, Math.max(0, this.s - 50)).filter((i) => i.s <= toS + 500);
      // Traffic ahead got clearly better or worse: a fresh travel time now rather than in a few minutes.
      if (this.eta && Math.abs(incidentDelayAhead(this.onRoute, this.s) - this.incDelayAtEta) >= 120 && this.now() - this.etaAt > 60_000) this.etaAt = -Infinity;
      this.error = '';
      this.onChange?.();
    } catch (err) {
      this.fail(err, signal);
    } finally {
      if (this.route === route) this.incBusy = false;
    }
  }

  private async refreshEta(route: Route) {
    this.etaBusy = true;
    this.etaAt = this.now();
    const signal = this.ctrl.signal;
    const s = this.s;
    try {
      const r = await this.tomtom.travelTime(pointsAhead(route, s, 300, 100), signal);
      if (signal.aborted || this.route !== route) return;
      this.eta = { ...r, fromS: s, at: this.now(), base: routeTimeFrom(route, s) };
      this.incDelayAtEta = incidentDelayAhead(this.onRoute, s);
      this.error = '';
      this.onChange?.();
    } catch (err) {
      this.fail(err, signal);
    } finally {
      if (this.route === route) this.etaBusy = false;
    }
  }

  /**
   * The alternatives' times and the current route's, from where the car is, in one round, so the
   * comparison is fair. An alternative the car is no longer on the start of is skipped.
   */
  private async refreshAlts(route: Route) {
    this.altsBusy = true;
    this.altsAt = this.now();
    const signal = this.ctrl.signal;
    const s = this.s;
    const here: LngLat = route.line.pointAt(s);
    const todo = this.alts
      .map((alt) => ({ alt, pr: alt.line.project(here) }))
      .filter(({ alt, pr }) => pr.dist < 60 && alt.line.length - pr.s > 2000)
      .slice(0, 3);
    try {
      if (!todo.length) return;
      const main = await this.tomtom.travelTime(pointsAhead(route, s, 300, 100), signal);
      if (signal.aborted || this.route !== route) return;
      this.eta = { ...main, fromS: s, at: this.now(), base: routeTimeFrom(route, s) };
      this.incDelayAtEta = incidentDelayAhead(this.onRoute, s);
      const out: AltEta[] = [];
      for (const { alt, pr } of todo) {
        const r = await this.tomtom.travelTime(pointsAhead(alt, pr.s, 300, 100), signal).catch(() => null);
        if (signal.aborted || this.route !== route) return;
        if (r) out.push({ route: alt, s: pr.s, travelTime: r.travelTime, delay: r.delay, mainTime: main.travelTime, at: this.now() });
      }
      this.altEtas = out;
      this.error = '';
      this.onChange?.();
    } catch (err) {
      this.fail(err, signal);
    } finally {
      if (this.route === route) this.altsBusy = false;
    }
  }

  private fail(err: unknown, signal?: AbortSignal) {
    if (signal?.aborted || (err as Error).name === 'AbortError') return;
    const msg = (err as Error).message || String(err);
    console.warn('[traffic]', msg);
    if (msg !== this.error) {
      this.error = msg;
      this.onChange?.();
    }
  }
}

/**
 * The best alternative worth switching to: at least `minSave` seconds and `minShare` of the
 * current route's time faster, asked within the last `maxAge` ms, with the car still on the part
 * it shares with the current route. Its `s` is where the car is along it now.
 */
export function fasterAlternative(alts: AltEta[], here: LngLat, now: number, minSave = 300, minShare = 0.1, maxAge = 4 * 60_000): (AltEta & { save: number }) | null {
  let best: (AltEta & { save: number }) | null = null;
  for (const a of alts) {
    if (now - a.at > maxAge) continue;
    const save = a.mainTime - a.travelTime;
    if (save < minSave || save < a.mainTime * minShare) continue;
    const pr = a.route.line.project(here, Math.max(0, a.s - 100));
    if (pr.dist > 60 || a.route.line.length - pr.s < 1500) continue;
    if (!best || a.travelTime < best.travelTime) best = { ...a, s: pr.s, save };
  }
  return best;
}
