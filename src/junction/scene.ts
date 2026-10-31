/**
 * Builds a renderable junction scene (local metres around the decision point) from
 * the route plus OSM road data. Falls back to a schematic scene built from the router's
 * intersection bearings and lane data when OSM detail is not available.
 */
import {
  LocalFrame,
  angleDiff,
  clamp,
  hashString,
  lerp,
  resampleXY,
  rightNormals,
  smoothstep,
  xyAt,
  xyBearing,
  xyLength,
  type LngLat,
  type XY,
} from '../geo/geo';
import { parseDestinations, splitRefs, type Lane, type Route, type Step } from '../routing/types';
import type { JunctionCandidate, JunctionKind } from './detect';
import type { OsmData, OsmWay } from './osmdata';
import { surroundScene, type SurroundData, type SurroundScene } from './surroundings';

export type RoadClass = 'motorway' | 'trunk' | 'major' | 'minor' | 'link';
export type Role = 'approach' | 'taken' | 'branch' | 'incoming' | 'context';
export type Vertical = 'up' | 'down' | 'level' | null;
type Tags = Record<string, string>;

export interface RoadStrip {
  id: string;
  role: Role;
  cls: RoadClass;
  pts: XY[];
  h: number[];
  /** Carriageway width (lanes × lane width) per point. */
  width: number[];
  lanes: number[];
  laneWidth: number;
  shoulder: number;
  oneway: boolean;
  guardrail: boolean;
  tunnel: boolean[];
  s: number[];
  /** Road name and ref, for labels in the junction view. */
  name?: string;
  ref?: string;
}

export interface SignSpec {
  id: string;
  taken: boolean;
  refs: string[];
  places: string[];
  exitRef?: string;
  arrow: 'left' | 'slight-left' | 'straight' | 'slight-right' | 'right';
  expressway: boolean;
  order: number;
  vertical?: 'up' | 'down';
  /** Lateral offset (m, + = right) of the lane group at the junction, used to place gantry panels. */
  lateral: number;
  laneCount: number;
}

export interface ScenePath {
  pts: XY[];
  h: number[];
  /** Distance relative to the junction: negative before, positive after. */
  s: number[];
}

export interface JunctionScene {
  id: string;
  kind: JunctionKind;
  source: 'osm' | 'schematic';
  origin: LngLat;
  drivingSide: 'left' | 'right';
  roads: RoadStrip[];
  route: ScenePath;
  camera: ScenePath;
  arrowWidth: number;
  approachLanes: number;
  lanes?: Lane[];
  signs: SignSpec[];
  junctionName?: string;
  exitRef?: string;
  vertical: Vertical;
  expressway: boolean;
  seed: number;
  /** Buildings, land use, water and labels around the junction, when fetched. */
  surround?: SurroundScene;
}

export interface SceneOptions {
  /** Preferred language for OSM name/destination tags ('en' picks destination:en etc.). */
  lang?: string;
  /** Raw surroundings for this junction (buildings, land use, places). */
  surround?: SurroundData | null;
}

const BEFORE = 340;
const AFTER = 320;
const RESAMPLE = 4;
// Heights are exaggerated a little (real decks are ~6 m) so ramps read clearly in perspective.
const DECK = 8.5; // metres per OSM layer
const GRADE = 0.085;

/* ---------------------------------------------------------------- tag helpers */

export function classOf(t: Tags | undefined): RoadClass {
  const hw = t?.highway ?? '';
  if (hw === 'motorway') return 'motorway';
  if (hw === 'trunk') return t?.motorroad === 'yes' || t?.expressway === 'yes' ? 'motorway' : 'trunk';
  if (hw.endsWith('_link')) return 'link';
  if (hw === 'primary' || hw === 'secondary') return 'major';
  return 'minor';
}

export function onewayDir(t: Tags | undefined): 1 | -1 | 0 {
  const o = t?.oneway;
  if (o === 'yes' || o === 'true' || o === '1') return 1;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'no') return 0;
  if (t?.highway === 'motorway' || t?.highway === 'motorway_link') return 1;
  if (t?.junction === 'roundabout' || t?.junction === 'circular') return 1;
  return 0;
}

