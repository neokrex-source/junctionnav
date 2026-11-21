/**
 * 3D roads for the zoomed map junction view: a MapLibre custom layer (three.js in the map's own
 * GL context) that stands the junction up on the map. Flyovers and elevated expressways sit on
 * pillars or walled embankments with their shadow on the map, ramps slope up and down, underpasses
 * drop into trenches, and the route is a ribbon that rides up and down with the road, with the car
 * on top at its real height.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import * as THREE from 'three';
import { clamp, lerp, LocalFrame, rightNormals, xyAt, type LngLat, type XY } from '../geo/geo';
import { groundAt, type JunctionScene, type RoadStrip } from './scene';
import { inTheme } from '../theme/tint';

/** Heights are shown 1.8× on the map so a 7 m deck reads at junction-view zoom on a phone. */
const EXAGGERATE = 1.8;
const STEP = 3;
const MIN_UP = 0.4;
const VIADUCT = 4.5;
/** Shadow offset per metre of height (east, north). */
const SHADOW: XY = [0.55, -0.45];

interface Palette {
  deck: string;
  deckEdge: string;
  side: string;
  wall: string;
  pillar: string;
  trench: string;
  shadow: string;
  route: string;
  routeEdge: string;
  /** The lanes that lead the route's way, tinted on the map, with an edge line either side. */
  lanes: string;
  laneEdge: string;
  /** Every other lane at the split, bright, in contrast with the route's. */
  lanesOther: string;
}
const DAY: Palette = {
  deck: '#f7f5fa',
  deckEdge: '#c4bcd3',
  side: '#a49cb3',
  wall: '#d2ccdc',
  pillar: '#bab3c6',
  trench: '#958ea3',
  shadow: '#000000',
  route: '#ea580c',
  routeEdge: '#7c2d12',
  lanes: '#fb923c',
  laneEdge: '#ea580c',
  lanesOther: '#6d7fe0',
};
const NIGHT: Palette = {
  deck: '#33284a',
  deckEdge: '#4e3f70',
  side: '#1d1729',
  wall: '#2a2238',
  pillar: '#2c2440',
  trench: '#15111f',
  shadow: '#000000',
  route: '#fb923c',
  routeEdge: '#431407',
  lanes: '#fb923c',
  laneEdge: '#fdba74',
  lanesOther: '#8090e0',
};

/** Collects triangles per colour. */
class Acc {
  pos: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[]) {
    this.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  tri(a: number[], b: number[], c: number[]) {
    this.pos.push(...a, ...b, ...c);
  }
  mesh(material: THREE.Material, order: number): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    const m = new THREE.Mesh(g, material);
    m.renderOrder = order;
    m.frustumCulled = false;
    return m;
  }
}

interface Sample {
  p: XY;
  n: XY;
  /** Height above the (flat) map ground, metres, exaggerated. */
  z: number;
  w: number;
  tunnel: boolean;
}

function sampler(st: { pts: XY[]; h: number[]; width?: number[]; s: number[]; tunnel?: boolean[] }, shoulder: number, ground: (p: XY) => number) {
  const cum = st.s.map((v) => v - st.s[0]);
  const normals = rightNormals(st.pts);
  const len = cum[cum.length - 1];
  const at = (d: number): Sample => {
    const { p, i, t } = xyAt(st.pts, cum, clamp(d, 0, len));
    const j = Math.min(i + 1, st.pts.length - 1);
    const nx = lerp(normals[i][0], normals[j][0], t);
    const ny = lerp(normals[i][1], normals[j][1], t);
    const nl = Math.hypot(nx, ny) || 1;
    const h = lerp(st.h[i], st.h[j], t);
    return {
      p,
      n: [nx / nl, ny / nl],
      z: (h - ground(p)) * EXAGGERATE,
      w: (st.width ? lerp(st.width[i], st.width[j], t) / 2 : 0) + shoulder,
      tunnel: !!st.tunnel?.[t < 0.5 ? i : j],
    };
  };
  return { at, len, s0: st.s[0] };
}

const P3 = (p: XY, z: number) => [p[0], p[1], z];
const side = (s: Sample, off: number): XY => [s.p[0] + s.n[0] * off, s.p[1] + s.n[1] * off];

export class JunctionLayer3D implements CustomLayerInterface {
  readonly id = 'jv-3d';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map: MlMap | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private camera = new THREE.Camera();
  private scene3 = new THREE.Scene();
  private roads = new THREE.Group();
  private car = new THREE.Group();
  private model = new THREE.Matrix4();
  private junction: JunctionScene | null = null;
  private frame: LocalFrame | null = null;

