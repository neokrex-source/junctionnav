/**
 * The junction views' colours in the other looks. Their own palettes (render3d.ts, zoom3d.ts,
 * surroundRender.ts) are the JunctionNav ones: greys with a purple cast under a lavender or plum
 * sky. For Fighter jet and Casual the purple cast is turned to the look's own (green; warm cream
 * by day and navy by night), leaving greens, oranges, black and white as they are, and the sky,
 * fog and a few others are set outright.
 */
import { themeId, type ThemeId } from './palette';

function toHsl(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function toHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const v = (u: number) => Math.round(Math.max(0, Math.min(1, u + m)) * 255).toString(16).padStart(2, '0');
  return `#${v(r)}${v(g)}${v(b)}`;
}

/** A colour with a purple cast (hue 235° to 320°) turned to `hue`, its saturation scaled; others unchanged. */
export function retint(hex: string, hue: number, sat = 1): string {
  const hsl = toHsl(hex);
  if (!hsl || hsl[1] < 0.02 || hsl[0] < 235 || hsl[0] > 320) return hex;
  return toHex(hue, Math.min(1, hsl[1] * sat), hsl[2]);
}

function deep<T>(v: T, hue: number, sat: number): T {
  if (typeof v === 'string') return retint(v, hue, sat) as T;
  if (Array.isArray(v)) return v.map((x) => deep(x, hue, sat)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, hue, sat)])) as T;
  return v;
}

/** The cast of each look, by day and night: hue and how much of the saturation stays. */
const CAST: Record<Exclude<ThemeId, 'junction'>, { day: [number, number]; night: [number, number] }> = {
  jet: { day: [135, 0.5], night: [145, 0.9] },
  casual: { day: [32, 0.9], night: [228, 0.85] },
};

const cache = new WeakMap<object, Map<string, unknown>>();

/**
 * `base` (a JunctionNav palette) in the current look: itself for JunctionNav, else with its
 * purple cast turned and `set[look]` laid over it. The same object each time for one base.
 */
export function inTheme<T extends object>(base: T, night: boolean, set: Partial<Record<Exclude<ThemeId, 'junction'>, Partial<T>>> = {}): T {
  const id = themeId();
  if (id === 'junction') return base;
  let per = cache.get(base);
  if (!per) cache.set(base, (per = new Map()));
  const hit = per.get(id) as T | undefined;
  if (hit) return hit;
  const [hue, sat] = night ? CAST[id].night : CAST[id].day;
  const out = { ...deep(base, hue, sat), ...(set[id] ?? {}) };
  per.set(id, out);
  return out;
}