function int(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Lanes in the direction of travel. */
export function lanesForward(t: Tags | undefined): number {
  const cls = classOf(t);
  const oneway = onewayDir(t) !== 0;
  const total = int(t?.lanes);
  if (oneway) return clamp(total ?? (cls === 'motorway' || cls === 'trunk' ? 2 : cls === 'major' ? 2 : 1), 1, 8);
  const fwd = int(t?.['lanes:forward']);
  if (fwd) return clamp(fwd, 1, 6);
  return clamp(total ? Math.max(1, Math.round(total / 2)) : 1, 1, 6);
}

export function lanesTotal(t: Tags | undefined): number {
  if (onewayDir(t) !== 0) return lanesForward(t);
  return clamp(int(t?.lanes) ?? 2, 1, 10);
}

function laneWidthOf(cls: RoadClass): number {
  return cls === 'motorway' ? 3.6 : cls === 'trunk' || cls === 'link' ? 3.5 : cls === 'major' ? 3.3 : 3.0;
}
function shoulderOf(cls: RoadClass): number {
  return cls === 'motorway' ? 1.8 : cls === 'trunk' || cls === 'link' ? 1.0 : cls === 'major' ? 0.5 : 0.3;
}
function layerOf(t: Tags | undefined): number {
  const l = int(t?.layer);
  if (l != null) return clamp(l, -3, 4);
  if (t?.bridge && t.bridge !== 'no') return 1;
  if (t?.tunnel && t.tunnel !== 'no') return -1;
  return 0;
}
function isTunnel(t: Tags | undefined): boolean {
  return (!!t?.tunnel && t.tunnel !== 'no') || t?.covered === 'yes';
}
function localized(t: Tags | undefined, key: string, lang?: string): string | undefined {
  if (!t) return undefined;
  return (lang && t[`${key}:${lang}`]) || t[key];
}
function splitList(v: string | undefined): string[] {
  return (v ?? '')
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
}

/* ---------------------------------------------------------------- road graph */

interface GNode {
  id: number;
  p: XY;
  tags?: Tags;
}
interface GEdge {
  a: number;
  b: number;
  way: OsmWay;
  len: number;
  brg: number;
}

class RoadGraph {
  nodes = new Map<number, GNode>();
  out = new Map<number, GEdge[]>();
  inn = new Map<number, GEdge[]>();
  /** Undirected unique segments for context rendering. */
  segs: { a: number; b: number; way: OsmWay; idx: number }[] = [];
  private grid = new Map<string, number[]>();
  private cell = 4;

  constructor(osm: OsmData, frame: LocalFrame, radius: number) {
    const tagged = new Map(osm.nodes.map((n) => [n.id, n.tags]));
    const seen = new Set<string>();
    for (const way of osm.ways) {
      const dir = onewayDir(way.tags);
      const pts = way.geometry.map((g) => frame.toXY([g.lon, g.lat]));
      for (let i = 0; i < way.nodes.length; i++) {
        const id = way.nodes[i];
        if (!this.nodes.has(id)) {
          this.nodes.set(id, { id, p: pts[i], tags: tagged.get(id) });
          const k = this.key(pts[i]);
          const bucket = this.grid.get(k);
          if (bucket) bucket.push(id);
          else this.grid.set(k, [id]);
        }
      }
      for (let i = 0; i < way.nodes.length - 1; i++) {
        const a = way.nodes[i];
        const b = way.nodes[i + 1];
        const pa = pts[i];
        const pb = pts[i + 1];
        if (Math.min(Math.hypot(pa[0], pa[1]), Math.hypot(pb[0], pb[1])) > radius) continue;
        const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        if (len < 0.05) continue;
        const sk = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (!seen.has(sk)) {
          seen.add(sk);
          this.segs.push({ a, b, way, idx: i });
        }
        if (dir >= 0) this.addEdge({ a, b, way, len, brg: xyBearing(pb[0] - pa[0], pb[1] - pa[1]) });
        if (dir <= 0) this.addEdge({ a: b, b: a, way, len, brg: xyBearing(pa[0] - pb[0], pa[1] - pb[1]) });
      }
    }
  }

  private key(p: XY): string {
    return `${Math.floor(p[0] / this.cell)},${Math.floor(p[1] / this.cell)}`;
  }

  private addEdge(e: GEdge) {
    (this.out.get(e.a) ?? this.out.set(e.a, []).get(e.a)!).push(e);
    (this.inn.get(e.b) ?? this.inn.set(e.b, []).get(e.b)!).push(e);
  }

  nearest(p: XY, maxD: number): GNode | null {
    const r = Math.ceil(maxD / this.cell);
    const cx = Math.floor(p[0] / this.cell);
    const cy = Math.floor(p[1] / this.cell);
    let best: GNode | null = null;
    let bestD = maxD;
    for (let x = cx - r; x <= cx + r; x++) {
      for (let y = cy - r; y <= cy + r; y++) {
        for (const id of this.grid.get(`${x},${y}`) ?? []) {
          const n = this.nodes.get(id)!;
          const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]);
          if (d <= bestD) {
            bestD = d;
            best = n;
          }
        }
      }
    }
    return best;
  }

  degree(id: number): number {
    const nb = new Set<number>();
    for (const e of this.out.get(id) ?? []) nb.add(e.b);
    for (const e of this.inn.get(id) ?? []) nb.add(e.a);
    return nb.size;
  }

  edge(a: number, b: number): GEdge | undefined {
    return this.out.get(a)?.find((e) => e.b === b) ?? this.out.get(b)?.find((e) => e.b === a);
  }

  walk(e0: GEdge, maxLen: number, forward: boolean): GEdge[] {
    const edges = [e0];
    let len = e0.len;
    const seen = new Set([e0.a, e0.b]);
    let cur = e0;
    while (len < maxLen) {
      const cands = forward
        ? (this.out.get(cur.b) ?? []).filter((e) => !seen.has(e.b))
        : (this.inn.get(cur.a) ?? []).filter((e) => !seen.has(e.a));
      let best: GEdge | null = null;
      let bestScore = Infinity;
      for (const e of cands) {
        const turn = Math.abs(angleDiff(cur.brg, e.brg));
        if (turn > 70) continue;
        const score =
          turn + (e.way.id === cur.way.id ? 0 : 12) + (classOf(e.way.tags) === classOf(cur.way.tags) ? 0 : 25);
        if (score < bestScore) {
          best = e;
          bestScore = score;
        }
      }
      if (!best) break;
      edges.push(best);
      seen.add(forward ? best.b : best.a);
      len += best.len;
      cur = best;
    }
    return forward ? edges : edges.reverse();
  }
}

/* ---------------------------------------------------------------- strip building */

interface RawStrip {
  id: string;
  role: Role;
  pts: XY[];
  /** Tags of each segment (pts.length - 1 entries). */
  segTags: (Tags | undefined)[];
  /** s of the first point relative to the junction. */
  s0: number;
  /** Treat as a two-way road even if tags say oneway (context only). */
  forceTwoWay?: boolean;
  defaultTags?: Tags;
}

