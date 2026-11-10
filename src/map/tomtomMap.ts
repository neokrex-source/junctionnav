/**
 * Whether the map can come from TomTom right now ("TomTom first" with a key), and from which of
 * TomTom's two map services: the classic one (`/map/2/tile/basic`) or Orbis
 * (`/maps/orbis/display/vector/tile`). A key is not always set up for both.
 *
 * One tile near you is asked for first. It must come back, and it must have the map layout the
 * style draws (src/map/tomtomStyle.ts); then the map switches to TomTom. If the key is refused,
 * the day's free tiles are used up, TomTom is busy or cannot be reached, or the tiles are not
 * what the style expects, the OpenStreetMap map is shown instead, and TomTom is asked again after
 * a rest (twenty minutes after a refusal, a minute otherwise). The last good answer for the key
 * is kept, so the next start opens on the TomTom map straight away.
 */
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import type { LngLat } from '../geo/geo';
import { TomTomGate } from '../tomtom/gate';
import { TomTomError, TT_BASE } from '../tomtom/http';

export type MapFamily = 'classic' | 'orbis';

export function tomtomTileUrl(f: MapFamily, key: string): string {
  const k = encodeURIComponent(key.trim());
  return f === 'orbis' ? `${TT_BASE}/maps/orbis/display/vector/tile/{z}/{x}/{y}.pbf?apiVersion=2&key=${k}` : `${TT_BASE}/map/2/tile/basic/{z}/{x}/{y}.pbf?key=${k}`;
}

/** A tile address of TomTom's map (as opposed to its traffic tiles). */
export function isTomTomMapTile(url: string): boolean {
  return /api\.tomtom\.com\/(map\/2\/tile\/basic|maps\/orbis\/display\/vector\/tile)\//.test(url);
}

/** Layers of TomTom's map tiles the style draws. */
const LAYERS = ['roads', 'water', 'water_lines', 'land_use', 'land_cover', 'earth_cover', 'buildings', 'boundaries', 'places', 'carto_labels', 'poi_basic'];
const ROAD_CATEGORIES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'street', 'minor', 'path', 'ferry', 'railway']);

/**
 * Whether a tile has the layout the style draws: some of its layers, and roads (if any) in the
 * categories it knows.
 */
export function checkTile(buf: Uint8Array): { ok: boolean; why: string } {
  let vt: VectorTile;
  try {
    vt = new VectorTile(new Pbf(buf));
  } catch {
    return { ok: false, why: 'not a vector tile' };
  }
  const names = Object.keys(vt.layers);
  // TomTom's own layer names ('water' alone is in other layouts too).
  const own = names.filter((n) => LAYERS.includes(n) && n !== 'water');
  if (!names.includes('roads') && own.length < 2) return { ok: false, why: `unknown layers: ${names.slice(0, 6).join(', ') || 'none'}` };
  const roads = vt.layers.roads;
  if (roads && roads.length) {
    let known = 0;
    const n = Math.min(roads.length, 400);
    for (let i = 0; i < n; i++) if (ROAD_CATEGORIES.has(String(roads.feature(i).properties.category ?? ''))) known++;
    if (known < n / 2) return { ok: false, why: 'unknown road categories' };
  }
  return { ok: true, why: '' };
}

