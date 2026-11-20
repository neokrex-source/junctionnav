/**
 * Rest stops. The car standing at a petrol station, a rest area (R&R), a car park or a building
 * (a shop, a restaurant), or a while anywhere off the road, is a break, not a wrong turn: guidance
 * pauses there (no turn prompts, no rerouting), and carries on when the car drives off.
 *
 * Where the car is comes from the map under it (buildings and points of interest drawn on it),
 * the downloaded places and OpenStreetMap (Overpass), whichever answers; without any of them a
 * longer stop off the road still counts.
 */
import { haversine, type LngLat } from '../geo/geo';

export type RestKind = 'fuel' | 'rest' | 'parking' | 'building';

export interface RestPlace {
  kind: RestKind;
  name?: string;
}

/** Under this the car is standing (m/s, about 5 km/h). */
export const REST_STILL = 1.5;
/** Over this the car is driving again (m/s, about 13 km/h). */
export const REST_MOVING = 3.5;
/** Standing this long at a petrol station, rest area, car park or building is a rest stop (ms). */
export const REST_AT_PLACE = 8_000;
/** Standing this long well off the road, with no place known, is one too (ms). */
export const REST_OFF_ROAD = 30_000;
/** Off the route line by this much at a known place: on its forecourt or car park, not in a lane (m). */
export const PLACE_OFFSET = 12;
/** Off the route line by this much with no place known (m). */
export const OFF_ROAD_OFFSET = 25;
/** Slower than this off the route at a petrol station, rest area or car park: pulling in or out (m/s). */
export const PULL_SPEED = 8;
/** After a rest, rerouting waits this long while the car is still slow off the route (ms). */
export const PULL_OUT_MS = 90_000;
/** "Resume now" keeps a new rest stop from starting for this long (ms). */
export const RESUME_HOLD = 3 * 60_000;

export interface RestInput {
  time: number;
  lngLat: LngLat;
  speed: number;
  accuracy: number;
  /** Metres from the route line. */
  offset: number;
  /** In the arrival zone, where stopping is the arrival's business. */
  nearDestination: boolean;
  /** What is there: a place, nothing (null), or not known yet (undefined). */
  place: RestPlace | null | undefined;
}

export interface Resting {
  since: number;
  at: LngLat;
  place: RestPlace | null;
}

export type RestEvent = { kind: 'start'; rest: Resting } | { kind: 'end'; rest: Resting; duration: number } | null;

/** Places where a stop is a break: all of them (buildings count only when the car is inside one). */
const restful = (p: RestPlace | null | undefined): p is RestPlace => !!p;
/** Places with a forecourt or car park beside the road. */
const pullIn = (p: RestPlace | null | undefined) => !!p && p.kind !== 'building';

export class RestWatch {
  resting: Resting | null = null;
  private stillSince: number | null = null;
  private movingFixes = 0;
  private awayFixes = 0;
  private endedAt: number | null = null;
  private holdUntil = -Infinity;

  reset() {
    this.resting = null;
    this.stillSince = null;
    this.movingFixes = 0;
    this.awayFixes = 0;
    this.endedAt = null;
    this.holdUntil = -Infinity;
  }

  /** Standing still since when (null when moving). */
  get standingSince(): number | null {
    return this.stillSince;
  }

  update(x: RestInput): RestEvent {
    const r = this.resting;
    if (r) {
      // A few seconds of driving away from where it stood (more with poor GPS, whose speed can be
      // worked out from wandering positions), or well away from it twice running. A GPS jump
      // alone, with the car standing, is not driving off.
      const from = haversine(r.at, x.lngLat);
      this.movingFixes = x.speed > REST_MOVING ? this.movingFixes + 1 : 0;
      this.awayFixes = from > Math.max(60, x.accuracy * 1.5) && x.speed > REST_STILL ? this.awayFixes + 1 : 0;
      if ((this.movingFixes >= (x.accuracy > 30 ? 5 : 3) && from > 20) || this.awayFixes >= 2) return this.finish(x.time);
      return null;
    }
    if (x.speed < REST_STILL) this.stillSince ??= x.time;
    else if (x.speed > REST_MOVING) this.stillSince = null;
    // Creeping between the two (finding a space) keeps the clock running.
    if (this.stillSince == null || x.nearDestination || x.time < this.holdUntil) return null;
    const stood = x.time - this.stillSince;
    const atPlace = restful(x.place) && x.offset >= (x.place.kind === 'building' ? 0 : PLACE_OFFSET) && stood >= REST_AT_PLACE;
    const offRoad = x.offset >= OFF_ROAD_OFFSET && stood >= REST_OFF_ROAD;
    if (!atPlace && !offRoad) return null;
    this.resting = { since: this.stillSince, at: x.lngLat, place: restful(x.place) ? x.place : null };
    this.movingFixes = 0;
    this.awayFixes = 0;
    return { kind: 'start', rest: this.resting };
  }