interface Strip extends RoadStrip {
  segTags: (Tags | undefined)[];
  layer: number[];
}

function toStrip(raw: RawStrip): Strip {
  const { pts, src } = resampleXY(raw.pts, RESAMPLE);
  const cum = xyLength(pts);
  const s = cum.map((c) => c + raw.s0);
  const tags = src.map((i) => raw.segTags[i] ?? raw.defaultTags);
  const repr = tags.find(Boolean) ?? raw.defaultTags;
  const cls = classOf(repr);
  const oneway = !raw.forceTwoWay && onewayDir(repr) !== 0;
  const lanesRaw = tags.map((t) => (oneway ? lanesForward(t ?? repr) : lanesTotal(t ?? repr)));
  const lanes = smoothByDistance(lanesRaw, cum, 30);
  const lw = laneWidthOf(cls);
  return {
    id: raw.id,
    role: raw.role,
    cls,
    pts,
    h: pts.map(() => 0),
    width: lanes.map((l) => l * lw),
    lanes,
    laneWidth: lw,
    shoulder: shoulderOf(cls),
    oneway,
    guardrail: oneway && (cls === 'motorway' || cls === 'trunk' || cls === 'link'),
    tunnel: tags.map((t) => isTunnel(t)),
    s,
    name: repr?.name,
    ref: repr?.ref,
    segTags: tags,
    layer: tags.map((t) => layerOf(t)),
  };
}

function smoothByDistance(v: number[], cum: number[], half: number): number[] {
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) {
    let acc = 0;
    let wsum = 0;
    for (let j = i; j >= 0 && cum[i] - cum[j] <= half; j--) {
      const w = 1 - (cum[i] - cum[j]) / (half + 1);
      acc += v[j] * w;
      wsum += w;
    }
    for (let j = i + 1; j < v.length && cum[j] - cum[i] <= half; j++) {
      const w = 1 - (cum[j] - cum[i]) / (half + 1);
      acc += v[j] * w;
      wsum += w;
    }
    out[i] = acc / wsum;
  }
  return out;
}

function applyOffset(strip: Strip, off: (i: number) => number) {
  const n = rightNormals(strip.pts);
  strip.pts = strip.pts.map((p, i) => {
    const o = off(i);
    return [p[0] + n[i][0] * o, p[1] + n[i][1] * o] as XY;
  });
}

/** Elevation profile: OSM layers become deck heights, ramped with a maximum grade, optionally pinned at anchors. */
function elevate(strip: Strip, L0: number, anchorS: number | null) {
  const n = strip.s.length;
  const T = strip.layer.map((l) => (l - L0) * DECK);
  const h = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let up = 0;
    let down = 0;
    for (let j = 0; j < n; j++) {
      const d = Math.abs(strip.s[i] - strip.s[j]);
      if (T[j] > 0) up = Math.max(up, T[j] - GRADE * d);
      else if (T[j] < 0) down = Math.min(down, T[j] + GRADE * d);
    }
    h[i] = up + down;
    if (anchorS != null) {
      const lim = 0.1 * Math.abs(strip.s[i] - anchorS);
      h[i] = clamp(h[i], -lim, lim);
    }
  }
  strip.h = h;
}

function lateralOf(p: XY, headingDeg: number): number {
  const t = (headingDeg * Math.PI) / 180;
  return p[0] * Math.cos(t) - p[1] * Math.sin(t);
}

function pointAtS(strip: { pts: XY[]; s: number[] }, s: number): XY {
  const cum = strip.s.map((v) => v - strip.s[0]);
  return xyAt(strip.pts, cum, s - strip.s[0]).p;
}

function headingAt(pts: XY[], cum: number[], s: number, span = 25): number {
  const a = xyAt(pts, cum, s).p;
  const b = xyAt(pts, cum, s + span).p;
  return xyBearing(b[0] - a[0], b[1] - a[1]);
}

function arrowFor(delta: number): SignSpec['arrow'] {
  const a = Math.abs(delta);
  if (a < 7) return 'straight';
  if (a < 45) return delta < 0 ? 'slight-left' : 'slight-right';
  return delta < 0 ? 'left' : 'right';
}

/**
 * Branches of a split often leave almost parallel, which would give every sign a
 * straight arrow. Keep the straightest branch's arrow and slant the others toward
 * their side, as real signs at splits do.
 */
function slantArrows(signs: SignSpec[], kind: JunctionKind) {
  if (signs.length < 2) return;
  const sorted = [...signs].sort((a, b) => a.order - b.order);
  const straight = sorted.filter((s) => s.arrow === 'straight');
  if (straight.length === 0) return;
  if (straight.length === sorted.length || kind === 'fork') {
    if (sorted[0].arrow === 'straight') sorted[0].arrow = 'slight-left';
    const last = sorted[sorted.length - 1];
    if (last.arrow === 'straight') last.arrow = 'slight-right';
    return;
  }
  const mainIdx = sorted.findIndex((s) => s.arrow === 'straight');
  sorted.forEach((s, i) => {
    if (i !== mainIdx && s.arrow === 'straight') s.arrow = i < mainIdx ? 'slight-left' : 'slight-right';
  });
}

/* ---------------------------------------------------------------- lane group alignment */

interface Group {
  strip: Strip;
  lanes: number;
  lateral: number;
  span: [number, number];
  offset: number;
  taken: boolean;
}

/**
 * Line up lane groups of the branches that split from (or merge into) a single carriageway.
 * Returns width (in lanes) of the shared carriageway at the junction.
 */
