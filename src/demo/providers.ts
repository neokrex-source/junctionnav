/** Offline stand-ins for the router, junction-detail, place-search and category services. */
import { haversine, type LngLat } from '../geo/geo';
import type { JunctionDataProvider, OsmData } from '../junction/osmdata';
import { labelRoutes, normalizeOsrm, type OsrmResponse, type OsrmRoute, type OsrmStep } from '../routing/osrm';
import type { Route, RouteRequest, RouteResult, Router } from '../routing/types';
import type { Category, PoiProvider, RawPoi } from '../search/categories';
import { parseCoordinates, type Place, type PlaceSearchEngine } from '../search/places';
import { buildDemo } from './network';
import { buildDemoSurroundings } from './surroundings';
import type { SurroundData, SurroundingsProvider } from '../junction/surroundings';
import type { OsmWay } from '../junction/osmdata';
import type { TunnelProvider } from '../nav/tunnels';

/** Tunnel ways from the demo network, as Overpass would return them near the route. */
export class DemoTunnelProvider implements TunnelProvider {
  readonly name = 'Demo';
  async fetch(): Promise<OsmWay[]> {
    return buildDemo().osm.ways.filter((w) => w.tags.tunnel && w.tags.tunnel !== 'no');
  }
}

/**
 * Routes along the demo road: start, stops and destination are snapped onto it and the
 * stretch between them is cut out, with the original maneuvers, lanes and signs kept.
 */
export class DemoRouter implements Router {
  readonly name = 'Demo';
  async route(req: RouteRequest): Promise<RouteResult> {
    const demo = buildDemo();
    const base = normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];
    const line = base.line;
    const L = line.length;
    const warnings: string[] = [];
    const pts = [req.origin, ...(req.via ?? []), req.destination];
    const proj = pts.map((p) => line.project(p));
    if (proj.some((p) => p.dist > 150)) warnings.push('This preview only has the demo roads, so the trip goes to the nearest point on them.');
    const ss = proj.map((p) => p.s);
    const last = ss.length - 1;
    if (ss[0] < 40) ss[0] = 0;
    if (ss[last] > L - 40) ss[last] = L;
    if (ss[last] < ss[0] + 80) {
      ss[0] = 0;
      if (ss[last] < 80) ss[last] = L;
      warnings.push('The demo road runs one way, so this trip starts from the beginning of it.');
    }
    const keep = [ss[0]];
    let dropped = false;
    for (let i = 1; i < last; i++) {
      if (ss[i] > keep[keep.length - 1] + 40 && ss[i] < ss[last] - 40) keep.push(ss[i]);
      else dropped = true;
    }
    keep.push(ss[last]);
    if (dropped) warnings.push('Stops that are not ahead on the demo road were skipped.');
    if (req.avoid?.tolls || req.avoid?.motorways) warnings.push('The demo network has a single route, and it uses tolled expressways.');
    const whole = keep.length === 2 && keep[0] === 0 && keep[1] === L;
    const json = whole ? structuredClone(demo.osrm) : sliceDemo(demo.osrm, base, keep);
    const routes = normalizeOsrm(json, 'Demo');
    labelRoutes(routes);
    return { routes, warnings };
  }
}

