/**
 * Overhead direction sign renderer (Canvas 2D). The same drawing is used for the
 * readable sign strip above the junction view and as a texture on the 3D gantry.
 * Country themes approximate local conventions; tweak the tables to taste.
 */
import type { LngLat } from '../geo/geo';
import type { SignSpec } from './scene';

export type SignThemeId = 'my' | 'jp' | 'us' | 'eu' | 'uk' | 'generic';

interface Palette {
  bg: string;
  fg: string;
}

export interface SignTheme {
  id: SignThemeId;
  label: string;
  expressway: Palette;
  ordinary: Palette;
  exitLabel: string;
  exitAlign: 'left' | 'right';
  /** Lane edge line colour on the 3D road surface. */
  edgeLine: string;
  shield: (ref: string) => ShieldStyle;
}

interface ShieldStyle {
  bg: string;
  fg: string;
  border?: string;
  shape: 'rect' | 'round' | 'shield' | 'pentagon' | 'interstate' | 'oval';
}

const WHITE_RECT: ShieldStyle = { bg: '#ffffff', fg: '#111111', shape: 'rect' };

export const SIGN_THEMES: Record<SignThemeId, SignTheme> = {
  my: {
    id: 'my',
    label: 'Malaysia',
    expressway: { bg: '#00703c', fg: '#ffffff' },
    ordinary: { bg: '#1b4ea0', fg: '#ffffff' },
    exitLabel: 'EXIT',
    exitAlign: 'left',
    edgeLine: '#f2f2f2',
    shield: (r) => {
      if (/^E\d/i.test(r)) return { bg: '#00703c', fg: '#ffffff', border: '#ffffff', shape: 'round' };
      if (/^AH\d/i.test(r)) return { bg: '#1b4ea0', fg: '#ffffff', border: '#ffffff', shape: 'rect' };
      if (/^(FT)?\d+$/i.test(r)) return { bg: '#ffffff', fg: '#111111', shape: 'shield' };
      return WHITE_RECT;
    },
  },
  jp: {
    id: 'jp',
    label: 'Japan',
    expressway: { bg: '#00834a', fg: '#ffffff' },
    ordinary: { bg: '#0f4fa8', fg: '#ffffff' },
    exitLabel: '出口',
    exitAlign: 'left',
    edgeLine: '#f5f5f5',
    shield: (r) => {
      if (/^[EC]\d+A?$/i.test(r)) return { bg: '#00834a', fg: '#ffffff', border: '#ffffff', shape: 'round' };
      if (/^\d+$/.test(r)) return { bg: '#0f4fa8', fg: '#ffffff', border: '#ffffff', shape: 'pentagon' };
      return { bg: '#ffffff', fg: '#0f4fa8', shape: 'rect' };
    },
  },
  us: {
    id: 'us',
    label: 'United States',
    expressway: { bg: '#006b45', fg: '#ffffff' },
    ordinary: { bg: '#006b45', fg: '#ffffff' },
    exitLabel: 'EXIT',
    exitAlign: 'right',
    edgeLine: '#f2f2f2',
    shield: (r) => {
      if (/^I[- ]?\d/i.test(r)) return { bg: '#1d3f91', fg: '#ffffff', shape: 'interstate' };
      if (/^US[- ]?\d/i.test(r)) return { bg: '#ffffff', fg: '#111111', shape: 'shield' };
      return { bg: '#ffffff', fg: '#111111', shape: 'oval' };
    },
  },
  eu: {
    id: 'eu',
    label: 'Europe (continental)',
    expressway: { bg: '#1e4f9c', fg: '#ffffff' },
    ordinary: { bg: '#f4c300', fg: '#111111' },
    exitLabel: '',
    exitAlign: 'right',
    edgeLine: '#f2f2f2',
    shield: (r) => {
      if (/^E\s?\d/i.test(r)) return { bg: '#00843d', fg: '#ffffff', border: '#ffffff', shape: 'rect' };
      if (/^A\s?\d/i.test(r)) return { bg: '#1e4f9c', fg: '#ffffff', border: '#ffffff', shape: 'round' };
      if (/^[BN]\s?\d/i.test(r)) return { bg: '#f4c300', fg: '#111111', border: '#111111', shape: 'rect' };
      return WHITE_RECT;
    },
  },
  uk: {
    id: 'uk',
    label: 'United Kingdom',
    expressway: { bg: '#1f4e9a', fg: '#ffffff' },
    ordinary: { bg: '#00703c', fg: '#ffffff' },
    exitLabel: 'J',
    exitAlign: 'left',
    edgeLine: '#f2f2f2',
    shield: (r) => {
      if (/^M\d/i.test(r)) return { bg: '#1f4e9a', fg: '#ffffff', border: '#ffffff', shape: 'rect' };
      if (/^A\d/i.test(r)) return { bg: '#00703c', fg: '#ffd200', border: '#ffffff', shape: 'rect' };
      return WHITE_RECT;
    },
  },
  generic: {
    id: 'generic',
    label: 'Generic',
    expressway: { bg: '#00703c', fg: '#ffffff' },
    ordinary: { bg: '#1b4ea0', fg: '#ffffff' },
    exitLabel: 'EXIT',
    exitAlign: 'left',
    edgeLine: '#f2f2f2',
    shield: () => WHITE_RECT,
  },
};