function alignGroups(groups: Group[], sharedLanes: number, osrmLanes: Lane[] | undefined, lw: number): number {
  groups.sort((a, b) => a.lateral - b.lateral);
  const taken = groups.find((g) => g.taken);
  if (osrmLanes && osrmLanes.length >= 2 && groups.length === 2 && taken) {
    const N = osrmLanes.length;
    const valid = osrmLanes.map((l, i) => (l.valid ? i : -1)).filter((i) => i >= 0);
    const other = groups.find((g) => !g.taken)!;
    if (valid.length && valid.length < N) {
      taken.span = [Math.min(...valid), Math.max(...valid)];
      const rest = osrmLanes.map((l, i) => (!l.valid || l.indications.length > 1 ? i : -1)).filter((i) => i >= 0);
      const otherIdx = rest.filter((i) => !osrmLanes[i].valid || i < taken.span[0] || i > taken.span[1]);
      const shared = osrmLanes.map((l, i) => (l.valid && l.indications.length > 1 ? i : -1)).filter((i) => i >= 0);
      const idx = [...new Set([...otherIdx, ...shared])];
      other.span = idx.length ? [Math.min(...idx), Math.max(...idx)] : taken.span[0] > 0 ? [0, taken.span[0] - 1] : [taken.span[1] + 1, N - 1];
      for (const g of groups) g.offset = ((g.span[0] + g.span[1] + 1) / 2 - N / 2) * lw;
      for (const g of groups) g.lanes = g.span[1] - g.span[0] + 1;
      return N;
    }
  }
  let cum = 0;
  for (const g of groups) {
    g.span = [cum, cum + g.lanes - 1];
    cum += g.lanes;
  }
  const W = Math.max(sharedLanes, cum);
  const pad = (W - cum) / 2;
  for (const g of groups) g.offset = (pad + (g.span[0] + g.span[1] + 1) / 2 - W / 2) * lw;
  return W;
}

/* ---------------------------------------------------------------- main builders */

export function buildScene(
  route: Route,
  cand: JunctionCandidate,
  osm: OsmData | null,
  opts: SceneOptions = {},
): JunctionScene {
  const step = route.steps[cand.stepIndex];
  const origin = route.line.pointAt(cand.s);
  const frame = new LocalFrame(origin);
  const before = route.line.slice(cand.s - BEFORE, cand.s).map((p) => frame.toXY(p));
  const after = route.line.slice(cand.s, cand.s + AFTER).map((p) => frame.toXY(p));
  if (before.length < 2) before.unshift([before[0][0], before[0][1] - 50]);
  if (after.length < 2) after.push([after[0][0], after[0][1] + 50]);
  const seed = hashString(`${origin[0].toFixed(5)},${origin[1].toFixed(5)}`);
  const base = { id: cand.id, kind: cand.kind, origin, drivingSide: step.drivingSide, seed };
  let scene: JunctionScene | null = null;
  if (osm && osm.ways.length) {
    const s = fromOsm(cand, step, frame, before, after, osm, opts);
    if (s) scene = { ...base, ...s, source: 'osm' };
  }
  scene ??= { ...base, ...schematic(route, cand, step, before, after), source: 'schematic' };
  if (opts.surround) {
    try {
      scene.surround = surroundScene(opts.surround, frame, scene.roads, opts.lang);
    } catch (err) {
      console.warn('[junction] surroundings skipped', err);
    }
  }
  return scene;
}

type Built = Omit<JunctionScene, 'id' | 'kind' | 'origin' | 'drivingSide' | 'seed' | 'source'>;

function matchTags(g: RoadGraph, pts: XY[]): (Tags | undefined)[] {
  const ids = pts.map((p) => g.nearest(p, 2.5)?.id);
  const tags: (Tags | undefined)[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = ids[i];
    const b = ids[i + 1];
    tags.push(a != null && b != null ? g.edge(a, b)?.way.tags : undefined);
  }
  // Fill gaps from neighbours.
  for (let i = 1; i < tags.length; i++) if (!tags[i]) tags[i] = tags[i - 1];
  for (let i = tags.length - 2; i >= 0; i--) if (!tags[i]) tags[i] = tags[i + 1];
  return tags;
}

function chainRaw(g: RoadGraph, edges: GEdge[], id: string, role: Role, s0: number): RawStrip {
  const pts: XY[] = [g.nodes.get(edges[0].a)!.p, ...edges.map((e) => g.nodes.get(e.b)!.p)];
  return { id, role, pts, segTags: edges.map((e) => e.way.tags), s0 };
}

