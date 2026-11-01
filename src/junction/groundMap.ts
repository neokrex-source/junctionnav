/**
 * The map under the 3D junction view: a top-down snapshot of the map around a junction (streets,
 * land use, water, building footprints), laid on the ground of the 3D scene so the view shows the
 * same surroundings as the map. Bridges and tunnels are left out of the snapshot because the 3D
 * scene draws them at their real height (a flyover painted flat on the ground under its own deck
 * would read as a second road); labels and icons are left out because they would lie flat.
 *
 * One hidden MapLibre map renders the snapshots, one at a time, with the app's current map style
 * (online or offline), so it works wherever the map works.
 */
import maplibregl, { type LayerSpecification, type StyleSpecification } from 'maplibre-gl';
import type { LngLat, XY } from '../geo/geo';

export interface GroundMap {
  /** Top-down map image, north up, centred on `center`, edges faded out. */
  image: HTMLCanvasElement;
  center: LngLat;
  /** Half the side of the image, metres. */
  half: number;
  /** The plain land colour (the most common one), for the ground beyond the image. */
  land: string;
  /** Is the map green here (park, wood, grass)? Local metres from `center`, east and north. */
  green(p: XY): boolean;
}

export interface GroundSource {
  style: string | StyleSpecification;
  /** Changes when the style does (online/offline, day/night, another map style). */
  key: string;
}

/** The snapshot covers this far around the junction (the 3D roads reach 900 m). */
export const GROUND_HALF = 900;
/** CSS pixels of the hidden map; with PIXEL_RATIO 1.5 the image is 1536 px, about 1.2 m a pixel. */
const SIZE = 1024;
const PIXEL_RATIO = 1.5;
const CACHE = 4;
const MASK = 128;
const FADE = 0.12;

/* ------------------------------------------------------------------ style */

const OFF_GROUND = /bridge|tunnel|boundar/i;

/** A fill-extrusion layer as a flat fill (building footprints seen from above). */
function flatFill(l: LayerSpecification): LayerSpecification {
  const src = l as LayerSpecification & { source: string; 'source-layer'?: string; filter?: unknown; minzoom?: number; maxzoom?: number; paint?: Record<string, unknown>; layout?: Record<string, unknown> };
  const out: Record<string, unknown> = {
    id: src.id,
    type: 'fill',
    source: src.source,
    paint: { 'fill-color': src.paint?.['fill-extrusion-color'] ?? '#d9d3cc', 'fill-opacity': 1 },
  };
  if (src['source-layer'] != null) out['source-layer'] = src['source-layer'];
  if (src.filter != null) out.filter = src.filter;
  if (src.minzoom != null) out.minzoom = src.minzoom;
  if (src.maxzoom != null) out.maxzoom = src.maxzoom;
  if (src.layout?.visibility) out.layout = { visibility: src.layout.visibility };
  return out as unknown as LayerSpecification;
}

/**
 * The ground-level part of a map style: land use, water, buildings and streets. Drops labels,
 * icons, hillshading, boundaries, and bridge and tunnel layers (by layer id, which covers the
 * Protomaps and OpenMapTiles styles; GeoJSON sources such as the demo roads by their tags).
 */
export function groundLayers(style: StyleSpecification): StyleSpecification {
  const geojson = new Set(Object.entries(style.sources ?? {}).filter(([, s]) => s.type === 'geojson').map(([k]) => k));
  const layers: LayerSpecification[] = [];
  for (const l of style.layers ?? []) {
    if (l.type === 'symbol' || l.type === 'heatmap' || l.type === 'hillshade' || OFF_GROUND.test(l.id)) continue;
    if (l.type === 'fill-extrusion') {
      layers.push(flatFill(l));
      continue;
    }
    const src = (l as { source?: string }).source;
    if (l.type === 'line' && src && geojson.has(src)) {
      const flat = ['all', ['!=', ['coalesce', ['get', 'bridge'], 'no'], 'yes'], ['!=', ['coalesce', ['get', 'tunnel'], 'no'], 'yes']];
      const f = (l as { filter?: unknown }).filter;
      layers.push({ ...l, filter: (f ? ['all', f, flat] : flat) as never });
      continue;
    }
    layers.push(l);
  }
  const out: StyleSpecification = { ...style, layers };
  delete out.terrain;
  delete out.sky;
  delete (out as { projection?: unknown }).projection;
  return out;
}

/* ------------------------------------------------------------------ image analysis */

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Greenish (parks, woods, grass) in either the day or the night style. */
export function isGreen(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 14 || g !== max) return false;
  const hue = (60 * ((b - r) / (max - min)) + 120 + 360) % 360;
  return hue >= 70 && hue <= 170 && (max - min) / max > 0.1;
}

/**
 * Most common colour and a coarse green mask of an RGBA image, and whether it shows a map at all
 * (not blank, not one flat colour, as when the tiles did not load).
 */
export function analyse(rgba: Uint8ClampedArray, n: number): { land: string; mask: Uint8Array; usable: boolean } {
  const counts = new Map<number, number>();
  const mask = new Uint8Array(n * n);
  let clear = 0;
  for (let i = 0; i < n * n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    if (rgba[i * 4 + 3] < 128) {
      clear++;
      continue;
    }
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (isGreen(r, g, b)) mask[i] = 1;
  }
  let best = 0;
  let bestN = -1;
  for (const [k, c] of counts) if (c > bestN) [best, bestN] = [k, c];
  const usable = clear < (n * n) / 2 && bestN < (n * n - clear) * 0.97;
  return { land: hex(((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4), mask, usable };
}

/** Day maps (light land): a gamma curve that darkens the land and keeps streets light. Night maps stay. */
export function toneDay(rgba: Uint8ClampedArray): void {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4 * 97) {
    sum += rgba[i] * 0.3 + rgba[i + 1] * 0.59 + rgba[i + 2] * 0.11;
    n++;
  }
  if (!n || sum / n < 140) return;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(240 * Math.pow(v / 255, 1.7));
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = lut[rgba[i]];
    rgba[i + 1] = lut[rgba[i + 1]];
    rgba[i + 2] = lut[rgba[i + 2]];
  }
}

