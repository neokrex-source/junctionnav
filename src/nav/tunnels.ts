/**
 * Tunnels along a route: where they start and end (from the router's "tunnel" road class and
 * from OSM tunnel ways matched onto the route), their names and lengths, and what the driver
 * should see at a given position.
 */
import { angleDiff, bearing, haversine, LocalFrame, type LngLat } from '../geo/geo';
import { parseOverpass, type OsmWay } from '../junction/osmdata';
import type { Route } from '../routing/types';

export interface TunnelSpan {
  /** Stable within one route. */
  id: string;
  fromS: number;
  toS: number;
  length: number;
  entrance: LngLat;
  /** Name in the local language (tunnel:name, or a tunnel-like name). */
  name: string | null;
  /** Names by language code from tunnel:name:xx / name:xx. */
  names: Record<string, string>;
  /** OSM highway class when known, else 'motorway' when the router flags the road as one. */
  highway: string | null;
  source: 'router' | 'osm';
}

/** Shorter tunnels (mostly underpasses below a junction) get no sign or voice prompt. */
export const TUNNEL_MIN_SIGN = 150;
export const TUNNEL_MIN_VOICE = 250;

export interface TunnelState {
  span: TunnelSpan;
  phase: 'ahead' | 'inside';
  /** Distance to the entrance (0 inside). */
  dist: number;
  /** Distance to the exit. */
  toExit: number;
  /** 0..1 through the tunnel. */
  progress: number;
}

const TUNNEL_WORD = /tunnel|terowong|トンネル|隧道|túnel|tunel|galleria|tunneli|tunnelen|terusan/i;

export function tunnelName(span: TunnelSpan, lang: string): string | null {
  return span.names[lang] ?? span.name;
}

export function isMajor(span: TunnelSpan): boolean {
  return span.length >= TUNNEL_MIN_SIGN;
}

/** Expressway-style sign colours for tunnels on motorways (and trunk roads outside Malaysia). */
export function onExpressway(span: TunnelSpan): boolean {
  return span.highway === 'motorway' || span.highway === 'motorway_link';
}

/* ------------------------------------------------------------------ from the router */

/**
 * Tunnel stretches from OSRM's intersection classes: an intersection lists the classes of the
 * road it leads onto, so a stretch runs from one flagged intersection to the next unflagged one.
 */
export function tunnelsFromRoute(route: Route): TunnelSpan[] {
  const line = route.line;
  const marks: { s: number; tunnel: boolean; motorway: boolean; at: LngLat }[] = [];
  route.steps.forEach((st, k) => {
    const next = route.steps[k + 1];
    const s1 = next ? next.s : line.length;
    st.intersections.forEach((ix, i) => {
      const s = i === 0 ? st.s : line.project(ix.location, Math.max(0, st.s - 5), s1 + 5).s;
      const cls = ix.classes ?? [];
      marks.push({ s, tunnel: cls.includes('tunnel'), motorway: cls.includes('motorway'), at: ix.location });
    });
  });
  marks.sort((a, b) => a.s - b.s);
  const out: TunnelSpan[] = [];
  let open: (typeof marks)[number] | null = null;
  for (const m of marks) {
    if (m.tunnel && !open) open = m;
    else if (!m.tunnel && open) {
      push(open, m.s);
      open = null;
    }
  }
  if (open) push(open, line.length);
  return out;

  function push(start: (typeof marks)[number], end: number) {
    if (end - start.s < 10) return;
    out.push({
      id: `r${Math.round(start.s)}`,
      fromS: start.s,
      toS: end,
      length: end - start.s,
      entrance: start.at,
      name: null,
      names: {},
      highway: start.motorway ? 'motorway' : null,
      source: 'router',
    });
  }
}

/* ------------------------------------------------------------------ from OSM */

function namesFrom(t: Record<string, string>): { name: string | null; names: Record<string, string> } {
  const names: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    const m = /^tunnel:name:([a-z]{2})$/.exec(k);
    if (m) names[m[1]] = v;
  }
  let name = t['tunnel:name'] ?? null;
  if (!name && t.name && TUNNEL_WORD.test(t.name)) {
    name = t.name;
    for (const [k, v] of Object.entries(t)) {
      const m = /^name:([a-z]{2})$/.exec(k);
      if (m && TUNNEL_WORD.test(v) && !names[m[1]]) names[m[1]] = v;
    }
  }
  return { name, names };
}

