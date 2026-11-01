import type { LngLat } from '../geo/geo';

export interface OsmNode {
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export interface OsmWay {
  id: number;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
  tags: Record<string, string>;
}

/** Road ways near junctions plus tagged nodes (motorway_junction carries exit number/name). */
export interface OsmData {
  ways: OsmWay[];
  nodes: OsmNode[];
}

export interface JunctionDataProvider {
  readonly name: string;
  fetch(points: LngLat[], signal?: AbortSignal): Promise<OsmData>;
}

const ROAD_RE =
  '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$';

/**
 * Main roads (tertiary and up, with their ramps) and every bridge and tunnel are fetched this far
 * out, beyond the other roads: the flyovers around a junction stand up in its view, and their
 * heights come out right only when the roads they cross are known too.
 */
export const STRUCTURE_RADIUS = 900;
const MAIN_RE = '^(motorway|trunk|primary|secondary|tertiary)(_link)?$';

export function buildOverpassQuery(points: LngLat[], radius: number, structRadius = Math.max(radius, STRUCTURE_RADIUS)): string {
  const ways = points
    .map((p) => {
      const ll = `${p[1].toFixed(6)},${p[0].toFixed(6)}`;
      const near = `way(around:${radius},${ll})["highway"~"${ROAD_RE}"];`;
      if (structRadius <= radius) return near;
      const far = `way(around:${structRadius},${ll})["highway"~"${ROAD_RE}"]`;
      const main = `way(around:${structRadius},${ll})["highway"~"${MAIN_RE}"];`;
      return [near, main, `${far}["bridge"]["bridge"!="no"];`, `${far}["tunnel"]["tunnel"!="no"];`, `${far}["layer"~"^-?[1-9]"];`].join('\n');
    })
    .join('\n');
  const nodes = points
    .map((p) => `node(around:${radius + 100},${p[1].toFixed(6)},${p[0].toFixed(6)})["highway"="motorway_junction"];`)
    .join('\n');
  return `[out:json][timeout:25];\n(\n${ways}\n);\nout body geom;\n(\n${nodes}\n);\nout body;`;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

export function parseOverpass(json: { elements: OverpassElement[] }): OsmData {
  const ways: OsmWay[] = [];
  const nodes: OsmNode[] = [];
  for (const el of json.elements || []) {
    if (el.type === 'way' && el.nodes && el.geometry && el.geometry.length === el.nodes.length) {
      ways.push({ id: el.id, nodes: el.nodes, geometry: el.geometry, tags: el.tags || {} });
    } else if (el.type === 'node' && el.lat != null && el.lon != null) {
      nodes.push({ id: el.id, lat: el.lat, lon: el.lon, tags: el.tags });
    }
  }
  return { ways, nodes };
}

export class OverpassProvider implements JunctionDataProvider {
  readonly name = 'Overpass';
  constructor(
    private endpoints: string[],
    private radius = 450,
  ) {}

  async fetch(points: LngLat[], signal?: AbortSignal): Promise<OsmData> {
    const query = buildOverpassQuery(points, this.radius);
    let lastErr: unknown;
    for (const url of this.endpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal,
        });
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        return parseOverpass(await res.json());
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Overpass unavailable');
  }
}

/** Batches and caches junction detail requests so a long route costs a handful of queries. */
export class JunctionDataCache {
  private cache = new Map<string, Promise<OsmData | null>>();
  private failedAt = new Map<string, number>();
  constructor(
    public provider: JunctionDataProvider,
    private batchSize = 6,
  ) {}

  static key(p: LngLat): string {
    return `${p[1].toFixed(4)},${p[0].toFixed(4)}`;
  }

  get(p: LngLat): Promise<OsmData | null> {
    const k = JunctionDataCache.key(p);
    const hit = this.cache.get(k);
    if (hit) return hit;
    this.prefetch([p]);
    return this.cache.get(k)!;
  }

  peek(p: LngLat): Promise<OsmData | null> | undefined {
    return this.cache.get(JunctionDataCache.key(p));
  }

  /** Start fetching any points not yet cached, a batch per request. */
  prefetch(points: LngLat[]): void {
    const now = Date.now();
    const todo = points.filter((p) => {
      const k = JunctionDataCache.key(p);
      const failed = this.failedAt.get(k);
      if (failed != null && now - failed > 60_000) {
        this.failedAt.delete(k);
        this.cache.delete(k);
      }
      return !this.cache.has(k);
    });
    for (let i = 0; i < todo.length; i += this.batchSize) {
      const batch = todo.slice(i, i + this.batchSize);
      const req = this.provider.fetch(batch).catch((e) => {
        console.warn('[junction] detail fetch failed, using schematic view', e);
        return null;
      });
      for (const p of batch) this.cache.set(JunctionDataCache.key(p), req);
      // Failed lookups are retried after a minute.
      req.then((d) => {
        if (!d) for (const p of batch) this.failedAt.set(JunctionDataCache.key(p), Date.now());
      });
    }
  }

  clear(): void {
    this.cache.clear();
    this.failedAt.clear();
  }
}