  /** The driver says go on ("Resume now"): the rest ends, and no new one starts for a while. */
  resumeNow(time: number): RestEvent {
    if (!this.resting) return null;
    this.holdUntil = time + RESUME_HOLD;
    return this.finish(time);
  }

  private finish(time: number): RestEvent {
    const rest = this.resting!;
    this.resting = null;
    this.stillSince = null;
    this.movingFixes = 0;
    this.endedAt = time;
    return { kind: 'end', rest, duration: time - rest.since };
  }

  /**
   * Whether leaving the route is no reason to reroute right now: during a rest stop, while
   * standing (GPS wanders in a car park or under a roof), pulling in to a petrol station, rest
   * area or car park, and slowly pulling out after a rest (back on the route, nothing changes).
   */
  holdReroute(x: RestInput): boolean {
    if (this.resting) return true;
    if (x.speed < REST_STILL) return true;
    const slowOff = x.speed < PULL_SPEED && x.offset >= 20;
    if (slowOff && pullIn(x.place)) return true;
    if (slowOff && this.endedAt != null && x.time - this.endedAt < PULL_OUT_MS) return true;
    return false;
  }
}

/* ------------------------------------------------------------------ what is there */

/** OpenStreetMap tags (or the map's own attributes) as a kind of rest place, or null. */
export function restKindOfTags(t: Record<string, unknown>): RestKind | null {
  const s = (k: string) => (typeof t[k] === 'string' ? (t[k] as string) : '');
  const amenity = s('amenity');
  const highway = s('highway');
  if (amenity === 'fuel' || amenity === 'charging_station') return 'fuel';
  if (highway === 'services' || highway === 'rest_area') return 'rest';
  if (amenity === 'parking' || s('parking') || amenity === 'parking_space') return 'parking';
  if (s('building') && s('building') !== 'no') return 'building';
  if (s('shop') || /^(restaurant|fast_food|cafe|food_court|marketplace|place_of_worship|toilets)$/.test(amenity)) return 'building';
  return null;
}

/** A feature the map draws under the car, reduced to what tells the kind of place. */
export interface MapFeatureLite {
  /** The tiles' layer ("poi", "building", "pois", "buildings", "landuse"…). */
  layer: string;
  props: Record<string, unknown>;
  /** Polygon (the car is inside it) or point (close by). */
  polygon: boolean;
}

const FUEL = /^(fuel|gas_station|petrol_station|petrol|charging_station|ev_charging|filling_station)$/;
const REST = /^(services|rest_area|service_area|motorway_service|rest_stop)$/;
const PARKING = /^(parking|car_park|parking_garage|parking_lot|multi_storey|parking_entrance)$/;
const BUILDINGISH = /^(shop|mall|shopping|supermarket|restaurant|fast_food|cafe|food_court|convenience|marketplace|retail|department_store)$/;

/**
 * The kind of place from what the map draws there: OpenMapTiles (poi class and subclass,
 * building), TomTom (pois and buildings categories) and Protomaps (pois and landuse kinds).
 */
export function restKindOfFeature(f: MapFeatureLite): RestKind | null {
  const words = ['class', 'subclass', 'kind', 'kind_detail', 'category', 'subcategory', 'type', 'amenity', 'highway']
    .map((k) => f.props[k])
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.toLowerCase().replace(/[\s-]+/g, '_'));
  if (words.some((w) => FUEL.test(w))) return 'fuel';
  if (words.some((w) => REST.test(w))) return 'rest';
  if (words.some((w) => PARKING.test(w))) return 'parking';
  if (f.polygon && /building/.test(f.layer)) return 'building';
  if (!f.polygon && words.some((w) => BUILDINGISH.test(w))) return 'building';
  return null;
}

const RANK: Record<RestKind, number> = { fuel: 0, rest: 1, parking: 2, building: 3 };

/** The most telling of several finds: petrol station, then rest area, car park, building; named ones first. */
export function bestRestPlace(found: (RestPlace | null | undefined)[]): RestPlace | null {
  const all = found.filter((p): p is RestPlace => !!p);
  if (!all.length) return null;
  all.sort((a, b) => RANK[a.kind] - RANK[b.kind] || (b.name ? 1 : 0) - (a.name ? 1 : 0));
  const best = all[0];
  // A name from another source for the same kind of place.
  if (!best.name) {
    const named = all.find((p) => p.kind === best.kind && p.name);
    if (named) return { ...best, name: named.name };
  }
  return best;
}