function densify(pts: LngLat[], step: number): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const n = Math.max(1, Math.ceil(haversine(a, b) / step));
    for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Matches OSM tunnel ways onto the route. A way counts where a run of its points lies within
 * 14 m of the route and runs the same way (a one-way tube in the other direction is skipped).
 */
export function matchTunnelWays(route: Route, ways: OsmWay[], range: [number, number] = [0, Infinity]): TunnelSpan[] {
  const line = route.line;
  const found: (TunnelSpan & { weight: number })[] = [];
  for (const w of ways) {
    const t = w.tags;
    if (!t.highway || !t.tunnel || t.tunnel === 'no' || w.geometry.length < 2) continue;
    let pts = densify(
      w.geometry.map((g) => [g.lon, g.lat] as LngLat),
      20,
    );
    if (t.oneway === '-1') pts = pts.reverse();
    const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1' || t.highway === 'motorway' || t.junction === 'roundabout';
    const first = line.project(pts[0], range[0] - 400, range[1] + 400);
    const span = haversine(pts[0], pts[pts.length - 1]) + 300;
    const lo = Math.max(0, first.s - span);
    const hi = first.s + span;
    let run: number[] = [];
    let best: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const proj = line.project(p, lo, hi);
      const wb = bearing(i < pts.length - 1 ? p : pts[i - 1], i < pts.length - 1 ? pts[i + 1] : p);
      const d = Math.abs(angleDiff(wb, line.bearingAt(proj.s, 10)));
      const aligned = oneway ? d < 50 : d < 50 || d > 130;
      if (proj.dist <= 14 && aligned) run.push(proj.s);
      else {
        if (run.length > best.length) best = run;
        run = [];
      }
    }
    if (run.length > best.length) best = run;
    if (best.length < 2) continue;
    const fromS = Math.min(...best);
    const toS = Math.max(...best);
    if (toS - fromS < 20 || toS < range[0] - 50 || fromS > range[1] + 50) continue;
    const { name, names } = namesFrom(t);
    found.push({
      id: `o${Math.round(fromS)}`,
      fromS,
      toS,
      length: toS - fromS,
      entrance: line.pointAt(fromS),
      name,
      names,
      highway: t.highway,
      source: 'osm',
      weight: toS - fromS,
    });
  }
  // Consecutive ways inside one tunnel become one stretch; the longest piece names it.
  found.sort((a, b) => a.fromS - b.fromS);
  const merged: (TunnelSpan & { weight: number })[] = [];
  for (const f of found) {
    const last = merged[merged.length - 1];
    if (last && f.fromS <= last.toS + 25) {
      if (f.weight > last.weight || (!last.name && f.name)) {
        last.name = f.name ?? last.name;
        last.names = { ...f.names, ...last.names };
        last.highway = f.highway ?? last.highway;
        last.weight = Math.max(last.weight, f.weight);
      }
      last.toS = Math.max(last.toS, f.toS);
      last.length = last.toS - last.fromS;
    } else merged.push({ ...f });
  }
  return merged.map(({ weight: _w, ...s }) => s);
}

/**
 * Combines router and OSM stretches. OSM gives exact ends and names, so it wins where both
 * cover the same tunnel; router stretches without an OSM match are kept.
 */
export function mergeTunnels(...sets: TunnelSpan[][]): TunnelSpan[] {
  const osm = sets.flat().filter((s) => s.source === 'osm');
  const router = sets.flat().filter((s) => s.source === 'router');
  const out: TunnelSpan[] = [];
  for (const o of osm) {
    if (!out.some((x) => Math.abs(x.fromS - o.fromS) < 15 && Math.abs(x.toS - o.toS) < 15)) out.push(o);
  }
  for (const r of router) {
    const covered = out.some((o) => o.fromS < r.toS - 10 && o.toS > r.fromS + 10);
    if (!covered) out.push(r);
    else {
      // Router knows the road class even when the OSM piece is untagged.
      for (const o of out) if (o.fromS < r.toS && o.toS > r.fromS && !o.highway) o.highway = r.highway;
    }
  }
  return out.sort((a, b) => a.fromS - b.fromS);
}

/* ------------------------------------------------------------------ position */