  constructor() {
    this.scene3.add(this.roads, this.car);
    this.car.visible = false;
    // The car: a white-edged blue arrow lying on the road.
    const shape = new THREE.Shape();
    shape.moveTo(0, 4.2);
    shape.lineTo(2.6, -2.6);
    shape.lineTo(0, -1.2);
    shape.lineTo(-2.6, -2.6);
    shape.closePath();
    const edge = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }));
    edge.scale.setScalar(1.25);
    edge.renderOrder = 20;
    const body = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#1f78ff', depthTest: false }));
    body.position.z = 0.05;
    body.renderOrder = 21;
    this.car.add(edge, body);
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
  }

  onRemove() {
    this.clear();
    this.renderer?.dispose();
    this.renderer = null;
    this.map = null;
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.renderer || !this.junction) return;
    const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]);
    this.camera.projectionMatrix = m.multiply(this.model);
    this.renderer.resetState();
    this.renderer.render(this.scene3, this.camera);
  }

  private clear() {
    for (const o of [...this.roads.children]) {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
      this.roads.remove(o);
    }
  }

  /** Builds the 3D roads for a junction scene (or clears them with null). */
  setScene(sc: JunctionScene | null, night: boolean) {
    this.clear();
    this.junction = sc;
    this.car.visible = false;
    if (!sc) {
      this.map?.triggerRepaint();
      return;
    }
    this.frame = new LocalFrame(sc.origin);
    // Local metres (x east, y north, z up) to MapLibre's mercator units (y grows southward).
    const [mx, my, s] = mercator(sc.origin);
    this.model = new THREE.Matrix4().makeTranslation(mx, my, 0).scale(new THREE.Vector3(s, -s, s));
    const P = inTheme(night ? NIGHT : DAY, night);
    const ground = (p: XY) => groundAt(sc.ground, p[0], p[1]);
    const deck = new Acc();
    const deckEdge = new Acc();
    const sides = new Acc();
    const walls = new Acc();
    const pillars = new Acc();
    const trench = new Acc();
    const shadow = new Acc();

    // The other carriageway (traffic the other way) is left out.
    const roads = sc.roads.filter((st) => !st.opposite);
    for (const st of roads) this.road(st, ground, { deck, deckEdge, sides, walls, pillars, trench, shadow });
    // Every other lane at the split, bright: the rest of the approach and the other ways (the road
    // joined, at a merge); the route's lanes go over it in their own colour.
    const others = new Acc();
    for (const st of roads) {
      if (st.role === 'context' || (st.role === 'taken' && sc.kind !== 'merge')) continue;
      this.laneOverlay(st, ground, others, sc.drivingSide);
    }

    const mat = (color: string, extra: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, ...extra });
    const add = (acc: Acc, m: THREE.Material, order: number) => {
      const mesh = acc.mesh(m, order);
      if (mesh) this.roads.add(mesh);
    };
    add(shadow, mat(P.shadow, { transparent: true, opacity: night ? 0.35 : 0.18, depthWrite: false }), 1);
    add(trench, mat(P.trench), 2);
    add(walls, mat(P.wall), 3);
    add(pillars, mat(P.pillar), 3);
    add(sides, mat(P.side), 3);
    add(deck, mat(P.deck, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 4);
    add(deckEdge, mat(P.deckEdge, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 5);
    add(others, mat(P.lanesOther, { transparent: true, opacity: night ? 0.5 : 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2.5, polygonOffsetUnits: -2.5 }), 5);
    this.routeRibbon(sc, ground, P, mat, add);
    this.map?.triggerRepaint();
  }

  /** A road's lanes (our side of a two-way road) as a band riding on it, on the map or its deck. */
  private laneOverlay(st: RoadStrip, ground: (p: XY) => number, acc: Acc, drivingSide: 'left' | 'right') {
    const smp = sampler(st, 0, ground);
    const own = drivingSide === 'left' ? -1 : 1;
    const lo = (x: Sample) => (st.oneway ? -x.w : own < 0 ? -x.w : 0);
    const hi = (x: Sample) => (st.oneway ? x.w : own < 0 ? 0 : x.w);
    let prev: Sample | null = null;
    for (let d = 0; d <= smp.len + 0.01; d += STEP) {
      const s = smp.at(d);
      const hidden = s.tunnel && s.z < -3 * EXAGGERATE;
      if (prev && !hidden) {
        const z0 = (prev.z > MIN_UP ? prev.z : prev.z < -MIN_UP ? prev.z : 0) + 0.2;
        const z1 = (s.z > MIN_UP ? s.z : s.z < -MIN_UP ? s.z : 0) + 0.2;
        acc.quad(P3(side(prev, lo(prev)), z0), P3(side(prev, hi(prev)), z0), P3(side(s, hi(s)), z1), P3(side(s, lo(s)), z1));
      }
      prev = hidden ? null : s;
    }
  }

  private road(
    st: RoadStrip,
    ground: (p: XY) => number,
    a: { deck: Acc; deckEdge: Acc; sides: Acc; walls: Acc; pillars: Acc; trench: Acc; shadow: Acc },
  ) {
    const smp = sampler(st, st.shoulder, ground);
    let prev: Sample | null = null;
    let lastPillar = -Infinity;
    for (let d = 0; d <= smp.len + 0.01; d += STEP) {
      const s = smp.at(d);
      if (prev) {
        const up = Math.max(prev.z, s.z);
        const down = Math.min(prev.z, s.z);
        const hidden = (prev.tunnel || s.tunnel) && down < -3 * EXAGGERATE;
        const L0 = side(prev, -prev.w);
        const R0 = side(prev, prev.w);
        const L1 = side(s, -s.w);
        const R1 = side(s, s.w);
        if (up > MIN_UP) {
          a.deck.quad(P3(L0, prev.z), P3(R0, prev.z), P3(R1, s.z), P3(L1, s.z));
          // Edge lines along the deck.
          for (const sg of [-1, 1]) {
            const e0 = side(prev, sg * (prev.w - 0.35));
            const e1 = side(s, sg * (s.w - 0.35));
            const o0 = side(prev, sg * prev.w);
            const o1 = side(s, sg * s.w);
            a.deckEdge.quad(P3(e0, prev.z + 0.02), P3(o0, prev.z + 0.02), P3(o1, s.z + 0.02), P3(e1, s.z + 0.02));
          }
          // Shadow cast to the south-east (sun from the north-west), longer the higher the deck.
          const sh = (p: XY, z: number): number[] => [p[0] + z * SHADOW[0], p[1] + z * SHADOW[1], 0.05];
          a.shadow.quad(sh(L0, prev.z), sh(R0, prev.z), sh(R1, s.z), sh(L1, s.z));
          for (const [p0, p1] of [
            [L0, L1],
            [R0, R1],
          ] as const) {
            if (up <= VIADUCT) a.walls.quad(P3(p0, 0), P3(p1, 0), P3(p1, s.z), P3(p0, prev.z));
            else a.sides.quad(P3(p0, prev.z - 1.2), P3(p1, s.z - 1.2), P3(p1, s.z), P3(p0, prev.z));
          }
          if (s.z > VIADUCT && d - lastPillar > 24) {
            lastPillar = d;
            this.pillar(s, a.pillars);
          }
        } else if (down < -MIN_UP && !hidden) {
          a.trench.quad(P3(L0, prev.z), P3(R0, prev.z), P3(R1, s.z), P3(L1, s.z));
          for (const [p0, p1] of [
            [L0, L1],
            [R0, R1],
          ] as const)
            a.walls.quad(P3(p0, prev.z), P3(p1, s.z), P3(p1, 0.3), P3(p0, 0.3));
        }
      }
      prev = s;
    }
  }

  private pillar(s: Sample, acc: Acc) {
    const offs = s.w > 7 ? [-s.w / 2, s.w / 2] : [0];
    const t: XY = [-s.n[1], s.n[0]];
    for (const o of offs) {
      const c = side(s, o);
      const hw = 0.9;
      const hd = 0.6;
      const corners: XY[] = [
        [c[0] - s.n[0] * hw - t[0] * hd, c[1] - s.n[1] * hw - t[1] * hd],
        [c[0] + s.n[0] * hw - t[0] * hd, c[1] + s.n[1] * hw - t[1] * hd],
        [c[0] + s.n[0] * hw + t[0] * hd, c[1] + s.n[1] * hw + t[1] * hd],
        [c[0] - s.n[0] * hw + t[0] * hd, c[1] - s.n[1] * hw + t[1] * hd],
      ];
      for (let i = 0; i < 4; i++) acc.quad(P3(corners[i], 0), P3(corners[(i + 1) % 4], 0), P3(corners[(i + 1) % 4], s.z - 1.2), P3(corners[i], s.z - 1.2));
    }
  }

  /** The route as a blue ribbon with a darker edge, riding on the road surfaces. */
  private routeRibbon(
    sc: JunctionScene,
    ground: (p: XY) => number,
    P: Palette,
    mat: (c: string, e?: THREE.MeshBasicMaterialParameters) => THREE.MeshBasicMaterial,
    add: (acc: Acc, m: THREE.Material, order: number) => void,
  ) {
    const r = sc.route;
    const taken = sc.roads.find((x) => x.role === 'taken');
    const smp = sampler({ pts: r.pts, h: r.h, s: r.s }, 0, ground);
    const edge = new Acc();
    const body = new Acc();
    const lanes = new Acc();
    const laneEdge = new Acc();
    const half = Math.max(2, sc.arrowWidth / 2);
    // The route's lanes, as wide as they are at each point (the route line in their middle).
    const laneSmp = sc.routeHalf?.length === r.pts.length ? sampler({ pts: r.pts, h: r.h, s: r.s, width: sc.routeHalf.map((x) => x * 2) }, 0, ground) : null;
    const lift = 0.3;
    // Hidden inside tunnels on our road (it shows again after the tunnel).
    const inTunnel = (sAbs: number) => {
      if (!taken || sAbs < taken.s[0]) return false;
      let i = 0;
      while (i < taken.s.length - 1 && taken.s[i + 1] < sAbs) i++;
      return taken.tunnel[i] && taken.h[i] - ground(taken.pts[i]) < -3.2;
    };
    let prev: Sample | null = null;
    for (let d = 0; d <= smp.len + 0.01; d += STEP) {
      const s = smp.at(d);
      if (inTunnel(smp.s0 + d)) {
        prev = null;
        continue;
      }
      if (prev) {
        const zp = Math.max(prev.z, 0) + lift;
        const zs = Math.max(s.z, 0) + lift;
        const zpp = prev.z < -MIN_UP ? prev.z + lift : zp;
        const zss = s.z < -MIN_UP ? s.z + lift : zs;
        edge.quad(P3(side(prev, -half - 0.6), zpp - 0.02), P3(side(prev, half + 0.6), zpp - 0.02), P3(side(s, half + 0.6), zss - 0.02), P3(side(s, -half - 0.6), zss - 0.02));
        body.quad(P3(side(prev, -half), zpp), P3(side(prev, half), zpp), P3(side(s, half), zss), P3(side(s, -half), zss));
        if (laneSmp) {
          const a = laneSmp.at(d - STEP);
          const b = laneSmp.at(d);
          const wa = Math.max(half + 0.6, a.w - 0.15);
          const wb = Math.max(half + 0.6, b.w - 0.15);
          lanes.quad(P3(side(prev, -wa), zpp - 0.1), P3(side(prev, wa), zpp - 0.1), P3(side(s, wb), zss - 0.1), P3(side(s, -wb), zss - 0.1));
          for (const sg of [-1, 1])
            laneEdge.quad(P3(side(prev, sg * (wa - 0.35)), zpp - 0.06), P3(side(prev, sg * wa), zpp - 0.06), P3(side(s, sg * wb), zss - 0.06), P3(side(s, sg * (wb - 0.35)), zss - 0.06));
        }
      }
      prev = s;
    }
    add(lanes, mat(P.lanes, { transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 6);
    add(laneEdge, mat(P.laneEdge, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 6);
    add(edge, mat(P.routeEdge, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 6);
    add(body, mat(P.route, { polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }), 7);
  }

  /** Puts the car on the route at its real height; false when the car is away from the junction. */
  setCar(p: LngLat, heading: number): boolean {
    const sc = this.junction;
    if (!sc || !this.frame) return false;
    const xy = this.frame.toXY(p);
    const r = sc.route;
    // Nearest route sample for the height.
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < r.pts.length; i++) {
      const d = Math.hypot(r.pts[i][0] - xy[0], r.pts[i][1] - xy[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > 60) {
      this.car.visible = false;
      this.map?.triggerRepaint();
      return false;
    }
    const z = Math.max(0, (r.h[best] - groundAt(sc.ground, xy[0], xy[1])) * EXAGGERATE);
    const zz = r.h[best] - groundAt(sc.ground, xy[0], xy[1]) < -MIN_UP ? (r.h[best] - groundAt(sc.ground, xy[0], xy[1])) * EXAGGERATE : z;
    this.car.position.set(xy[0], xy[1], zz + 0.6);
    this.car.rotation.set(0, 0, (-heading * Math.PI) / 180);
    this.car.visible = true;
    this.map?.triggerRepaint();
    return true;
  }

  /** Meshes built for the current scene (for tests and diagnostics). */
  get meshCount(): number {
    return this.roads.children.length;
  }

  /** Whether a scene is shown (the map then hides its flat route line around the junction). */
  get active(): boolean {
    return !!this.junction;
  }
}

/** Mercator position of a point (0..1 across the world) and the size of a metre there, as MapLibre uses them. */
export function mercator([lng, lat]: LngLat): [number, number, number] {
  const r = (lat * Math.PI) / 180;
  const x = (lng + 180) / 360;
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + r / 2))) / 360;
  const metre = 1 / (2 * Math.PI * 6371008.8 * Math.cos(r));
  return [x, y, metre];
}