function fromOsm(
  cand: JunctionCandidate,
  step: Step,
  frame: LocalFrame,
  before: XY[],
  after: XY[],
  osm: OsmData,
  opts: SceneOptions,
): Built | null {
  const g = new RoadGraph(osm, frame, 800);
  const J = g.nearest([0, 0], 8);
  if (!J || g.degree(J.id) < 3) return null;

  const beforeTags = matchTags(g, before);
  const afterTags = matchTags(g, after);
  if (!beforeTags.some(Boolean) || !afterTags.some(Boolean)) return null;

  const cumB = xyLength(before);
  const lenB = cumB[cumB.length - 1];
  const cumA = xyLength(after);
  const approachBrg = headingAt(before, cumB, lenB - 30, 30);
  const takenBrg = headingAt(after, cumA, 0, 30);

  // Route edges at J.
  const eIn = (g.inn.get(J.id) ?? []).reduce<GEdge | null>(
    (best, e) =>
      !best || Math.abs(angleDiff(e.brg, approachBrg)) < Math.abs(angleDiff(best.brg, approachBrg)) ? e : best,
    null,
  );
  const eOut = (g.out.get(J.id) ?? []).reduce<GEdge | null>(
    (best, e) => (!best || Math.abs(angleDiff(e.brg, takenBrg)) < Math.abs(angleDiff(best.brg, takenBrg)) ? e : best),
    null,
  );
  if (!eIn || !eOut) return null;

  const isMerge = cand.kind === 'merge';
  const used = new Set<string>();
  const markUsed = (edges: GEdge[]) => edges.forEach((e) => used.add(e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`));
  // Mark the route's own segments as used.
  const markRoute = (pts: XY[]) => {
    const ids = pts.map((p) => g.nearest(p, 2.5)?.id);
    for (let i = 0; i < ids.length - 1; i++) {
      const a = ids[i];
      const b = ids[i + 1];
      if (a != null && b != null) used.add(a < b ? `${a}-${b}` : `${b}-${a}`);
    }
  };
  markRoute(before);
  markRoute(after);

  const approach = toStrip({ id: 'approach', role: 'approach', pts: before, segTags: beforeTags, s0: -lenB });
  const taken = toStrip({ id: 'taken', role: 'taken', pts: after, segTags: afterTags, s0: 0 });

  // Other branches leaving (diverge) or joining (merge) at J.
  const others: Strip[] = [];
  if (!isMerge) {
    for (const e of g.out.get(J.id) ?? []) {
      if (e === eOut || e.b === eIn.a) continue;
      if (Math.abs(angleDiff(approachBrg, e.brg)) > 80) continue;
      const edges = g.walk(e, AFTER, true);
      markUsed(edges);
      others.push(toStrip(chainRaw(g, edges, `branch${others.length}`, 'branch', 0)));
    }
  } else {
    for (const e of g.inn.get(J.id) ?? []) {
      if (e === eIn || e.a === eOut.b) continue;
      if (Math.abs(angleDiff(takenBrg, e.brg)) > 80) continue;
      const edges = g.walk(e, BEFORE, false);
      markUsed(edges);
      const raw = chainRaw(g, edges, `incoming${others.length}`, 'incoming', 0);
      const len = xyLength(raw.pts);
      raw.s0 = -len[len.length - 1];
      others.push(toStrip(raw));
    }
  }

  // Lane alignment at the junction.
  const shared = isMerge ? taken : approach;
  const sharedIdx = isMerge ? 0 : shared.pts.length - 1;
  const lw = shared.laneWidth;
  const osrmLanes = isMerge ? undefined : step.intersections[0]?.lanes;
  const branchStrips = isMerge ? [approach, ...others] : [taken, ...others];
  const probe = isMerge ? -60 : 60;
  const groups: Group[] = branchStrips.map((st) => {
    const p = pointAtS(st, probe);
    return {
      strip: st,
      lanes: Math.max(1, Math.round(isMerge ? st.lanes[st.lanes.length - 1] : st.lanes[0])),
      lateral: lateralOf(p, isMerge ? takenBrg : approachBrg),
      span: [0, 0],
      offset: 0,
      taken: st === (isMerge ? approach : taken),
    };
  });
  const sharedLanesAtJ = Math.round(shared.lanes[sharedIdx]);
  const W = shared.oneway ? alignGroups(groups, sharedLanesAtJ, osrmLanes, lw) : sharedLanesAtJ;
  const farIdx = isMerge ? shared.pts.length - 1 : 0;
  const lanesFar = Math.round(shared.lanes[farIdx]);
  // Side where lanes are added: away from the main (widest) group.
  const main = [...groups].sort((a, b) => b.lanes - a.lanes)[0];
  const minor = groups.find((gr) => gr !== main);
  const sigma = minor ? Math.sign(minor.lateral - main.lateral) || 1 : 1;
  if (shared.oneway) {
    // Widen the shared carriageway near the junction (taper) and keep the far edge straight.
    const near = (s: number) => (isMerge ? 1 - smoothstep(20, 180, s) : smoothstep(-180, -20, s));
    for (let i = 0; i < shared.lanes.length; i++) {
      const t = near(shared.s[i]);
      shared.lanes[i] = lerp(shared.lanes[i], Math.max(W, shared.lanes[i]), t);
      shared.width[i] = shared.lanes[i] * lw;
    }
    const c = (i: number) => (sigma * (shared.lanes[i] - lanesFar) * lw) / 2;
    const c0 = (sigma * (W - lanesFar) * lw) / 2;
    applyOffset(shared, c);
    for (const gr of groups) applyOffset(gr.strip, () => c0 + gr.offset);
    for (const gr of groups) {
      // Branch width at the junction equals its lane group.
      const st = gr.strip;
      for (let i = 0; i < st.lanes.length; i++) {
        const dist = Math.abs(st.s[i]);
        const t = smoothstep(0, 60, dist);
        st.lanes[i] = lerp(gr.lanes, st.lanes[i], t);
        st.width[i] = st.lanes[i] * st.laneWidth;
      }
    }
  }

  // Context: every other road segment near the junction, joined into runs.
  const context = contextStrips(g, used);

  // Elevation relative to the approach level at the junction.
  const L0 = approach.layer[approach.layer.length - 1] ?? 0;
  elevate(approach, L0, 0);
  elevate(taken, L0, 0);
  for (const o of others) elevate(o, L0, 0);
  for (const c of context) elevate(c, L0, null);

  const roads: RoadStrip[] = [...context, ...others, approach, taken].filter((r) => r.pts.length >= 2);

  // Driving line for the arrow, offset into our lane group.
  const tg = groups.find((gr) => gr.taken)!;
  const route_ = drivingLine(approach, taken, isMerge, tg.offset, tg.lanes, sigma, lw);
  const camera: ScenePath = {
    pts: approach.pts.map((p) => [p[0], p[1]] as XY),
    h: approach.h.slice(),
    s: approach.s.slice(),
  };

  // Signs.
  const lang = opts.lang;
  const jTags = J.tags?.highway === 'motorway_junction' ? J.tags : findJunctionNode(osm, frame)?.tags;
  const exitRef = step.exits?.split(';')[0] || jTags?.ref || afterTags.find((t) => t?.['junction:ref'])?.['junction:ref'];
  const approachExpressway = approach.cls === 'motorway';
  const stepDest = parseDestinations(step.destinations);
  const signs: SignSpec[] = groups.map((gr, order) => {
    const st = gr.strip;
    const tagsList = st.segTags.filter(Boolean) as Tags[];
    const firstTags = tagsList.find((t) => t.destination || t['destination:ref']) ?? tagsList[0];
    let refs = splitList(firstTags?.['destination:ref']);
    let places = splitList(localized(firstTags, 'destination', lang));
    if (gr.taken && !isMerge) {
      if (!places.length) places = stepDest.places;
      if (!refs.length) refs = stepDest.refs.length ? stepDest.refs : splitRefs(step.ref);
    }
    if (!refs.length) refs = splitRefs(firstTags?.ref);
    if (!places.length) {
      const nm = localized(firstTags, 'name', lang);
      if (nm) places = [nm];
    }
    const cum = st.s.map((v) => v - st.s[0]);
    const probeS = isMerge ? cum[cum.length - 1] - 90 : 90;
    const hb = isMerge ? headingAt(st.pts, cum, probeS, 40) : headingAt(st.pts, cum, Math.min(probeS, cum[cum.length - 1] - 20), 40);
    const delta = angleDiff(isMerge ? takenBrg : approachBrg, hb);
    const hAt = isMerge ? 0 : st.h[Math.min(st.h.length - 1, Math.round(140 / RESAMPLE))] ?? 0;
    const expresswayBranch = classOf(firstTags) === 'motorway' || refs.some((r) => /^E\d/i.test(r));
    return {
      id: st.id,
      taken: gr.taken,
      refs: refs.slice(0, 3),
      places: places.slice(0, 3),
      exitRef: gr.taken && cand.kind === 'exit' ? exitRef : undefined,
      arrow: arrowFor(delta),
      expressway: approachExpressway || expresswayBranch || (gr.taken && cand.kind === 'entry'),
      order,
      vertical: hAt > 3 ? 'up' : hAt < -3 ? 'down' : undefined,
      lateral: gr.offset + (shared.oneway ? (sigma * (W - lanesFar) * lw) / 2 : 0),
      laneCount: gr.lanes,
    };
  });
  if (isMerge) {
    const tTags = taken.segTags.find(Boolean);
    signs.splice(0, signs.length, {
      id: 'taken',
      taken: true,
      refs: splitRefs(step.ref || tTags?.ref).slice(0, 3),
      places: [localized(tTags, 'name', lang) || step.name].filter(Boolean),
      arrow: 'straight',
      expressway: taken.cls === 'motorway',
      order: 0,
      lateral: 0,
      laneCount: Math.round(taken.lanes[0]),
    });
  }

  slantArrows(signs, cand.kind);
  const vert = verticalOf(taken, others);
  return {
    roads,
    route: route_,
    camera,
    arrowWidth: clamp(tg.lanes * lw * 0.55, 2.2, 6.5),
    approachLanes: Math.round(approach.lanes[approach.lanes.length - 1]),
    lanes: step.intersections[0]?.lanes,
    signs,
    junctionName: localized(jTags, 'name', lang),
    exitRef: cand.kind === 'exit' ? exitRef : undefined,
    vertical: vert,
    expressway: approachExpressway,
  };
}

function findJunctionNode(osm: OsmData, frame: LocalFrame) {
  let best: (typeof osm.nodes)[number] | undefined;
  let bestD = 250;
  for (const n of osm.nodes) {
    if (n.tags?.highway !== 'motorway_junction') continue;
    const p = frame.toXY([n.lon, n.lat]);
    const d = Math.hypot(p[0], p[1]);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

function verticalOf(taken: Strip, others: Strip[]): Vertical {
  const peak = (st: Strip) => {
    let hi = 0;
    let lo = 0;
    for (let i = 0; i < st.s.length; i++) {
      if (st.s[i] > 220) break;
      hi = Math.max(hi, st.h[i]);
      lo = Math.min(lo, st.h[i]);
    }
    return { hi, lo };
  };
  const t = peak(taken);
  if (t.hi > 3) return 'up';
  if (t.lo < -3) return 'down';
  if (others.some((o) => {
    const p = peak(o);
    return p.hi > 3 || p.lo < -3;
  }))
    return 'level';
  return null;
}

function drivingLine(
  approach: Strip,
  taken: Strip,
  isMerge: boolean,
  offset: number,
  lanes: number,
  sigma: number,
  lw: number,
): ScenePath {
  const pts: XY[] = [];
  const h: number[] = [];
  const s: number[] = [];
  if (!isMerge) {
    // Approach centreline shifted into our lane group (clamped to the paved width).
    const n = rightNormals(approach.pts);
    for (let i = 0; i < approach.pts.length; i++) {
      const half = Math.max(0, approach.width[i] / 2 - (lanes * lw) / 2);
      const o = clamp(offset, -half, half);
      pts.push([approach.pts[i][0] + n[i][0] * o, approach.pts[i][1] + n[i][1] * o]);
      h.push(approach.h[i]);
      s.push(approach.s[i]);
    }
    for (let i = 1; i < taken.pts.length; i++) {
      pts.push(taken.pts[i]);
      h.push(taken.h[i]);
      s.push(taken.s[i]);
    }
  } else {
    for (let i = 0; i < approach.pts.length; i++) {
      pts.push(approach.pts[i]);
      h.push(approach.h[i]);
      s.push(approach.s[i]);
    }
    // After merging, drift one lane inward from the acceleration lane.
    const n = rightNormals(taken.pts);
    for (let i = 1; i < taken.pts.length; i++) {
      const target = offset - sigma * lw;
      const o = lerp(offset, target, smoothstep(20, 160, taken.s[i]));
      pts.push([taken.pts[i][0] + n[i][0] * o, taken.pts[i][1] + n[i][1] * o]);
      h.push(taken.h[i]);
      s.push(taken.s[i]);
    }
  }
  return { pts, h, s };
}

function contextStrips(g: RoadGraph, used: Set<string>): Strip[] {
  // Build runs of consecutive unused segments per way.
  type Run = { nodes: number[]; tags: Tags[]; oneway: boolean };
  const runs: Run[] = [];
  const byWay = new Map<number, { a: number; b: number; idx: number; way: OsmWay }[]>();
  for (const sg of g.segs) {
    const k = sg.a < sg.b ? `${sg.a}-${sg.b}` : `${sg.b}-${sg.a}`;
    if (used.has(k)) continue;
    const pa = g.nodes.get(sg.a)!.p;
    const pb = g.nodes.get(sg.b)!.p;
    if (Math.min(Math.hypot(pa[0], pa[1]), Math.hypot(pb[0], pb[1])) > 620) continue;
    (byWay.get(sg.way.id) ?? byWay.set(sg.way.id, []).get(sg.way.id)!).push(sg);
  }
  for (const segs of byWay.values()) {
    segs.sort((x, y) => x.idx - y.idx);
    let cur: Run | null = null;
    let lastIdx = -2;
    for (const sg of segs) {
      const dir = onewayDir(sg.way.tags);
      const [a, b] = dir === -1 ? [sg.b, sg.a] : [sg.a, sg.b];
      if (cur && sg.idx === lastIdx + 1 && dir !== -1) {
        cur.nodes.push(b);
        cur.tags.push(sg.way.tags);
      } else {
        cur = { nodes: [a, b], tags: [sg.way.tags], oneway: dir !== 0 };
        runs.push(cur);
      }
      lastIdx = sg.idx;
    }
  }
  // Join runs end-to-start where exactly two meet (keeps bridge ramps continuous).
  let merged = true;
  while (merged) {
    merged = false;
    const ends = new Map<number, number[]>();
    runs.forEach((r, i) => {
      for (const n of [r.nodes[0], r.nodes[r.nodes.length - 1]]) (ends.get(n) ?? ends.set(n, []).get(n)!).push(i);
    });
    for (const [node, list] of ends) {
      if (list.length !== 2 || g.degree(node) !== 2) continue;
      const [i, j] = list;
      if (i === j) continue;
      let A = runs[i];
      let B = runs[j];
      if (A.oneway !== B.oneway) continue;
      if (A.nodes[A.nodes.length - 1] !== node) {
        if (A.oneway) [A, B] = [B, A];
        else A = { ...A, nodes: [...A.nodes].reverse(), tags: [...A.tags].reverse() };
      }
      if (A.nodes[A.nodes.length - 1] !== node) continue;
      if (B.nodes[0] !== node) {
        if (B.oneway) continue;
        B = { ...B, nodes: [...B.nodes].reverse(), tags: [...B.tags].reverse() };
      }
      const joined: Run = { nodes: [...A.nodes, ...B.nodes.slice(1)], tags: [...A.tags, ...B.tags], oneway: A.oneway };
      const keep = runs.filter((_, k) => k !== i && k !== j);
      keep.push(joined);
      runs.splice(0, runs.length, ...keep);
      merged = true;
      break;
    }
  }
  return runs.map((r, i) =>
    toStrip({
      id: `ctx${i}`,
      role: 'context',
      pts: r.nodes.map((id) => g.nodes.get(id)!.p),
      segTags: r.tags,
      s0: 0,
    }),
  );
}

/* ---------------------------------------------------------------- schematic fallback */

function schematic(
  route: Route,
  cand: JunctionCandidate,
  step: Step,
  before: XY[],
  after: XY[],
): Built {
  const prev = route.steps[cand.stepIndex - 1];
  const highway = cand.highway;
  const isMerge = cand.kind === 'merge';
  const lanesInfo = step.intersections[0]?.lanes;
  const N = lanesInfo?.length || (highway ? 3 : 2);
  const validN = lanesInfo?.filter((l) => l.valid).length || (cand.kind === 'exit' || cand.kind === 'entry' ? 1 : Math.ceil(N / 2));
  const mainTags: Tags = { highway: highway ? 'motorway' : 'primary', oneway: 'yes', lanes: String(N) };
  const takenTags: Tags = {
    highway: cand.kind === 'exit' || cand.kind === 'entry' ? (highway ? 'motorway_link' : 'primary_link') : mainTags.highway,
    oneway: 'yes',
    lanes: String(isMerge ? N + 1 : validN),
  };
  const cumB = xyLength(before);
  const lenB = cumB[cumB.length - 1];
  const approach = toStrip({
    id: 'approach',
    role: 'approach',
    pts: before,
    segTags: before.slice(1).map(() => (isMerge ? { ...takenTags, highway: highway ? 'motorway_link' : 'primary_link', lanes: '1' } : mainTags)),
    s0: -lenB,
  });
  const taken = toStrip({ id: 'taken', role: 'taken', pts: after, segTags: after.slice(1).map(() => takenTags), s0: 0 });

  const ix = step.intersections[0];
  const others: Strip[] = [];
  if (ix) {
    ix.bearings.forEach((b, i) => {
      if (i === ix.out || i === ix.in) return;
      if (!isMerge && ix.entry[i] && Math.abs(angleDiff(step.bearingBefore, b)) < 80) {
        const delta = angleDiff(step.bearingAfter, b);
        const pts: XY[] = [];
        let p: XY = [0, 0];
        for (let s = 0; s <= 300; s += 10) {
          pts.push(p);
          const hdg = ((b + Math.sign(delta) * Math.min(18, s * 0.05)) * Math.PI) / 180;
          p = [p[0] + Math.sin(hdg) * 10, p[1] + Math.cos(hdg) * 10];
        }
        const lanes = Math.max(1, N - validN);
        others.push(
          toStrip({
            id: `branch${others.length}`,
            role: 'branch',
            pts,
            segTags: pts.slice(1).map(() => ({ ...mainTags, lanes: String(lanes) })),
            s0: 0,
          }),
        );
      } else if (isMerge && !ix.entry[i] && Math.abs(angleDiff(step.bearingAfter + 180, b)) < 80) {
        const pts: XY[] = [];
        for (let s = 300; s >= 0; s -= 10) {
          const r = (b * Math.PI) / 180;
          pts.push([Math.sin(r) * s, Math.cos(r) * s]);
        }
        others.push(
          toStrip({
            id: `incoming${others.length}`,
            role: 'incoming',
            pts,
            segTags: pts.slice(1).map(() => mainTags),
            s0: -300,
          }),
        );
      }
    });
  }

  const shared = isMerge ? taken : approach;
  const lw = shared.laneWidth;
  const branchStrips = isMerge ? [approach, ...others] : [taken, ...others];
  const approachBrg = step.bearingBefore;
  const groups: Group[] = branchStrips.map((st) => ({
    strip: st,
    lanes: Math.max(1, Math.round(isMerge ? st.lanes[st.lanes.length - 1] : st.lanes[0])),
    lateral: lateralOf(pointAtS(st, isMerge ? -60 : 60), isMerge ? step.bearingAfter : approachBrg),
    span: [0, 0],
    offset: 0,
    taken: st === (isMerge ? approach : taken),
  }));
  const W = alignGroups(groups, Math.round(shared.lanes[isMerge ? 0 : shared.lanes.length - 1]), isMerge ? undefined : lanesInfo, lw);
  for (let i = 0; i < shared.lanes.length; i++) {
    shared.lanes[i] = W;
    shared.width[i] = W * lw;
  }
  for (const gr of groups) applyOffset(gr.strip, () => gr.offset);
  for (const gr of groups) {
    const st = gr.strip;
    for (let i = 0; i < st.lanes.length; i++) {
      st.lanes[i] = gr.lanes;
      st.width[i] = gr.lanes * st.laneWidth;
    }
  }

  const tg = groups.find((g) => g.taken)!;
  const dest = parseDestinations(step.destinations);
  const prevLabel = splitRefs(prev?.ref)[0];
  const signs: SignSpec[] = groups.map((gr, order) => {
    const st = gr.strip;
    const cum = st.s.map((v) => v - st.s[0]);
    const hb = isMerge ? headingAt(st.pts, cum, cum[cum.length - 1] - 90, 40) : headingAt(st.pts, cum, 90, 40);
    const delta = angleDiff(isMerge ? step.bearingAfter : approachBrg, hb);
    return {
      id: st.id,
      taken: gr.taken,
      refs: gr.taken ? (dest.refs.length ? dest.refs : splitRefs(step.ref)).slice(0, 3) : prevLabel ? [prevLabel] : [],
      places: gr.taken ? (dest.places.length ? dest.places : [step.name].filter(Boolean)).slice(0, 3) : [prev?.name].filter(Boolean) as string[],
      exitRef: gr.taken && cand.kind === 'exit' ? step.exits?.split(';')[0] : undefined,
      arrow: arrowFor(delta),
      expressway: highway,
      order,
      lateral: gr.offset,
      laneCount: gr.lanes,
    };
  });

  slantArrows(signs, cand.kind);
  return {
    roads: [...others, approach, taken],
    route: drivingLine(approach, taken, isMerge, tg.offset, tg.lanes, 1, lw),
    camera: { pts: approach.pts.slice(), h: approach.h.slice(), s: approach.s.slice() },
    arrowWidth: clamp(tg.lanes * lw * 0.55, 2.2, 6.5),
    approachLanes: W,
    lanes: lanesInfo,
    signs,
    exitRef: cand.kind === 'exit' ? step.exits?.split(';')[0] : undefined,
    vertical: null,
    expressway: highway,
  };
}

/** Camera pose along the approach, `dist` metres before the junction. */
export function cameraPose(scene: JunctionScene, dist: number) {
  const c = scene.camera;
  const cum = c.s.map((v) => v - c.s[0]);
  const total = cum[cum.length - 1];
  const at = clamp(total - dist, 0, total);
  const { p, i, t } = xyAt(c.pts, cum, at);
  const ahead = xyAt(c.pts, cum, Math.min(total, at + 35)).p;
  const back = xyAt(c.pts, cum, Math.max(0, at - 5)).p;
  let heading = xyBearing(ahead[0] - back[0], ahead[1] - back[1]);
  if (!Number.isFinite(heading)) heading = 0;
  const h = lerp(c.h[i] ?? 0, c.h[Math.min(i + 1, c.h.length - 1)] ?? 0, t);
  return { pos: p, heading, h };
}