/** What to show at along-route position s: the tunnel we are in, or the next one within `showDist`. */
export function tunnelStateAt(spans: TunnelSpan[], s: number, showDist: number): TunnelState | null {
  for (const t of spans) {
    if (!isMajor(t)) continue;
    if (s >= t.fromS && s < t.toS) return { span: t, phase: 'inside', dist: 0, toExit: t.toS - s, progress: (s - t.fromS) / t.length };
    if (t.fromS > s && t.fromS - s <= showDist) return { span: t, phase: 'ahead', dist: t.fromS - s, toExit: t.toS - s, progress: 0 };
  }
  return null;
}

/* ------------------------------------------------------------------ providers */

export interface TunnelProvider {
  readonly name: string;
  /** OSM road ways tagged as tunnels near a path. */
  fetch(path: LngLat[], signal?: AbortSignal): Promise<OsmWay[]>;
}

/** Douglas-Peucker in a local metric frame; keeps the Overpass query short. */
export function simplifyPath(pts: LngLat[], tol: number): LngLat[] {
  if (pts.length < 3) return pts.slice();
  const f = new LocalFrame(pts[0]);
  const xy = pts.map((p) => f.toXY(p));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((xy[i][0] - ax) * dy - (xy[i][1] - ay) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function buildTunnelQuery(path: LngLat[], radius = 30): string {
  const coords = path.map((p) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join(',');
  return `[out:json][timeout:25];way(around:${radius},${coords})["highway"]["tunnel"]["tunnel"!="no"];out body geom;`;
}

export class OverpassTunnelProvider implements TunnelProvider {
  readonly name = 'Overpass';
  constructor(private endpoints: () => string[]) {}

  async fetch(path: LngLat[], signal?: AbortSignal): Promise<OsmWay[]> {
    const query = buildTunnelQuery(path);
    let lastErr: unknown;
    for (const url of this.endpoints()) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal,
        });
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        return parseOverpass(await res.json()).ways;
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Overpass unavailable');
  }
}

/**
 * Loads tunnel detail for a route in chunks a little ahead of the driver, merging each
 * chunk into what the router already said. One Overpass query per ~20 km.
 */
export class TunnelLoader {
  static readonly CHUNK = 20000;
  private route: Route | null = null;
  private base: TunnelSpan[] = [];
  private osm: TunnelSpan[] = [];
  private chunks = new Map<number, 'loading' | 'done' | number>();
  private ctrl: AbortController | null = null;

  constructor(
    public provider: TunnelProvider | null,
    private onChange: (spans: TunnelSpan[]) => void,
  ) {}

  get spans(): TunnelSpan[] {
    return mergeTunnels(this.base, this.osm);
  }

  setRoute(route: Route) {
    this.ctrl?.abort();
    this.ctrl = new AbortController();
    this.route = route;
    this.base = tunnelsFromRoute(route);
    this.osm = [];
    this.chunks.clear();
    this.onChange(this.spans);
  }

  /** Make sure the chunk at s and the next one are loaded (or loading). */
  ensure(s: number) {
    const route = this.route;
    if (!route || !this.provider) return;
    const i0 = Math.floor(s / TunnelLoader.CHUNK);
    for (const i of [i0, i0 + 1]) {
      const s0 = i * TunnelLoader.CHUNK;
      if (s0 > route.line.length) continue;
      const st = this.chunks.get(i);
      if (st === 'loading' || st === 'done' || (typeof st === 'number' && Date.now() - st < 60_000)) continue;
      this.chunks.set(i, 'loading');
      const s1 = Math.min(route.line.length, s0 + TunnelLoader.CHUNK);
      const path = simplifyPath(route.line.slice(Math.max(0, s0 - 50), s1 + 50), 6).slice(0, 600);
      const signal = this.ctrl?.signal;
      this.provider
        .fetch(path, signal)
        .then((ways) => {
          if (this.route !== route) return;
          const found = matchTunnelWays(route, ways, [s0, s1]);
          this.osm = [...this.osm.filter((x) => !found.some((f) => f.id === x.id)), ...found];
          this.chunks.set(i, 'done');
          this.onChange(this.spans);
        })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          console.warn('[tunnels] detail fetch failed, using router data', e);
          this.chunks.set(i, Date.now());
        });
    }
  }

  stop() {
    this.ctrl?.abort();
    this.route = null;
  }
}
