/**
 * Perspective "junction view" renderer. Draws the junction scene from a camera
 * placed on the approach road, looking ahead at the split, with the driving
 * line drawn as a large arrow. Uses unlit materials for an illustration look.
 */
import * as THREE from 'three';
import { clamp, distToPolyline, lerp, LocalFrame, rightNormals, rng, xyAt, type XY } from '../geo/geo';
import type { GroundMap } from './groundMap';
import { cameraPose, groundAt, type JunctionScene, type RoadStrip, type SceneGround } from './scene';
import { signCanvas, type SignTheme } from './signs';
import { buildSurroundings, SURROUND_DAY, SURROUND_NIGHT } from './surroundRender';

export interface JvPalette {
  skyTop: string;
  skyHorizon: string;
  ground: string;
  groundFar: string;
  hills: string;
  asphalt: string;
  asphaltMinor: string;
  deck: string;
  shoulder: string;
  marking: string;
  arrow: string;
  arrowEdge: string;
  guardrail: string;
  concrete: string;
  concreteDark: string;
  tunnel: string;
  tree: string;
  treeAlt: string;
  trunk: string;
  gantry: string;
  fog: string;
}

export const DAY: JvPalette = {
  skyTop: '#5d9be0',
  skyHorizon: '#d9e9f7',
  ground: '#9fbf86',
  groundFar: '#b9cfa2',
  hills: '#a9c3b8',
  asphalt: '#5b6068',
  asphaltMinor: '#6a6f76',
  deck: '#757a82',
  shoulder: '#6c7178',
  marking: '#f6f6f2',
  arrow: '#1f78ff',
  arrowEdge: '#ffffff',
  guardrail: '#cfd4da',
  concrete: '#c9c6bf',
  concreteDark: '#9e9a92',
  tunnel: '#15171a',
  tree: '#4f7f45',
  treeAlt: '#3f6d3c',
  trunk: '#6b5440',
  gantry: '#8e949b',
  fog: '#d9e9f7',
};

export const NIGHT: JvPalette = {
  skyTop: '#060b18',
  skyHorizon: '#1d2a44',
  ground: '#151c19',
  groundFar: '#1a221f',
  hills: '#1a2335',
  asphalt: '#2a2e35',
  asphaltMinor: '#30343a',
  deck: '#3a3f47',
  shoulder: '#2f333a',
  marking: '#e8e6da',
  arrow: '#3b8cff',
  arrowEdge: '#dbe8ff',
  guardrail: '#666c74',
  concrete: '#4a4b4f',
  concreteDark: '#34353a',
  tunnel: '#000000',
  tree: '#17271b',
  treeAlt: '#132117',
  trunk: '#2a221b',
  gantry: '#4b5057',
  fog: '#1d2a44',
};

const CAM_HEIGHT = 15;
const CAM_PITCH = (5.5 * Math.PI) / 180;
const MIN_DIST = 55;
const MAX_DIST = 150;
const GANTRY_S = -8;

/**
 * Map the real distance to the junction onto a camera distance. The view appears
 * up to ~1 km out but the camera never sits further than 150 m back, so the split
 * stays readable; it then glides in as you approach.
 */
export function virtualDistance(real: number): number {
  return clamp(50 + real * 0.11, MIN_DIST, MAX_DIST);
}

/** Accumulates triangles per material so the scene is a handful of draw calls. */
class Acc {
  pos: number[] = [];
  tri(a: number[], b: number[], c: number[]) {
    this.pos.push(...a, ...b, ...c);
  }
  quad(a: number[], b: number[], c: number[], d: number[]) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    return g;
  }
}

/** World coordinates: x = east, y = up, z = south. */
const W = (x: number, y: number, h: number) => [x, h, -y];

interface Sample {
  p: XY;
  n: XY;
  h: number;
  w: number;
  lanes: number;
}

class StripSampler {
  cum: number[];
  normals: XY[];
  constructor(readonly st: RoadStrip) {
    this.cum = st.s.map((v) => v - st.s[0]);
    this.normals = rightNormals(st.pts);
  }
  get length() {
    return this.cum[this.cum.length - 1];
  }
  at(d: number): Sample {
    const { p, i, t } = xyAt(this.st.pts, this.cum, d);
    const j = Math.min(i + 1, this.st.pts.length - 1);
    const n0 = this.normals[i];
    const n1 = this.normals[j];
    const nx = lerp(n0[0], n1[0], t);
    const ny = lerp(n0[1], n1[1], t);
    const nl = Math.hypot(nx, ny) || 1;
    return {
      p,
      n: [nx / nl, ny / nl],
      h: lerp(this.st.h[i], this.st.h[j], t),
      w: lerp(this.st.width[i], this.st.width[j], t),
      lanes: lerp(this.st.lanes[i], this.st.lanes[j], t),
    };
  }
}

function offsetPt(s: Sample, off: number, lift: number): number[] {
  return W(s.p[0] + s.n[0] * off, s.p[1] + s.n[1] * off, s.h + lift);
}

/** How far a strip point sits above (+) or below (-) the ground. */
function above(st: RoadStrip, i: number, g: SceneGround | undefined): number {
  return st.h[i] - groundAt(g, st.pts[i][0], st.pts[i][1]);
}