function sliceDemo(json: OsrmResponse, base: Route, ss: number[]): OsrmResponse {
  const src = json.routes![0];
  const srcSteps = src.legs[0].steps;
  const line = base.line;
  const sOf = (i: number) => base.steps[i].s;
  const speedOf = (i: number) => (srcSteps[i].duration > 0 ? srcSteps[i].distance / srcSteps[i].duration : 15);
  const containing = (s: number) => {
    let k = 0;
    for (let i = 0; i < srcSteps.length - 1; i++) if (sOf(i) <= s + 0.5) k = i;
    return k;
  };
  const make = (type: 'depart' | 'arrive', s: number, from: number): OsrmStep => {
    const st = srcSteps[from];
    const loc = line.pointAt(s);
    const b = Math.round(line.bearingAt(Math.max(0, s - 5), 10));
    return {
      distance: 0,
      duration: 0,
      name: st.name,
      ref: st.ref,
      mode: 'driving',
      driving_side: st.driving_side,
      maneuver: { type, location: loc, bearing_before: type === 'arrive' ? b : 0, bearing_after: type === 'depart' ? b : 0 },
      intersections: [
        {
          location: loc,
          bearings: [type === 'arrive' ? (b + 180) % 360 : b],
          entry: [true],
          in: type === 'arrive' ? 0 : undefined,
          out: type === 'depart' ? 0 : undefined,
          classes: st.intersections[0]?.classes,
        },
      ],
    };
  };
  const legs: OsrmRoute['legs'] = [];
  for (let k = 0; k < ss.length - 1; k++) {
    const a = ss[k];
    const b = ss[k + 1];
    const items: { s: number; step: OsrmStep; src: number }[] = [{ s: a, step: make('depart', a, containing(a)), src: containing(a) }];
    srcSteps.forEach((st, i) => {
      const tp = st.maneuver.type;
      if (tp === 'depart' || tp === 'arrive') return;
      if (sOf(i) > a + 5 && sOf(i) < b - 5) items.push({ s: sOf(i), step: structuredClone(st), src: i });
    });
    items.push({ s: b, step: make('arrive', b, containing(b)), src: containing(b) });
    items.forEach((it, j) => {
      const next = items[j + 1];
      const d = next ? next.s - it.s : 0;
      it.step.distance = d;
      it.step.duration = d / speedOf(it.src);
    });
    legs.push({ steps: items.map((i) => i.step), summary: src.legs[0].summary, distance: b - a, duration: items.reduce((x, i) => x + i.step.duration, 0) });
  }
  return {
    code: 'Ok',
    routes: [
      {
        distance: ss[ss.length - 1] - ss[0],
        duration: legs.reduce((x, l) => x + l.duration, 0),
        geometry: { type: 'LineString', coordinates: line.slice(ss[0], ss[ss.length - 1]) },
        legs,
      },
    ],
  };
}

export class DemoJunctionProvider implements JunctionDataProvider {
  readonly name = 'Demo';
  async fetch(): Promise<OsmData> {
    return buildDemo().osm;
  }
}

export class DemoSurroundProvider implements SurroundingsProvider {
  async fetch(): Promise<SurroundData> {
    const base = buildDemoSurroundings();
    const extra = buildDemo().pois.filter((p) => ['fuel', 'ev', 'rest'].includes(p.cat)).map((p) => ({ id: p.id, tags: p.tags, lat: p.lngLat[1], lon: p.lngLat[0] }));
    const names = new Set(base.pois.map((p) => p.tags.name));
    return { ...base, pois: [...base.pois, ...extra.filter((p) => !names.has(p.tags.name))] };
  }
}

export class DemoPoiProvider implements PoiProvider {
  async query(cat: Category, points: LngLat[], radius: number): Promise<RawPoi[]> {
    return buildDemo()
      .pois.filter((p) => p.cat === cat.id)
      .filter((p) => points.some((q) => haversine(p.lngLat, q) <= radius + (points.length === 1 ? 4000 : 0)))
      .map((p) => ({ id: p.id, lngLat: p.lngLat, tags: p.tags }));
  }
}

const CAT_SUB: Record<string, string> = {
  fuel: 'Petrol station',
  ev: 'EV charging',
  parking: 'Parking',
  food: 'Food',
  rest: 'Rest area (R&R)',
  store: 'Convenience store',
};

/** Searches the named places and points of interest of the demo network. */
export class DemoPlaceSearch implements PlaceSearchEngine {
  private all(): Place[] {
    const d = buildDemo();
    return [
      ...d.spots.map((s) => ({ name: s.name, sub: s.sub, lngLat: s.lngLat })),
      ...d.pois.map((p) => ({ name: p.tags.name ?? CAT_SUB[p.cat], sub: CAT_SUB[p.cat] ?? '', lngLat: p.lngLat })),
    ];
  }

  async search(q: string, near: LngLat | null): Promise<Place[]> {
    const coord = parseCoordinates(q);
    if (coord) return [{ name: `${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`, sub: 'Coordinates', lngLat: coord }];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = this.all().filter((p) => {
      const hay = `${p.name} ${p.sub}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    if (near) hits.sort((a, b) => haversine(near, a.lngLat) - haversine(near, b.lngLat));
    return hits.slice(0, 8);
  }

  async reverse(p: LngLat): Promise<Place | null> {
    let best: Place | null = null;
    let bestD = 150;
    for (const pl of this.all()) {
      const d = haversine(p, pl.lngLat);
      if (d < bestD) {
        bestD = d;
        best = pl;
      }
    }
    return best ? { ...best, name: bestD > 40 ? `Near ${best.name}` : best.name, lngLat: p } : null;
  }
}