function tileAt(p: LngLat, z: number): [number, number] {
  const n = 2 ** z;
  const lat = (Math.max(-85, Math.min(85, p[1])) * Math.PI) / 180;
  return [Math.floor(((p[0] + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n)];
}

/** A short fingerprint of the key, to tell whose answer was kept without keeping the key twice. */
function fingerprint(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const STORE = 'junctionnav.ttmap.v1';
const KEEP = 24 * 3600_000;

interface Kept {
  k: string;
  at: number;
  family?: MapFamily;
  bad?: string;
}

export interface TomTomMapOptions {
  fetch?: typeof fetch;
  /** Where to look for the first tile (the last known position). */
  at?: () => LngLat;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
}

export class TomTomMap {
  /** The map service that answered, or null (not asked yet, or neither). */
  family: MapFamily | null = null;
  /** The tiles were not what the style draws (kept for a day per key). */
  private bad = '';
  readonly gate: TomTomGate;
  /** The map should change (TomTom became usable or stopped being usable). */
  onChange: (() => void) | null = null;
  private checking: Promise<void> | null = null;
  private retry = 0;
  private last: string | null = null;
  private readonly f: typeof fetch;
  private readonly now: () => number;

  constructor(
    private key: () => string,
    private wanted: () => boolean,
    private o: TomTomMapOptions = {},
  ) {
    this.f = o.fetch ?? ((input, init) => fetch(input, init));
    this.now = o.now ?? (() => Date.now());
    this.gate = new TomTomGate(key, wanted, this.now);
  }

  /** The TomTom tile address to draw the map with, or null for the OpenStreetMap map. */
  get tiles(): string | null {
    if (!this.family || this.bad || !this.gate.usable) return null;
    return tomtomTileUrl(this.family, this.key());
  }

  /** Why the map is not from TomTom, in a few words ('' when it is, or when TomTom first is off). */
  get reason(): string {
    if (!this.wanted()) return '';
    if (!this.key().trim()) return 'no TomTom key';
    if (this.bad) return `TomTom's map tiles are not in the expected layout (${this.bad})`;
    if (!this.gate.usable) return this.gate.reason || 'TomTom is resting';
    return this.family ? '' : 'not checked yet';
  }

  private storage() {
    if (this.o.storage !== undefined) return this.o.storage;
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  }

  /**
   * The last answer for this key (a day at most), so the map opens on it at once. `shown`: the
   * map is about to be drawn with what this gives (no change to report then).
   */
  restore(shown = true) {
    const key = this.key().trim();
    if (shown) this.last = null;
    if (!key || !this.wanted()) return;
    try {
      const kept = JSON.parse(this.storage()?.getItem(STORE) ?? 'null') as Kept | null;
      if (!kept || kept.k !== fingerprint(key) || this.now() - kept.at > KEEP) return;
      this.family = kept.family ?? null;
      this.bad = kept.bad ?? '';
    } catch {
      /* nothing kept */
    }
    if (shown) this.last = this.tiles;
  }

  private keep(v: Omit<Kept, 'k' | 'at'>) {
    try {
      this.storage()?.setItem(STORE, JSON.stringify({ k: fingerprint(this.key().trim()), at: this.now(), ...v }));
    } catch {
      /* storage full or blocked */
    }
  }

  /** Tells the app when the tile address changed. */
  private changed() {
    const t = this.tiles;
    if (t === this.last) return;
    this.last = t;
    this.onChange?.();
  }

  /** A new key or setting: forget what was found out and ask again. */
  reset() {
    this.family = null;
    this.bad = '';
    this.gate.reset();
    this.restore(false);
    void this.check();
  }

  /** Asks TomTom for one map tile near you (the classic service, else Orbis). */
  check(): Promise<void> {
    this.checking ??= this.probe().finally(() => (this.checking = null));
    return this.checking;
  }

  private async probe() {
    const key = this.key().trim();
    if (!this.wanted() || !key) {
      this.changed();
      return;
    }
    const [x, y] = tileAt(this.o.at?.() ?? [101.6869, 3.139], 12);
    const order: MapFamily[] = this.family === 'orbis' ? ['orbis', 'classic'] : ['classic', 'orbis'];
    let lastErr: unknown = null;
    for (const fam of order) {
      try {
        const res = await this.f(tomtomTileUrl(fam, key).replace('{z}', '12').replace('{x}', String(x)).replace('{y}', String(y)));
        if (!res.ok) {
          lastErr = new TomTomError(`TomTom map tiles: ${res.status}`, res.status);
          // A family the key is not set up for: try the other one.
          if (res.status === 403 || res.status === 404 || res.status === 405) continue;
          break;
        }
        const check = checkTile(new Uint8Array(await res.arrayBuffer()));
        if (!check.ok) {
          console.warn('[map] TomTom map tiles not in the expected layout:', check.why);
          this.bad = check.why;
          this.family = null;
          this.keep({ bad: check.why });
          this.changed();
          return;
        }
        this.family = fam;
        this.bad = '';
        this.gate.ok();
        this.keep({ family: fam });
        this.changed();
        return;
      } catch (err) {
        lastErr = err;
        break;
      }
    }
    this.family = null;
    this.failed(lastErr instanceof TomTomError ? lastErr.status : 0);
  }

  /**
   * A TomTom map tile failed (from the probe or while drawing): rest TomTom's map for a while and
   * show the OpenStreetMap map; ask again when the rest is over.
   */
  failed(status: number) {
    if (status === 400 || status === 404) return;
    this.gate.fail(new TomTomError('TomTom map tiles', status));
    this.changed();
    clearTimeout(this.retry);
    const rest = status === 401 || status === 403 ? 20 * 60_000 : 60_000;
    this.retry = setTimeout(() => void this.check(), rest + 500) as unknown as number;
  }
}