/** Index where a strip disappears into a tunnel portal, or -1. */
function portalIndex(st: RoadStrip, g: SceneGround | undefined): number {
  for (let i = 0; i < st.pts.length; i++) if (st.tunnel[i] && above(st, i, g) < -3.2) return i;
  return -1;
}

function hiddenUnderground(st: RoadStrip, g: SceneGround | undefined): boolean {
  const depth = st.pts.map((_, i) => above(st, i, g));
  return depth.every((d) => d < -3) || (st.role === 'context' && st.tunnel.every(Boolean) && depth.some((d) => d < -1));
}

export class JunctionRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene3 = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.5, 4000);
  private jv: JunctionScene | null = null;
  private palette: JvPalette = DAY;
  private theme: SignTheme | null = null;
  private dist = 200;
  private arrowGroup = new THREE.Group();
  private arrowFrom = Infinity;
  private width = 0;
  private height = 0;
  private disposables: { dispose(): void }[] = [];
  private raf = 0;
  private lost = false;
  private arrowMats: THREE.MeshBasicMaterial[] = [];
  /** HTML labels for nearby roads, places and stops, positioned over the canvas each frame. */
  readonly labelLayer: HTMLDivElement;
  private labelEls: HTMLDivElement[] = [];
  /** Pixels at the top covered by the sign strip; labels stay below it. */
  topInset = 0;
  private v3 = new THREE.Vector3();

  constructor(private container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'jv-canvas';
    container.appendChild(this.canvas);
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'jv-labels';
    this.labelLayer.setAttribute('aria-hidden', 'true');
    container.appendChild(this.labelLayer);
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    } catch (e) {
      console.warn('[junction] WebGL unavailable', e);
      this.renderer = null;
    }
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      if (this.jv && this.theme) this.setScene(this.jv, this.theme, this.palette === NIGHT);
    });
  }

  get available(): boolean {
    return !!this.renderer;
  }

  setScene(jv: JunctionScene, theme: SignTheme, night = false) {
    this.jv = jv;
    this.theme = theme;
    this.palette = night ? NIGHT : DAY;
    this.clear();
    this.build();
    this.arrowFrom = Infinity;
    this.requestRender();
  }

  /** Real distance to the junction in metres; the camera position is derived from it. */
  setDistance(d: number) {
    const nd = virtualDistance(d);
    if (Math.abs(nd - this.dist) < 0.25 && this.arrowFrom !== Infinity) return;
    this.dist = nd;
    this.requestRender();
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer?.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    // Keep a ~62° horizontal field of view regardless of aspect.
    const hfov = (66 * Math.PI) / 180;
    this.camera.fov = clamp((2 * Math.atan(Math.tan(hfov / 2) / this.camera.aspect) * 180) / Math.PI, 28, 75);
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  /** Synchronous render, useful for tests and snapshots. */
  render() {
    if (!this.renderer || !this.jv || this.lost) return;
    this.resize();
    this.updateCamera();
    this.renderer.render(this.scene3, this.camera);
    this.updateLabels();
  }

  /** Place labels for nearby roads, places and stops at visible, non-overlapping spots. */
  private updateLabels() {
    const sc = this.jv?.surround;
    let used = 0;
    if (sc) {
      const Wd = this.width;
      const Ht = this.height;
      const placed: [number, number, number, number][] = [];
      const minY = Math.max(this.topInset, Ht * 0.18);
      const camPos = this.camera.position;
      for (const lab of sc.labels) {
        if (used >= 7) break;
        const maxDist = lab.kind === 'place' ? 1300 : lab.kind === 'poi' ? 800 : 650;
        const w = lab.text.length * (lab.kind === 'place' ? 8.6 : 7) + (lab.kind === 'poi' ? 26 : 16);
        const hgt = lab.kind === 'place' ? 22 : 20;
        let best: { x: number; y: number; rect: [number, number, number, number]; score: number } | null = null;
        for (const a of lab.anchors) {
          const wp = W(a.p[0], a.p[1], a.h);
          this.v3.set(wp[0], wp[1], wp[2]);
          if (this.v3.distanceTo(camPos) > maxDist) continue;
          this.v3.project(this.camera);
          if (this.v3.z > 1 || this.v3.z < -1) continue;
          const x = ((this.v3.x + 1) / 2) * Wd;
          const y = ((1 - this.v3.y) / 2) * Ht;
          if (x < w / 2 + 6 || x > Wd - w / 2 - 40 || y < minY + hgt || y > Ht - 44) continue;
          const rect: [number, number, number, number] = [x - w / 2, y - hgt, x + w / 2, y];
          if (placed.some((q) => rect[0] < q[2] + 4 && rect[2] > q[0] - 4 && rect[1] < q[3] + 3 && rect[3] > q[1] - 3)) continue;
          const score = Math.abs(y - Ht * 0.6) + Math.abs(x - Wd * 0.5) * 0.25;
          if (!best || score < best.score) best = { x, y, rect, score };
          if (lab.kind !== 'road') break;
        }
        if (!best) continue;
        let el = this.labelEls[used];
        if (!el) {
          el = document.createElement('div');
          this.labelLayer.appendChild(el);
          this.labelEls.push(el);
        }
        el.className = `jv-label is-${lab.kind}${lab.poi ? ` poi-${lab.poi}` : ''}`;
        el.textContent = lab.text;
        el.style.transform = `translate(${Math.round(best.x)}px, ${Math.round(best.y)}px) translate(-50%, -100%)`;
        el.hidden = false;
        placed.push(best.rect);
        used++;
      }
    }
    for (let i = used; i < this.labelEls.length; i++) this.labelEls[i].hidden = true;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.clear();
    this.renderer?.dispose();
    this.canvas.remove();
  }

  /* ------------------------------------------------------------ internals */

  private clear() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.scene3.clear();
    this.arrowGroup = new THREE.Group();
  }

  private mat(color: string, extra: THREE.MeshBasicMaterialParameters = {}) {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, ...extra });
    this.disposables.push(m);
    return m;
  }

  private addMesh(acc: Acc, material: THREE.Material, order = 0) {
    const g = acc.geometry();
    if (!g) return;
    this.disposables.push(g);
    const mesh = new THREE.Mesh(g, material);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    this.scene3.add(mesh);
  }

  private updateCamera() {
    const jv = this.jv!;
    const pose = cameraPose(jv, this.dist);
    // Drift the camera toward the driving line so the arrow sits near the centre.
    const rc = jv.route.s.map((v) => v - jv.route.s[0]);
    const routeAt = xyAt(jv.route.pts, rc, clamp(-this.dist - jv.route.s[0], 0, rc[rc.length - 1])).p;
    // Up/down scenes keep the camera centred so the walls of the ramp stay in view.
    const drift = jv.vertical === 'up' || jv.vertical === 'down' ? 0.1 : 0.4;
    const cx = lerp(pose.pos[0], routeAt[0], drift);
    const cy = lerp(pose.pos[1], routeAt[1], drift);
    const hr = (pose.heading * Math.PI) / 180;
    const look = 100;
    this.camera.position.set(...(W(cx, cy, pose.h + CAM_HEIGHT) as [number, number, number]));
    const ty = pose.h + CAM_HEIGHT - Math.tan(CAM_PITCH) * look;
    this.camera.lookAt(...(W(cx + Math.sin(hr) * look, cy + Math.cos(hr) * look, ty) as [number, number, number]));
    // Rebuild the arrow when the camera has moved enough.
    if (Math.abs(this.arrowFrom - this.dist) > 4) this.buildArrow();
  }

  private build() {
    const jv = this.jv!;
    const P = this.palette;
    const theme = this.theme!;

    // Sky gradient background.
    const sky = document.createElement('canvas');
    sky.width = 2;
    sky.height = 256;
    const sctx = sky.getContext('2d')!;
    const grad = sctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, P.skyTop);
    grad.addColorStop(0.75, P.skyHorizon);
    grad.addColorStop(1, P.skyHorizon);
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 2, 256);
    const skyTex = new THREE.CanvasTexture(sky);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(skyTex);
    this.scene3.background = skyTex;
    this.scene3.fog = new THREE.Fog(P.fog, jv.surround ? 320 : 260, jv.surround ? 1450 : 1150);

    // Ground: drawn first and never occludes, so trenches and underpasses stay visible.
    const groundGeo = new THREE.PlaneGeometry(6000, 6000);
    groundGeo.rotateX(-Math.PI / 2);
    this.disposables.push(groundGeo);
    // With the map on the ground, the plain ground beyond it takes the map's land colour.
    const gm = jv.groundMap;
    const groundColor = gm?.land ?? P.ground;
    const ground = new THREE.Mesh(groundGeo, this.mat(groundColor, { depthWrite: false }));
    ground.position.y = jv.ground.level - 0.05;
    ground.renderOrder = -10;
    this.scene3.add(ground);
    if (jv.ground.grid) this.addTerrain(jv.ground, groundColor);
    if (gm) this.addGroundMap(gm, jv);
    this.addHills();

    const asphalt = new Acc();
    const asphaltRoute = new Acc();
    const asphaltMinor = new Acc();
    const marks = new Acc();
    const edges = new Acc();
    const rails = new Acc();
    const concrete = new Acc();
    const concreteDark = new Acc();
    const tunnel = new Acc();
    const deck = new Acc();

    const strips = jv.roads.filter((r) => !hiddenUnderground(r, jv.ground));
    for (const st of strips) {
      const portal = portalIndex(st, jv.ground);
      const sub = portal >= 0 ? truncate(st, portal + 1) : st;
      if (sub.pts.length < 2) continue;
      const smp = new StripSampler(sub);
      const target = st.role === 'approach' || st.role === 'taken' ? asphaltRoute : st.cls === 'minor' ? asphaltMinor : asphalt;
      this.ribbonStrip(smp, target, (s) => -(s.w / 2 + sub.shoulder), (s) => s.w / 2 + sub.shoulder, 0);
      if (sub.h.some((_, i) => above(sub, i, jv.ground) > 2)) this.deckOverlay(smp, deck);
      this.markings(smp, marks, edges);
      if (st.guardrail) this.guardrails(smp, rails, strips.filter((o) => o !== st));
      this.structures(smp, concrete, concreteDark);
      if (portal >= 0) this.portal(st, portal, tunnel, concrete);
    }

    this.addMesh(asphaltMinor, this.mat(P.asphaltMinor, { polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: 0 }), 0);
    this.addMesh(asphalt, this.mat(P.asphalt, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), 1);
    this.addMesh(asphaltRoute, this.mat(P.asphalt, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), 2);
    this.addMesh(deck, this.mat(P.deck, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), 2);
    this.addMesh(marks, this.mat(P.marking, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }), 3);
    this.addMesh(edges, this.mat(theme.edgeLine, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }), 3);
    this.addMesh(rails, this.mat(P.guardrail), 4);
    this.addMesh(concrete, this.mat(P.concrete), 4);
    this.addMesh(concreteDark, this.mat(P.concreteDark), 4);
    this.addMesh(tunnel, this.mat(P.tunnel), 4);

    let blocked: ((p: XY) => boolean) | undefined;
    if (jv.surround) {
      const pose = cameraPose(jv, MAX_DIST);
      const built = buildSurroundings(jv.surround, this.palette === NIGHT ? SURROUND_NIGHT : SURROUND_DAY, jv.seed, { pos: pose.pos, heading: pose.heading }, (x, y) => groundAt(jv.ground, x, y), {
        flat: !gm,
      });
      for (const o of built.objects) this.scene3.add(o);
      this.disposables.push(...built.disposables);
      blocked = built.blocked;
    }
    if (gm) {
      // Trees only where the map is green (parks, woods, grass), not on streets and buildings.
      const c = this.mapOffset(gm, jv);
      const notGreen = (p: XY) => !gm.green([p[0] - c[0], p[1] - c[1]]);
      const before = blocked;
      blocked = before ? (p: XY) => before(p) || notGreen(p) : notGreen;
    }
    this.addTrees(strips, blocked);
    this.addGantry();
    const arrowMat = (color: string, opacity: number) =>
      this.mat(color, {
        transparent: true,
        opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -12,
      });
    this.arrowMats = [arrowMat(P.arrowEdge, 0.95), arrowMat(P.arrow, 0.94)];
    this.scene3.add(this.arrowGroup);
  }

  private ribbonStrip(
    smp: StripSampler,
    acc: Acc,
    left: (s: Sample) => number,
    right: (s: Sample) => number,
    lift: number,
    from = 0,
    to = smp.length,
    step = 2,
  ) {
    let prev: Sample | null = null;
    for (let d = from; d <= to + 1e-6; d = d >= to ? to + 1 : Math.min(to, d + step)) {
      const s = smp.at(d);
      if (prev) {
        acc.quad(offsetPt(prev, left(prev), lift), offsetPt(prev, right(prev), lift), offsetPt(s, right(s), lift), offsetPt(s, left(s), lift));
      }
      prev = s;
    }
  }

  /** Slightly lighter surface on raised decks so the ramp separates from the road below. */
  private deckOverlay(smp: StripSampler, acc: Acc) {
    const st = smp.st;
    let prev: Sample | null = null;
    const up = (x: Sample) => x.h - this.ground(x.p[0], x.p[1]);
    for (let d = 0; d <= smp.length + 0.01; d += 2) {
      const s = smp.at(Math.min(d, smp.length));
      if (prev && (up(prev) > 1.5 || up(s) > 1.5)) {
        const l = (x: Sample) => -(x.w / 2 + st.shoulder);
        const r = (x: Sample) => x.w / 2 + st.shoulder;
        acc.quad(offsetPt(prev, l(prev), 0.01), offsetPt(prev, r(prev), 0.01), offsetPt(s, r(s), 0.01), offsetPt(s, l(s), 0.01));
      }
      prev = s;
    }
  }

  private markings(smp: StripSampler, marks: Acc, edges: Acc) {
    const st = smp.st;
    const highway = st.cls === 'motorway' || st.cls === 'trunk' || st.cls === 'link';
    const lineW = highway ? 0.2 : 0.15;
    const [dash, gap] = highway ? [8, 12] : st.cls === 'major' ? [4, 6] : [3, 5];
    const L = smp.length;
    const lift = 0.03;
    // Edge lines.
    for (const sgn of [-1, 1]) {
      this.ribbonStrip(smp, edges, (s) => sgn * (s.w / 2) - lineW / 2, (s) => sgn * (s.w / 2) + lineW / 2, lift);
    }
    if (!st.oneway) {
      // Centre line of a two-way road.
      this.ribbonStrip(smp, marks, () => -0.08, () => 0.08, lift);
      return;
    }
    const maxLanes = Math.ceil(Math.max(...st.lanes) - 0.05);
    for (let k = 1; k < maxLanes; k++) {
      const off = (s: Sample) => -s.w / 2 + k * st.laneWidth;
      const period = dash + gap;
      for (let d0 = ((-st.s[0] % period) + period) % period; d0 < L; d0 += period) {
        const d1 = Math.min(L, d0 + dash);
        const mid = smp.at((d0 + d1) / 2);
        if (k >= mid.lanes - 0.15) continue; // lane does not exist here yet
        this.ribbonStrip(smp, marks, (s) => off(s) - 0.075, (s) => off(s) + 0.075, lift, d0, d1, 4);
      }
    }
  }

  private guardrails(smp: StripSampler, rails: Acc, others: RoadStrip[]) {
    const st = smp.st;
    const near = others.filter((o) => o.cls !== 'minor').map((o) => ({ o, box: bbox(o, Math.max(...o.width) / 2 + o.shoulder + 0.2) }));
    for (const sgn of [-1, 1]) {
      let prev: number[][] | null = null;
      for (let d = 0; d <= smp.length; d += 3) {
        const s = smp.at(d);
        const off = sgn * (s.w / 2 + st.shoulder + 0.3);
        const p: XY = [s.p[0] + s.n[0] * off, s.p[1] + s.n[1] * off];
        const blocked = near.some(({ o, box }) => {
          if (p[0] < box[0] || p[0] > box[2] || p[1] < box[1] || p[1] > box[3]) return false;
          if (o.h.every((v) => Math.abs(v - s.h) > 3)) return false;
          return distToPolyline(p, o.pts) < box[4];
        });
        if (blocked) {
          prev = null;
          continue;
        }
        const bot = W(p[0], p[1], s.h + 0.45);
        const top = W(p[0], p[1], s.h + 0.85);
        if (prev) rails.quad(prev[0], prev[1], top, bot);
        prev = [bot, top];
      }
    }
  }

  /**
   * Raised roads: walled embankment while low, then a viaduct deck on pillars.
   * Sunken roads: retaining walls up to ground level.
   */
  private structures(smp: StripSampler, concrete: Acc, dark: Acc) {
    const st = smp.st;
    const VIADUCT = 4.6;
    const g = (p: XY) => this.ground(p[0], p[1]);
    // With terrain, roads in a shallow cut or on low fill read as on the ground: no walls.
    const hilly = !!this.jv?.ground.grid;
    const RAISED = hilly ? 1.2 : 0.25;
    const SUNKEN = hilly ? -1.2 : -0.6;
    let lastPillar = -Infinity;
    let prev: Sample | null = null;
    for (let d = 0; d <= smp.length + 0.01; d += 2) {
      const s = smp.at(Math.min(d, smp.length));
      if (prev) {
        for (const sgn of [-1, 1]) {
          const offA = sgn * (prev.w / 2 + st.shoulder);
          const offB = sgn * (s.w / 2 + st.shoulder);
          const pA = addN(prev, offA);
          const pB = addN(s, offB);
          const gA = g(pA);
          const gB = g(pB);
          const hi = Math.max(prev.h - gA, s.h - gB);
          if (hi > RAISED) {
            if (hi <= VIADUCT) {
              // Embankment wall from the ground up to the parapet.
              concrete.quad(W(pA[0], pA[1], gA), W(pB[0], pB[1], gB), W(pB[0], pB[1], s.h + 0.9), W(pA[0], pA[1], prev.h + 0.9));
            } else {
              dark.quad(W(pA[0], pA[1], prev.h - 1.4), W(pB[0], pB[1], s.h - 1.4), W(pB[0], pB[1], s.h), W(pA[0], pA[1], prev.h));
              concrete.quad(W(pA[0], pA[1], prev.h), W(pB[0], pB[1], s.h), W(pB[0], pB[1], s.h + 0.9), W(pA[0], pA[1], prev.h + 0.9));
            }
          }
          if (s.h - gB < SUNKEN || prev.h - gA < SUNKEN) {
            // Retaining wall from the road up to just above the ground.
            concrete.quad(W(pA[0], pA[1], prev.h), W(pB[0], pB[1], s.h), W(pB[0], pB[1], gB + 0.35), W(pA[0], pA[1], gA + 0.35));
          }
        }
      }
      if (s.h - g(s.p) > VIADUCT && d - lastPillar > 24) {
        lastPillar = d;
        const offs = s.w > 12 ? [-s.w / 4, s.w / 4] : [0];
        for (const o of offs) this.pillar(s, o, Math.min(2.6, s.w * 0.35), dark, concrete);
      }
      prev = s;
    }
  }

  private pillar(s: Sample, off: number, width: number, dark: Acc, light: Acc) {
    const c: XY = [s.p[0] + s.n[0] * off, s.p[1] + s.n[1] * off];
    const t: XY = [-s.n[1], s.n[0]]; // along road
    const hw = width / 2;
    const hd = 0.6;
    const corners: XY[] = [
      [c[0] - s.n[0] * hw - t[0] * hd, c[1] - s.n[1] * hw - t[1] * hd],
      [c[0] + s.n[0] * hw - t[0] * hd, c[1] + s.n[1] * hw - t[1] * hd],
      [c[0] + s.n[0] * hw + t[0] * hd, c[1] + s.n[1] * hw + t[1] * hd],
      [c[0] - s.n[0] * hw + t[0] * hd, c[1] - s.n[1] * hw + t[1] * hd],
    ];
    const top = s.h - 1.3;
    const foot = this.ground(c[0], c[1]) - 0.3;
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      (i % 2 ? dark : light).quad(W(a[0], a[1], foot), W(b[0], b[1], foot), W(b[0], b[1], top), W(a[0], a[1], top));
    }
  }

  private portal(st: RoadStrip, idx: number, tunnel: Acc, concrete: Acc) {
    const n = rightNormals(st.pts)[idx];
    const p = st.pts[idx];
    const h = st.h[idx];
    const half = st.width[idx] / 2 + st.shoulder + 0.4;
    const clear = 5.2;
    const L: XY = [p[0] - n[0] * half, p[1] - n[1] * half];
    const R: XY = [p[0] + n[0] * half, p[1] + n[1] * half];
    tunnel.quad(W(L[0], L[1], h), W(R[0], R[1], h), W(R[0], R[1], h + clear), W(L[0], L[1], h + clear));
    // Headwall above the opening up to ground level and a bit beyond the sides.
    const top = Math.max(h + clear + 0.6, this.ground(p[0], p[1]) + 0.9);
    const L2: XY = [p[0] - n[0] * (half + 2), p[1] - n[1] * (half + 2)];
    const R2: XY = [p[0] + n[0] * (half + 2), p[1] + n[1] * (half + 2)];
    concrete.quad(W(L2[0], L2[1], h + clear), W(R2[0], R2[1], h + clear), W(R2[0], R2[1], top), W(L2[0], L2[1], top));
    concrete.quad(W(L2[0], L2[1], h), W(L[0], L[1], h), W(L[0], L[1], h + clear), W(L2[0], L2[1], h + clear));
    concrete.quad(W(R[0], R[1], h), W(R2[0], R2[1], h), W(R2[0], R2[1], h + clear), W(R[0], R[1], h + clear));
  }

  /** Ground height at a scene point. */
  private ground(x: number, y: number): number {
    return groundAt(this.jv?.ground, x, y);
  }

  /** Terrain around the junction: a grid lit from the north-west so slopes read without lighting. */
  private addTerrain(g: SceneGround, color: string) {
    const gr = g.grid!;
    const n = gr.n;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const base = new THREE.Color(color);
    const c = new THREE.Color();
    const at = (i: number, j: number) => gr.h[clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1)];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = -gr.half + i * gr.cell;
        const y = -gr.half + j * gr.cell;
        const w = W(x, y, at(i, j) - 0.08);
        pos.set(w, (j * n + i) * 3);
        const dhdx = (at(i + 1, j) - at(i - 1, j)) / (2 * gr.cell);
        const dhdy = (at(i, j + 1) - at(i, j - 1)) / (2 * gr.cell);
        const shade = clamp(1 + 2.2 * (dhdx - dhdy), 0.72, 1.18);
        c.copy(base).multiplyScalar(shade);
        col.set([c.r, c.g, c.b], (j * n + i) * 3);
      }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        idx.push(a, a + 1, a + n + 1, a, a + n + 1, a + n);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    this.disposables.push(geo);
    const mesh = new THREE.Mesh(geo, this.mat('#ffffff', { vertexColors: true, depthWrite: false }));
    mesh.renderOrder = -9.5;
    mesh.frustumCulled = false;
    this.scene3.add(mesh);
  }

  /** Where the map image's centre sits in the scene's local metres. */
  private mapOffset(gm: GroundMap, jv: JunctionScene): XY {
    return new LocalFrame(jv.origin).toXY(gm.center);
  }

  /**
   * The map snapshot draped over the ground (and the terrain, shaded like it), under the roads:
   * streets, land use, water and building footprints around the junction, as on the map.
   */
  private addGroundMap(gm: GroundMap, jv: JunctionScene) {
    const c = this.mapOffset(gm, jv);
    const g = jv.ground;
    const half = gm.half;
    const n = g.grid ? Math.min(121, Math.ceil((2 * half) / Math.max(10, g.grid.cell)) + 1) : 2;
    const pos = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    const col = new Float32Array(n * n * 3);
    const step = (2 * half) / (n - 1);
    const hAt = (x: number, y: number) => groundAt(g, x, y);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = c[0] - half + i * step;
        const y = c[1] - half + j * step;
        const k = j * n + i;
        pos.set(W(x, y, hAt(x, y) - 0.06), k * 3);
        uv.set([i / (n - 1), j / (n - 1)], k * 2);
        let shade = 1;
        if (g.grid) {
          const e = 8;
          const dhdx = (hAt(x + e, y) - hAt(x - e, y)) / (2 * e);
          const dhdy = (hAt(x, y + e) - hAt(x, y - e)) / (2 * e);
          shade = clamp(1 + 2.2 * (dhdx - dhdy), 0.72, 1.18);
        }
        col.set([shade, shade, shade], k * 3);
      }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        idx.push(a, a + 1, a + n + 1, a, a + n + 1, a + n);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    const tex = new THREE.CanvasTexture(this.mapUnderRoads(gm, jv, c));
    tex.colorSpace = THREE.SRGBColorSpace;
    // The camera looks along the ground at a low angle: without anisotropic filtering the map
    // turns to mush a hundred metres out.
    tex.anisotropy = this.renderer?.capabilities.getMaxAnisotropy() ?? 1;
    this.disposables.push(geo, tex);
    const mesh = new THREE.Mesh(geo, this.mat('#ffffff', { map: tex, vertexColors: true, transparent: true, depthWrite: false }));
    mesh.renderOrder = -9.45;
    mesh.frustumCulled = false;
    this.scene3.add(mesh);
  }

  /**
   * The map image with its own drawing of the scene's roads painted over in the land colour: the
   * 3D roads lie on top, and a map road a little wider or a few metres off would peek out beside
   * them like a second road.
   */
  private mapUnderRoads(gm: GroundMap, jv: JunctionScene, c: XY): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = gm.image.width;
    out.height = gm.image.height;
    const ctx = out.getContext('2d');
    if (!ctx) return gm.image;
    ctx.drawImage(gm.image, 0, 0);
    const k = out.width / (2 * gm.half);
    const px = (p: XY): XY => [(p[0] - c[0] + gm.half) * k, (gm.half - (p[1] - c[1])) * k];
    // Only where the image is drawn, so the faded edges stay faded.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = gm.land;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const st of jv.roads) {
      if (hiddenUnderground(st, jv.ground)) continue;
      let w = -1;
      for (let i = 0; i < st.pts.length - 1; i++) {
        const wi = Math.round(((st.width[i] + st.width[i + 1]) / 2 + 2 * st.shoulder + 7) * k);
        if (wi !== w) {
          if (w > 0) ctx.stroke();
          w = wi;
          ctx.lineWidth = wi;
          ctx.beginPath();
          ctx.moveTo(...px(st.pts[i]));
        }
        ctx.lineTo(...px(st.pts[i + 1]));
      }
      if (w > 0) ctx.stroke();
    }
    return out;
  }

  private addHills() {
    const P = this.palette;
    const r = rng(this.jv!.seed ^ 0x9e3779b9);
    const acc = new Acc();
    const R = 1700;
    const seg = 96;
    const heights: number[] = [];
    for (let i = 0; i <= seg; i++) heights.push(i === seg ? heights[0] : 25 + r() * 70 + Math.sin(i * 0.5) * 20);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [Math.sin(a0) * R, Math.cos(a0) * R];
      const p1 = [Math.sin(a1) * R, Math.cos(a1) * R];
      const base = this.jv!.ground.level;
      acc.quad(W(p0[0], p0[1], base - 2), W(p1[0], p1[1], base - 2), W(p1[0], p1[1], base + heights[i + 1]), W(p0[0], p0[1], base + heights[i]));
    }
    const g = acc.geometry()!;
    this.disposables.push(g);
    const m = this.mat(P.hills, { fog: false, depthWrite: false });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = -9;
    mesh.frustumCulled = false;
    this.scene3.add(mesh);
  }

  private addTrees(strips: RoadStrip[], blocked?: (p: XY) => boolean) {
    const P = this.palette;
    const jv = this.jv!;
    const r = rng(jv.seed);
    const pose = cameraPose(jv, MAX_DIST + 20);
    const hr = (pose.heading * Math.PI) / 180;
    const fwd: XY = [Math.sin(hr), Math.cos(hr)];
    const right: XY = [Math.cos(hr), -Math.sin(hr)];
    const spots: { p: XY; s: number }[] = [];
    const boxes = strips.map((st) => ({ st, box: bbox(st, Math.max(...st.width) / 2 + st.shoulder + 7) }));
    let tries = 0;
    const target = blocked ? 90 : 170;
    while (spots.length < target && tries < 3000) {
      tries++;
      const f = 40 + r() * 760;
      const l = (r() - 0.5) * (120 + f * 1.6);
      const p: XY = [pose.pos[0] + fwd[0] * f + right[0] * l, pose.pos[1] + fwd[1] * f + right[1] * l];
      const clear = boxes.every(
        ({ st, box }) =>
          p[0] < box[0] || p[0] > box[2] || p[1] < box[1] || p[1] > box[3] || distToPolyline(p, st.pts) > box[4],
      );
      if (clear && !blocked?.(p)) spots.push({ p, s: 0.7 + r() * 0.7 });
    }
    if (!spots.length) return;
    const cone = new THREE.ConeGeometry(2.4, 7, 6);
    cone.translate(0, 5.2, 0);
    const trunk = new THREE.CylinderGeometry(0.35, 0.45, 2.2, 5);
    trunk.translate(0, 1.1, 0);
    this.disposables.push(cone, trunk);
    const crowns = new THREE.InstancedMesh(cone, this.mat('#ffffff'), spots.length);
    const trunks = new THREE.InstancedMesh(trunk, this.mat(P.trunk), spots.length);
    const m = new THREE.Matrix4();
    const c1 = new THREE.Color(P.tree);
    const c2 = new THREE.Color(P.treeAlt);
    spots.forEach((sp, i) => {
      m.makeScale(sp.s, sp.s * (0.85 + r() * 0.4), sp.s);
      const w = W(sp.p[0], sp.p[1], this.ground(sp.p[0], sp.p[1]));
      m.setPosition(w[0], w[1], w[2]);
      crowns.setMatrixAt(i, m);
      trunks.setMatrixAt(i, m);
      crowns.setColorAt(i, r() > 0.5 ? c1 : c2);
    });
    crowns.frustumCulled = false;
    trunks.frustumCulled = false;
    this.scene3.add(crowns, trunks);
  }

  private addGantry() {
    const jv = this.jv!;
    const theme = this.theme!;
    if (!jv.signs.length || jv.kind === 'merge') return;
    const approach = jv.roads.find((r) => r.role === 'approach');
    if (!approach) return;
    const smp = new StripSampler(approach);
    const d = smp.length + GANTRY_S;
    if (d < 0) return;
    const s = smp.at(d);
    const P = this.palette;
    const acc = new Acc();
    const half = s.w / 2 + approach.shoulder + 1.2;
    const beamH = 7.4;
    const post = (off: number) => {
      const c: XY = [s.p[0] + s.n[0] * off, s.p[1] + s.n[1] * off];
      const t: XY = [-s.n[1], s.n[0]];
      const q = 0.25;
      const a: XY = [c[0] - s.n[0] * q - t[0] * q, c[1] - s.n[1] * q - t[1] * q];
      const b: XY = [c[0] + s.n[0] * q - t[0] * q, c[1] + s.n[1] * q - t[1] * q];
      acc.quad(W(a[0], a[1], s.h), W(b[0], b[1], s.h), W(b[0], b[1], s.h + beamH + 0.5), W(a[0], a[1], s.h + beamH + 0.5));
    };
    post(-half);
    post(half);
    const L = offsetPt(s, -half, beamH);
    const R = offsetPt(s, half, beamH);
    acc.quad(L, R, offsetPt(s, half, beamH + 0.45), offsetPt(s, -half, beamH + 0.45));
    this.addMesh(acc, this.mat(P.gantry), 5);

    const lw = approach.laneWidth;
    const signs = [...jv.signs].sort((a, b) => a.order - b.order);
    for (const sign of signs) {
      const panelW = clamp(sign.laneCount * lw * 0.95, 4.6, 9.5);
      const cnv = signCanvas(sign, theme, 512, 1, { arrowLeft: sign.order === 0 && signs.length > 1 ? true : undefined });
      const aspect = cnv.height / cnv.width;
      const panelH = panelW * aspect;
      const tex = new THREE.CanvasTexture(cnv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.disposables.push(tex);
      const geo = new THREE.PlaneGeometry(panelW, panelH);
      this.disposables.push(geo);
      const mesh = new THREE.Mesh(geo, this.mat('#ffffff', { map: tex, side: THREE.FrontSide }));
      const lat = clamp(sign.lateral, -half + panelW / 2, half - panelW / 2);
      const c = offsetPt(s, lat, beamH + 0.45 - panelH / 2 + 0.2);
      mesh.position.set(c[0], c[1] + 0.0, c[2]);
      // Face the oncoming camera.
      const hr = Math.atan2(-s.n[1], s.n[0]);
      mesh.rotation.y = -hr;
      mesh.renderOrder = 6;
      this.scene3.add(mesh);
    }
  }

  private buildArrow() {
    const jv = this.jv!;
    for (const c of [...this.arrowGroup.children]) {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      this.arrowGroup.remove(c);
    }
    this.arrowFrom = this.dist;
    const r = jv.route;
    const strip: RoadStrip = {
      id: 'arrow',
      role: 'taken',
      cls: 'link',
      pts: r.pts,
      h: r.h,
      width: r.pts.map(() => jv.arrowWidth),
      lanes: r.pts.map(() => 1),
      laneWidth: jv.arrowWidth,
      shoulder: 0,
      oneway: true,
      guardrail: false,
      tunnel: r.pts.map(() => false),
      s: r.s,
    };
    const smp = new StripSampler(strip);
    const sOf = (rel: number) => clamp(rel - r.s[0], 0, smp.length);
    const start = sOf(-this.dist + 16);
    const takenRoad = jv.roads.find((x) => x.role === 'taken');
    const portal = takenRoad ? portalIndex(takenRoad, jv.ground) : -1;
    let endRel = jv.kind === 'merge' ? 150 : 135;
    if (portal >= 0 && takenRoad) endRel = Math.min(endRel, takenRoad.s[portal] + 3);
    const end = sOf(endRel);
    if (end - start < 20) return;
    const headLen = Math.max(9, jv.arrowWidth * 2.4);
    const bodyEnd = end - headLen;
    const aw = jv.arrowWidth;
    const lift = 0.35;
    const body = new Acc();
    const outline = new Acc();
    this.ribbonStrip(smp, body, () => -aw / 2, () => aw / 2, lift, start, bodyEnd, 2);
    this.ribbonStrip(smp, outline, () => -aw / 2 - 0.45, () => aw / 2 + 0.45, lift - 0.04, start - 0.6, bodyEnd, 2);
    const base = smp.at(bodyEnd);
    const tip = smp.at(end);
    const hw = aw * 1.15;
    body.tri(offsetPt(base, -hw, lift), offsetPt(base, hw, lift), offsetPt(tip, 0, lift));
    const ohw = hw + 0.9;
    const tipOut = smp.at(Math.min(smp.length, end + 1.2));
    const baseOut = smp.at(Math.max(0, bodyEnd - 0.6));
    outline.tri(offsetPt(baseOut, -ohw, lift - 0.04), offsetPt(baseOut, ohw, lift - 0.04), offsetPt(tipOut, 0, lift - 0.04));
    const mk = (acc: Acc, mat: THREE.Material, order: number) => {
      const g = acc.geometry();
      if (!g) return;
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = order;
      m.frustumCulled = false;
      this.arrowGroup.add(m);
    };
    mk(outline, this.arrowMats[0], 7);
    mk(body, this.arrowMats[1], 8);
  }
}

/** Bounding box [minX, minY, maxX, maxY, pad] expanded by pad. */
function bbox(st: RoadStrip, pad: number): [number, number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of st.pts) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad, pad];
}

function addN(s: Sample, off: number): XY {
  return [s.p[0] + s.n[0] * off, s.p[1] + s.n[1] * off];
}

function truncate(st: RoadStrip, n: number): RoadStrip {
  return {
    ...st,
    pts: st.pts.slice(0, n),
    h: st.h.slice(0, n),
    width: st.width.slice(0, n),
    lanes: st.lanes.slice(0, n),
    tunnel: st.tunnel.slice(0, n),
    s: st.s.slice(0, n),
  };
}