/** Rough country guess from a coordinate, used when the sign theme is "auto". */
export function guessTheme(p: LngLat): SignThemeId {
  const [lon, lat] = p;
  const inBox = (w: number, s: number, e: number, n: number) => lon >= w && lon <= e && lat >= s && lat <= n;
  if (inBox(99.6, 0.8, 119.3, 7.4)) return 'my';
  if (inBox(122.9, 24, 146.0, 45.6)) return 'jp';
  if (inBox(-125, 24.5, -66.9, 49.5)) return 'us';
  if (inBox(-8.2, 49.9, 1.8, 58.7)) return 'uk';
  if (inBox(-10, 35, 30, 71)) return 'eu';
  return 'generic';
}

export const SIGN_FONT =
  '"Barlow Condensed", "Roboto Condensed", "Arial Narrow", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif';

/* ------------------------------------------------------------------ drawing */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = 700): number {
  let s = size;
  ctx.font = `${weight} ${s}px ${SIGN_FONT}`;
  while (ctx.measureText(text).width > maxW && s > size * 0.68) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${SIGN_FONT}`;
  }
  return s;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function drawShield(ctx: CanvasRenderingContext2D, ref: string, st: ShieldStyle, x: number, y: number, h: number): number {
  const label = ref.replace(/^FT/i, '');
  ctx.font = `700 ${h * 0.62}px ${SIGN_FONT}`;
  const tw = ctx.measureText(label).width;
  let w = Math.max(h * 1.15, tw + h * 0.5);
  if (st.shape === 'pentagon' || st.shape === 'interstate' || st.shape === 'shield') w = Math.max(h * 1.1, tw + h * 0.45);
  ctx.save();
  ctx.lineWidth = Math.max(1.5, h * 0.07);
  ctx.fillStyle = st.bg;
  ctx.strokeStyle = st.border ?? st.fg;
  ctx.beginPath();
  switch (st.shape) {
    case 'round':
      roundRect(ctx, x, y, w, h, h * 0.28);
      break;
    case 'rect':
      roundRect(ctx, x, y, w, h, h * 0.1);
      break;
    case 'oval':
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'pentagon':
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h * 0.62);
      ctx.lineTo(x + w / 2, y + h);
      ctx.lineTo(x, y + h * 0.62);
      ctx.closePath();
      break;
    case 'shield':
      ctx.moveTo(x, y + h * 0.08);
      ctx.quadraticCurveTo(x + w / 2, y - h * 0.08, x + w, y + h * 0.08);
      ctx.lineTo(x + w, y + h * 0.55);
      ctx.quadraticCurveTo(x + w, y + h * 0.92, x + w / 2, y + h);
      ctx.quadraticCurveTo(x, y + h * 0.92, x, y + h * 0.55);
      ctx.closePath();
      break;
    case 'interstate':
      ctx.moveTo(x, y + h * 0.05);
      ctx.quadraticCurveTo(x + w / 2, y + h * 0.18, x + w, y + h * 0.05);
      ctx.lineTo(x + w, y + h * 0.5);
      ctx.quadraticCurveTo(x + w, y + h * 0.9, x + w / 2, y + h);
      ctx.quadraticCurveTo(x, y + h * 0.9, x, y + h * 0.5);
      ctx.closePath();
      break;
  }
  ctx.fill();
  if (st.shape === 'interstate') {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(x, y, w, h * 0.3);
    ctx.restore();
    ctx.strokeStyle = '#ffffff';
  }
  ctx.stroke();
  ctx.fillStyle = st.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ty = st.shape === 'interstate' ? y + h * 0.6 : st.shape === 'pentagon' ? y + h * 0.42 : y + h * 0.53;
  ctx.font = `700 ${fitText(ctx, label, w - h * 0.25, h * (st.shape === 'interstate' ? 0.5 : 0.62))}px ${SIGN_FONT}`;
  ctx.fillText(label, x + w / 2, ty);
  ctx.restore();
  return w;
}

/** Direction arrow in a square box of size `s` at (x, y). */
function drawArrow(ctx: CanvasRenderingContext2D, kind: SignSpec['arrow'], x: number, y: number, s: number, color: string) {
  const angle = { straight: 0, 'slight-left': -45, 'slight-right': 45, left: -90, right: 90 }[kind];
  ctx.save();
  ctx.translate(x + s / 2, y + s / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.fillStyle = color;
  const L = s * 0.86;
  const shaft = s * 0.17;
  const head = s * 0.5;
  const headLen = s * 0.38;
  ctx.beginPath();
  ctx.moveTo(0, -L / 2);
  ctx.lineTo(head / 2, -L / 2 + headLen);
  ctx.lineTo(shaft / 2, -L / 2 + headLen);
  ctx.lineTo(shaft / 2, L / 2);
  ctx.lineTo(-shaft / 2, L / 2);
  ctx.lineTo(-shaft / 2, -L / 2 + headLen);
  ctx.lineTo(-head / 2, -L / 2 + headLen);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export interface DrawSignOptions {
  highlight?: boolean;
  /** Accent used for the highlight ring around the sign you should follow. */
  accent?: string;
  /** Put the arrow on the left (signs for left-hand branches). */
  arrowLeft?: boolean;
  dryRun?: boolean;
}

/** Draws a sign `w` px wide with its top-left at (0,0). Returns the height used. */
export function drawSign(
  ctx: CanvasRenderingContext2D,
  spec: SignSpec,
  theme: SignTheme,
  w: number,
  opts: DrawSignOptions = {},
): number {
  const pal = spec.expressway ? theme.expressway : theme.ordinary;
  const pad = w * 0.045;
  const ring = opts.highlight ? Math.max(3, w * 0.014) : 0;
  const tabH = spec.exitRef ? w * 0.12 : 0;
  const arrowS = w * 0.2;
  const shieldH = w * 0.105;
  const lineSize = w * 0.098;
  const lineGap = lineSize * 0.22;
  const places = spec.places.length ? spec.places : spec.refs.length ? [] : [''];
  const textH = places.length * lineSize + Math.max(0, places.length - 1) * lineGap;
  const shieldsRow = spec.refs.length ? shieldH + (places.length ? pad * 0.6 : 0) : 0;
  const contentH = Math.max(arrowS, shieldsRow + textH);
  const panelY = ring + tabH;
  const panelH = contentH + pad * 2;
  const total = panelY + panelH + ring;
  if (opts.dryRun) return total;

  const x0 = ring;
  const pw = w - ring * 2;
  ctx.save();
  // Exit number tab.
  if (spec.exitRef) {
    const label = [theme.exitLabel, spec.exitRef].filter(Boolean).join(theme.exitLabel === 'J' ? '' : ' ');
    ctx.font = `700 ${tabH * 0.66}px ${SIGN_FONT}`;
    const tw = ctx.measureText(label).width + tabH * 0.9;
    const tx = theme.exitAlign === 'left' ? x0 + pw * 0.04 : x0 + pw * 0.96 - tw;
    ctx.fillStyle = pal.bg;
    roundRect(ctx, tx, ring, tw, tabH + pad, w * 0.025);
    ctx.fill();
    ctx.strokeStyle = pal.fg;
    ctx.lineWidth = Math.max(1.2, w * 0.006);
    roundRect(ctx, tx + 3, ring + 3, tw - 6, tabH + pad, w * 0.02);
    ctx.stroke();
    ctx.fillStyle = pal.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tx + tw / 2, ring + tabH * 0.56);
  }
  // Highlight ring.
  if (opts.highlight) {
    ctx.fillStyle = opts.accent ?? '#2f80ff';
    roundRect(ctx, 0, panelY - ring, w, panelH + ring * 2, w * 0.04);
    ctx.fill();
  }
  // Panel.
  ctx.fillStyle = pal.bg;
  roundRect(ctx, x0, panelY, pw, panelH, w * 0.03);
  ctx.fill();
  ctx.strokeStyle = pal.fg;
  ctx.lineWidth = Math.max(1.5, w * 0.008);
  roundRect(ctx, x0 + w * 0.012, panelY + w * 0.012, pw - w * 0.024, panelH - w * 0.024, w * 0.022);
  ctx.stroke();

  const arrowLeft = opts.arrowLeft ?? (spec.arrow === 'left' || spec.arrow === 'slight-left');
  const ax = arrowLeft ? x0 + pad : x0 + pw - pad - arrowS;
  drawArrow(ctx, spec.arrow, ax, panelY + pad + (contentH - arrowS) / 2, arrowS, pal.fg);

  const tx0 = arrowLeft ? x0 + pad * 2 + arrowS : x0 + pad * 1.4;
  const tMax = pw - arrowS - pad * 3.4;
  let y = panelY + pad + (contentH - shieldsRow - textH) / 2;
  if (spec.refs.length) {
    let sx = tx0;
    for (const ref of spec.refs) {
      const sw = drawShield(ctx, ref, theme.shield(ref), sx, y, shieldH);
      sx += sw + pad * 0.5;
      if (sx > tx0 + tMax) break;
    }
    y += shieldsRow;
  }
  ctx.fillStyle = pal.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const line of places) {
    const size = fitText(ctx, line, tMax, lineSize);
    ctx.font = `700 ${size}px ${SIGN_FONT}`;
    ctx.fillText(ellipsize(ctx, line, tMax), tx0, y + (lineSize - size) * 0.6);
    y += lineSize + lineGap;
  }
  ctx.restore();
  return total;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Height a sign takes when drawn `w` px wide. */
export function signHeight(spec: SignSpec, theme: SignTheme, w: number, opts: DrawSignOptions = {}): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  return measureCtx ? drawSign(measureCtx, spec, theme, w, { ...opts, dryRun: true }) : w * 0.5;
}

/** Creates a crisp canvas holding a single sign. */
export function signCanvas(spec: SignSpec, theme: SignTheme, cssWidth: number, dpr: number, opts: DrawSignOptions = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const h = drawSign(ctx, spec, theme, cssWidth, { ...opts, dryRun: true });
  c.width = Math.ceil(cssWidth * dpr);
  c.height = Math.ceil(h * dpr);
  c.style.width = `${cssWidth}px`;
  c.style.height = `${h}px`;
  ctx.scale(dpr, dpr);
  drawSign(ctx, spec, theme, cssWidth, opts);
  return c;
}

/* ------------------------------------------------------------------ tunnel signs */

export interface TunnelSignOptions {
  theme: SignTheme;
  /** Tunnel name, or the generic word. */
  title: string;
  /** "Length 490 m" in the UI language. */
  lengthText: string;
  /** Headlights panel text; empty hides the panel. */
  lightsText: string;
  /** Use the expressway colours for the name plate. */
  expressway: boolean;
  dryRun?: boolean;
}

/** Warning-sign countries draw a yellow diamond; the rest a blue square information sign. */
function tunnelPictogramStyle(theme: SignTheme): 'warning' | 'info' {
  return theme.id === 'my' || theme.id === 'us' ? 'warning' : 'info';
}

/**
 * Tunnel mouth with a road running into it, drawn inside the box (x, y, s, s): a dark arch on
 * the horizon, its outline, and the road with centre dashes leading in from the bottom edge.
 */
function drawTunnelMouth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  c: { opening: string; road: string; dash: string; outline: string; lines?: boolean },
) {
  const cx = x + s / 2;
  const horizon = y + s * 0.6;
  const aw = s * (c.lines ? 0.46 : 0.66);
  const ah = s * (c.lines ? 0.34 : 0.5);
  const top = horizon - ah;
  const arch = (grow: number) => {
    const w = aw / 2 + grow;
    const ry = aw * 0.36 + grow;
    ctx.beginPath();
    ctx.moveTo(cx - w, horizon + grow * 0.3);
    ctx.lineTo(cx - w, top + ry - grow);
    ctx.ellipse(cx, top + ry - grow, w, ry, 0, Math.PI, 0);
    ctx.lineTo(cx + w, horizon + grow * 0.3);
    ctx.closePath();
  };
  ctx.save();
  if (c.lines) {
    // Hillside over the mouth.
    ctx.strokeStyle = c.road;
    ctx.lineWidth = s * 0.07;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.02, horizon);
    ctx.bezierCurveTo(x + s * 0.12, y + s * 0.02, x + s * 0.88, y + s * 0.02, x + s * 1.02, horizon);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.02, horizon);
    ctx.lineTo(x + s * 1.02, horizon);
    ctx.stroke();
  }
  arch(s * 0.075);
  ctx.fillStyle = c.outline;
  ctx.fill();
  arch(0);
  ctx.fillStyle = c.opening;
  ctx.fill();
  // Road from the bottom edge to the mouth, then fading into the dark.
  const bottom = y + s * 0.99;
  if (c.lines) {
    // Line art (warning signs): edge lines and dashes in the ink colour.
    ctx.strokeStyle = c.road;
    ctx.lineWidth = s * 0.07;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.4, bottom);
    ctx.lineTo(cx - aw * 0.36, horizon);
    ctx.moveTo(cx + s * 0.4, bottom);
    ctx.lineTo(cx + aw * 0.36, horizon);
    ctx.stroke();
    ctx.fillStyle = c.dash;
    for (const [t0, t1] of [[0.1, 0.38], [0.6, 0.92]]) {
      const ya = horizon + (bottom - horizon) * t0;
      const yb = horizon + (bottom - horizon) * t1;
      ctx.fillRect(cx - s * 0.025, ya, s * 0.05, yb - ya);
    }
    ctx.restore();
    return;
  }
  ctx.fillStyle = c.road;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.44, bottom);
  ctx.lineTo(cx - aw * 0.3, horizon);
  ctx.lineTo(cx + aw * 0.3, horizon);
  ctx.lineTo(cx + s * 0.44, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(cx - aw * 0.3, horizon);
  ctx.lineTo(cx - aw * 0.06, horizon - ah * 0.42);
  ctx.lineTo(cx + aw * 0.06, horizon - ah * 0.42);
  ctx.lineTo(cx + aw * 0.3, horizon);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = c.dash;
  const dash = (t0: number, t1: number) => {
    const ya = horizon + (bottom - horizon) * t0;
    const yb = horizon + (bottom - horizon) * t1;
    const wa = s * (0.008 + 0.022 * t0);
    const wb = s * (0.008 + 0.022 * t1);
    ctx.beginPath();
    ctx.moveTo(cx - wa, ya);
    ctx.lineTo(cx + wa, ya);
    ctx.lineTo(cx + wb, yb);
    ctx.lineTo(cx - wb, yb);
    ctx.closePath();
    ctx.fill();
  };
  dash(0.06, 0.3);
  dash(0.5, 0.86);
  ctx.restore();
}

/** Headlamp symbol with low-beam rays, in a box of height h at (x, y). Returns its width. */
function drawHeadlamp(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, ink: string): number {
  const w = h * 1.5;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(1.4, h * 0.11);
  ctx.lineCap = 'round';
  const bx = x + w * 0.5;
  // Lamp body: flat front facing left, rounded back.
  ctx.beginPath();
  ctx.moveTo(bx, y + h * 0.12);
  ctx.bezierCurveTo(bx + w * 0.62, y + h * 0.05, bx + w * 0.62, y + h * 0.95, bx, y + h * 0.88);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const yy = y + h * (0.2 + i * 0.2);
    ctx.beginPath();
    ctx.moveTo(bx - w * 0.08, yy);
    ctx.lineTo(x + w * 0.04, yy + h * 0.12);
    ctx.stroke();
  }
  ctx.restore();
  return w;
}

/** Split a name over at most two lines at a space, keeping the lines balanced. */
function twoLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  if (ctx.measureText(text).width <= maxW) return [text];
  // Break points: spaces, and after hyphens ("Gotthard-|Strassentunnel").
  const parts = text.split(/(\s+|(?<=-))/).filter((p) => p && !/^\s+$/.test(p));
  const words = parts;
  if (words.length < 2) return [text];
  const join = (ws: string[]) => ws.reduce((acc, w) => (acc && !acc.endsWith('-') ? `${acc} ${w}` : acc + w), '');
  let best = [text];
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = join(words.slice(0, i));
    const b = join(words.slice(i));
    const m = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (m < bestW) {
      bestW = m;
      best = [a, b];
    }
  }
  return best;
}

/**
 * Advance tunnel sign: pictogram, a name plate with the length, and a headlights panel.
 * Draws `w` px wide from (0,0) and returns the height used.
 */
export function drawTunnelSign(ctx: CanvasRenderingContext2D, w: number, o: TunnelSignOptions): number {
  const P = Math.round(w * 0.3);
  const gap = Math.round(w * 0.025);
  const lightsH = o.lightsText ? Math.round(P * 0.38) : 0;
  const total = P + (lightsH ? gap + lightsH : 0);
  if (o.dryRun) return total;
  const style = tunnelPictogramStyle(o.theme);
  ctx.save();

  // Pictogram.
  if (style === 'warning') {
    const c = P / 2;
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.moveTo(c, 0);
    ctx.lineTo(P, c);
    ctx.lineTo(c, P);
    ctx.lineTo(0, c);
    ctx.closePath();
    ctx.fill();
    const k = P * 0.06;
    ctx.fillStyle = o.theme.id === 'us' ? '#ffc20e' : '#ffd200';
    ctx.beginPath();
    ctx.moveTo(c, k);
    ctx.lineTo(P - k, c);
    ctx.lineTo(c, P - k);
    ctx.lineTo(k, c);
    ctx.closePath();
    ctx.fill();
    const yellow = o.theme.id === 'us' ? '#ffc20e' : '#ffd200';
    ctx.save();
    const m = k * 2.2;
    ctx.beginPath();
    ctx.moveTo(c, m);
    ctx.lineTo(P - m, c);
    ctx.lineTo(c, P - m);
    ctx.lineTo(m, c);
    ctx.closePath();
    ctx.clip();
    drawTunnelMouth(ctx, P * 0.2, P * 0.15, P * 0.6, { opening: '#111111', road: '#111111', dash: '#111111', outline: yellow, lines: true });
    ctx.restore();
  } else {
    const blue = o.theme.id === 'jp' ? '#0f4fa8' : '#1e4f9c';
    ctx.fillStyle = blue;
    roundRect(ctx, 0, 0, P, P, P * 0.08);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.2, P * 0.035);
    roundRect(ctx, P * 0.05, P * 0.05, P * 0.9, P * 0.9, P * 0.05);
    ctx.stroke();
    drawTunnelMouth(ctx, P * 0.13, P * 0.12, P * 0.74, { opening: '#111111', road: '#ffffff', dash: blue, outline: '#ffffff' });
  }

  // Name plate.
  const pal = o.expressway ? o.theme.expressway : o.theme.ordinary;
  const px = P + gap;
  const pw = w - px;
  ctx.fillStyle = pal.bg;
  roundRect(ctx, px, 0, pw, P, P * 0.08);
  ctx.fill();
  ctx.strokeStyle = pal.fg;
  ctx.lineWidth = Math.max(1.2, P * 0.03);
  roundRect(ctx, px + P * 0.045, P * 0.045, pw - P * 0.09, P * 0.91, P * 0.05);
  ctx.stroke();
  const inner = pw - P * 0.26;
  const tx = px + P * 0.13;
  ctx.fillStyle = pal.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let size = P * 0.3;
  ctx.font = `700 ${size}px ${SIGN_FONT}`;
  let lines = twoLines(ctx, o.title, inner);
  if (lines.length > 1) size = P * 0.24;
  ctx.font = `700 ${size}px ${SIGN_FONT}`;
  lines = lines.map((l) => {
    const sz = fitText(ctx, l, inner, size);
    ctx.font = `700 ${sz}px ${SIGN_FONT}`;
    return ellipsize(ctx, l, inner);
  });
  const lenSize = P * 0.2;
  const blockH = lines.length * size * 1.05 + lenSize * 1.15;
  let y = (P - blockH) / 2 + size * 0.55;
  for (const l of lines) {
    ctx.font = `700 ${fitText(ctx, l, inner, size)}px ${SIGN_FONT}`;
    ctx.fillText(l, tx, y);
    y += size * 1.05;
  }
  ctx.font = `600 ${lenSize}px ${SIGN_FONT}`;
  ctx.globalAlpha = 0.92;
  ctx.fillText(ellipsize(ctx, o.lengthText, inner), tx, y - size * 0.5 + lenSize * 0.75);
  ctx.globalAlpha = 1;

  // Headlights panel.
  if (lightsH) {
    const ly = P + gap;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 0, ly, w, lightsH, lightsH * 0.18);
    ctx.fill();
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = Math.max(1.2, lightsH * 0.07);
    roundRect(ctx, lightsH * 0.08, ly + lightsH * 0.08, w - lightsH * 0.16, lightsH * 0.84, lightsH * 0.12);
    ctx.stroke();
    const ih = lightsH * 0.5;
    const iw = drawHeadlamp(ctx, lightsH * 0.35, ly + (lightsH - ih) / 2, ih, '#111111');
    ctx.fillStyle = '#111111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const avail = w - iw - lightsH * 1.0;
    ctx.font = `700 ${fitText(ctx, o.lightsText, avail, lightsH * 0.5)}px ${SIGN_FONT}`;
    ctx.fillText(o.lightsText, lightsH * 0.5 + iw + avail / 2, ly + lightsH * 0.54);
  }
  ctx.restore();
  return total;
}

/** A crisp canvas holding one tunnel sign. */
export function tunnelSignCanvas(o: TunnelSignOptions, cssWidth: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const h = drawTunnelSign(ctx, cssWidth, { ...o, dryRun: true });
  c.width = Math.ceil(cssWidth * dpr);
  c.height = Math.ceil(h * dpr);
  c.style.width = `${cssWidth}px`;
  c.style.height = `${h}px`;
  ctx.scale(dpr, dpr);
  drawTunnelSign(ctx, cssWidth, o);
  return c;
}