export function restPlaceFromFeatures(fs: MapFeatureLite[]): RestPlace | null {
  return bestRestPlace(
    fs.map((f) => {
      const kind = restKindOfFeature(f);
      if (!kind) return null;
      const name = ['name:en', 'name_en', 'name', 'brand'].map((k) => f.props[k]).find((v): v is string => typeof v === 'string' && !!v.trim());
      return { kind, ...(name ? { name: name.trim() } : {}) };
    }),
  );
}

/** Overpass: the areas the point is in, and petrol stations, car parks and rest areas right by it. */
export function restQuery(p: LngLat): string {
  const ll = `${p[1].toFixed(6)},${p[0].toFixed(6)}`;
  return (
    `[out:json][timeout:8];is_in(${ll})->.a;` +
    `(area.a["amenity"~"^(fuel|charging_station|parking|restaurant|fast_food|cafe|marketplace)$"];` +
    `area.a["highway"~"^(services|rest_area)$"];area.a["building"];area.a["shop"];area.a["parking"];);out tags;` +
    `(nwr(around:45,${ll})["amenity"~"^(fuel|charging_station|parking)$"];nwr(around:150,${ll})["highway"~"^(services|rest_area)$"];);out tags 12;`
  );
}

export function parseRestPlaces(json: { elements?: { tags?: Record<string, string> }[] }): RestPlace | null {
  return bestRestPlace(
    (json.elements ?? []).map((e) => {
      const t = e.tags ?? {};
      const kind = restKindOfTags(t);
      if (!kind) return null;
      const name = (t['name:en'] || t.name || t.brand || '').trim();
      return { kind, ...(name ? { name } : {}) };
    }),
  );
}

/* ------------------------------------------------------------------ looking it up */

export interface RestSources {
  /** What the map draws under and around the car. */
  map: (p: LngLat) => MapFeatureLite[];
  /** The downloaded places close by (petrol stations, rest areas, car parks), when there are any. */
  places?: (p: LngLat) => Promise<RestPlace | null>;
  /** An Overpass query's answer, when online. */
  overpass?: (query: string, signal: AbortSignal) => Promise<{ elements?: { tags?: Record<string, string> }[] }>;
}

/** How long a look at one spot stands (ms), and how far it reaches (m). */
const LOOK_FOR = 5 * 60_000;
const LOOK_NEAR = 40;
const LOOK_TIMEOUT = 7000;

/**
 * What is where the car is: one look per spot (the map at once, then the downloaded places and
 * OpenStreetMap, a few seconds at most), kept for a few minutes.
 */
export class RestPlaceFinder {
  private look: { at: LngLat; time: number; place: RestPlace | null; done: boolean } | null = null;
  private seq = 0;

  constructor(private src: RestSources) {}

  reset() {
    this.look = null;
    this.seq++;
  }

  /** The place at p: a place, nothing there (null), or not known (yet). */
  at(p: LngLat): RestPlace | null | undefined {
    const l = this.look;
    if (!l || haversine(l.at, p) > LOOK_NEAR + 20) return undefined;
    if (l.place || l.done) return l.place;
    return undefined;
  }

  /** Looks at p, unless it was looked at lately. */
  lookAt(p: LngLat, now: number): Promise<RestPlace | null> {
    const l = this.look;
    if (l && haversine(l.at, p) <= LOOK_NEAR && now - l.time < LOOK_FOR) return Promise.resolve(l.place);
    const token = ++this.seq;
    let fromMap: RestPlace | null = null;
    try {
      fromMap = restPlaceFromFeatures(this.src.map(p));
    } catch {
      /* the map is not ready */
    }
    const look = { at: p, time: now, place: fromMap, done: false };
    this.look = look;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), LOOK_TIMEOUT);
    const quiet = <T>(pr: Promise<T> | undefined): Promise<T | null> => (pr ? pr.catch(() => null) : Promise.resolve(null));
    const overpass = this.src.overpass ? quiet(this.src.overpass(restQuery(p), ctl.signal).then(parseRestPlaces)) : Promise.resolve(null);
    const places = quiet(this.src.places?.(p));
    const timeout = new Promise<null>((ok) => ctl.signal.addEventListener('abort', () => ok(null)));
    return Promise.all([Promise.race([places, timeout]), Promise.race([overpass, timeout])]).then(([a, b]) => {
      clearTimeout(timer);
      const place = bestRestPlace([fromMap, a, b]);
      if (token === this.seq) {
        look.place = place;
        look.done = true;
      }
      return place;
    });
  }
}
