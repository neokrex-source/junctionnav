import type { LngLat } from '../geo/geo';

export type IncidentKind = 'accident' | 'jam' | 'closure' | 'laneClosed' | 'roadworks' | 'flooding' | 'weather' | 'hazard' | 'breakdown' | 'other';
export type Magnitude = 'unknown' | 'minor' | 'moderate' | 'major' | 'undefined';

/** A live traffic incident (TomTom), as the app uses it. */
export interface Incident {
  id: string;
  kind: IncidentKind;
  magnitude: Magnitude;
  /** Extra time against free flow, seconds (0 for closures and when unknown). */
  delay: number;
  /** Length of the affected stretch, metres. */
  length: number;
  description: string;
  from?: string;
  to?: string;
  roads: string[];
  /** The stretch in the direction of traffic, or a single point. */
  geometry: LngLat[];
}

/** An incident on the route being driven. */
export interface RouteIncident extends Incident {
  /** Where it starts and ends along the route (metres). */
  s: number;
  endS: number;
}

/** Travel time with live traffic for the rest of a route (TomTom routing along it). */
export interface TrafficEta {
  /** Seconds to the destination with traffic, from where the car was when asked. */
  travelTime: number;
  /** Of that, seconds lost to traffic. */
  delay: number;
  /** Route position (metres) and time (ms) of the answer. */
  fromS: number;
  at: number;
  /** The route's own time for the same stretch (no traffic), seconds, to carry the answer forward as the car drives. */
  base: number;
}

export type NewsKind = 'accident' | 'jam' | 'closure' | 'flood' | 'roadworks' | 'other';

/** A traffic headline from the news feed (scripts/traffic/news.mjs). */
export interface NewsItem {
  title: string;
  link: string;
  source: string;
  /** ISO time. */
  published: string;
  /** Roads it names (keys of HIGHWAYS in roads.ts). */
  roads: string[];
  kind: NewsKind;
}

export interface NewsFeed {
  updated: string;
  items: NewsItem[];
}