/* ------------------------------------------------------------------ snapshots */

function metresPerPixelZoom(lat: number, mpp: number): number {
  return Math.log2((40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * mpp));
}

function idle(map: maplibregl.Map, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeout);
    map.once('idle', finish);
    map.triggerRepaint();
  });
}

export class GroundMapper {
  private map: maplibregl.Map | null = null;
  private el: HTMLElement | null = null;
  private styleKey = '';
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, Promise<GroundMap | null>>();
  private broken = false;

  constructor(private source: () => GroundSource | null) {}

  static key(p: LngLat, styleKey: string): string {
    return `${p[0].toFixed(5)},${p[1].toFixed(5)}|${styleKey}`;
  }

  /** The current style key (for cache keys). */
  currentKey(): string {
    return this.source()?.key ?? '';
  }

  /** Snapshot of the map around `center` (cached; one renders at a time). */
  snapshot(center: LngLat): Promise<GroundMap | null> {
    const src = this.source();
    if (!src || this.broken) return Promise.resolve(null);
    const key = GroundMapper.key(center, src.key);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const job = this.queue.then(() => this.render(center, src)).catch((err) => {
      console.warn('[ground map] snapshot failed', err);
      return null;
    });
    this.queue = job;
    this.cache.set(key, job);
    while (this.cache.size > CACHE) this.cache.delete(this.cache.keys().next().value!);
    return job;
  }

  /** Forget snapshots (the map style changed). */
  reset() {
    this.cache.clear();
  }

  private ensure(src: GroundSource): maplibregl.Map | null {
    if (!this.map) {
      try {
        const el = document.createElement('div');
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText = `position:fixed;left:${-SIZE - 200}px;top:0;width:${SIZE}px;height:${SIZE}px;pointer-events:none;overflow:hidden`;
        document.body.append(el);
        this.el = el;
        this.map = new maplibregl.Map({
          container: el,
          style: { version: 8, sources: {}, layers: [] },
          interactive: false,
          attributionControl: false,
          pixelRatio: PIXEL_RATIO,
          fadeDuration: 0,
          canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
        });
      } catch (err) {
        console.warn('[ground map] unavailable', err);
        this.broken = true;
        this.el?.remove();
        return null;
      }
    }
    if (this.styleKey !== src.key) {
      this.styleKey = src.key;
      this.map.setStyle(src.style, { diff: false, transformStyle: (_prev, next) => groundLayers(next) });
    }
    return this.map;
  }

  private async render(center: LngLat, src: GroundSource): Promise<GroundMap | null> {
    const map = this.ensure(src);
    if (!map) return null;
    const half = GROUND_HALF;
    map.jumpTo({ center, zoom: metresPerPixelZoom(center[1], (2 * half) / SIZE), bearing: 0, pitch: 0 });
    await idle(map, 12_000);
    const gl = map.getCanvas();
    if (!gl.width || !gl.height) return null;
    const image = document.createElement('canvas');
    image.width = gl.width;
    image.height = gl.height;
    const ctx = image.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(gl, 0, 0);

    // A little more contrast for day maps, which are pale for reading labels: seen along the
    // ground at a low angle they wash out, and the streets should stand out from the land.
    const px = ctx.getImageData(0, 0, image.width, image.height);
    toneDay(px.data);
    ctx.putImageData(px, 0, 0);

    // Plain land colour and where it is green, from a small copy.
    const small = document.createElement('canvas');
    small.width = small.height = MASK;
    const sctx = small.getContext('2d', { willReadFrequently: true })!;
    sctx.drawImage(image, 0, 0, MASK, MASK);
    const { land, mask, usable } = analyse(sctx.getImageData(0, 0, MASK, MASK).data, MASK);
    // Blank or a single colour (tiles missing): keep the usual ground instead.
    if (!usable) return null;

    // Fade the edges out so the image melts into the plain ground beyond it.
    const w = image.width;
    const h = image.height;
    ctx.globalCompositeOperation = 'destination-out';
    const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(rx, ry, rw, rh);
    };
    const fw = w * FADE;
    const fh = h * FADE;
    edge(0, 0, fw, 0, 0, 0, fw, h);
    edge(w, 0, w - fw, 0, w - fw, 0, fw, h);
    edge(0, 0, 0, fh, 0, 0, w, fh);
    edge(0, h, 0, h - fh, 0, h - fh, w, fh);
    ctx.globalCompositeOperation = 'source-over';

    return {
      image,
      center,
      half,
      land,
      green: ([x, y]) => {
        const i = Math.floor(((x + half) / (2 * half)) * MASK);
        const j = Math.floor(((half - y) / (2 * half)) * MASK);
        return i >= 0 && j >= 0 && i < MASK && j < MASK && mask[j * MASK + i] === 1;
      },
    };
  }

  destroy() {
    this.map?.remove();
    this.el?.remove();
    this.map = null;
    this.cache.clear();
  }
}
