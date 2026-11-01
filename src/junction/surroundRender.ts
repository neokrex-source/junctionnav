/** Builds three.js meshes for the surroundings of a junction (buildings, land use, water, trees). */
import * as THREE from 'three';
import { rng, rightNormals, type XY } from '../geo/geo';
import { inRing, type AreaKind, type SurroundScene } from './surroundings';

export interface SurroundPalette {
  areas: Record<AreaKind, string>;
  walls: string[];
  towerWalls: string[];
  industrialWalls: string[];
  roofs: string[];
  river: string;
  rail: string;
  palmCrown: string;
  palmTrunk: string;
  forest: string[];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunIntensity: number;
}

export const SURROUND_DAY: SurroundPalette = {
  areas: {
    water: '#a9d0ef',
    park: '#bfe0c9',
    forest: '#94c4a3',
    farm: '#cfe3c0',
    palm: '#a3cba8',
    residential: '#e1e6ec',
    commercial: '#e7e2e8',
    industrial: '#dcdfe6',
  },
  walls: ['#eef1f5', '#e3e8ee', '#f5f7fa', '#d9dfe7', '#e8e4ea', '#e3e9ef'],
  towerWalls: ['#9db6d3', '#b3c6dc', '#8fa9c8', '#c3d0de'],
  industrialWalls: ['#cfd6de', '#d8dbe0', '#c6ced8'],
  roofs: ['#8a96a8', '#a3abb8', '#7b8899', '#b0b7c2', '#6f7d90'],
  river: '#8fc3ea',
  rail: '#8b93a0',
  palmCrown: '#4c8a50',
  palmTrunk: '#6f5c48',
  forest: ['#4a7d5a', '#3d6c4e', '#558a62'],
  hemiSky: '#ffffff',
  hemiGround: '#9aa3a6',
  hemiIntensity: 1.1,
  sunIntensity: 1.6,
};

export const SURROUND_NIGHT: SurroundPalette = {
  areas: {
    water: '#0a2140',
    park: '#0c2224',
    forest: '#0a2621',
    farm: '#0f2222',
    palm: '#0c2220',
    residential: '#111a2e',
    commercial: '#141b31',
    industrial: '#121a2d',
  },
  walls: ['#1d2742', '#202b47', '#1a2340', '#232e4c'],
  towerWalls: ['#1c2d4f', '#22365c', '#1a2a49'],
  industrialWalls: ['#1b2440', '#1f2843'],
  roofs: ['#121a2f', '#151d33', '#10182b'],
  river: '#0e2e57',
  rail: '#2a3654',
  palmCrown: '#0f2a20',
  palmTrunk: '#221c18',
  forest: ['#10241f', '#0d1e1a', '#122822'],
  hemiSky: '#8fb0e8',
  hemiGround: '#141c30',
  hemiIntensity: 0.55,
  sunIntensity: 0.35,
};

/** World coordinates: x = east, y = up, z = south. */
const W = (x: number, y: number, h: number): [number, number, number] => [x, h, -y];

interface Built {
  objects: THREE.Object3D[];
  disposables: { dispose(): void }[];
  /** True if a point is covered by a building, water or built-up land (no random trees there). */
  blocked: (p: XY) => boolean;
}

function boxOf(r: XY[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of r) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return [x0, y0, x1, y1];
}

function triangulate(ring: XY[]): number[][] {
  try {
    return THREE.ShapeUtils.triangulateShape(
      ring.map((p) => new THREE.Vector2(p[0], p[1])),
      [],
    );
  } catch {
    return [];
  }
}

/** Splits triangles until no edge is longer than `max` metres, so land use can lie on terrain. */
function tessellate(tris: [XY, XY, XY][], max: number): [XY, XY, XY][] {
  const out: [XY, XY, XY][] = [];
  const stack = tris.slice();
  while (stack.length) {
    const t = stack.pop()!;
    const d = [0, 1, 2].map((k) => Math.hypot(t[k][0] - t[(k + 1) % 3][0], t[k][1] - t[(k + 1) % 3][1]));
    const k = d.indexOf(Math.max(...d));
    if (d[k] <= max || out.length + stack.length > 60_000) {
      out.push(t);
      continue;
    }
    const a = t[k];
    const b = t[(k + 1) % 3];
    const c = t[(k + 2) % 3];
    const m: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    stack.push([a, m, c], [m, b, c]);
  }
  return out;
}

export function buildSurroundings(
  sc: SurroundScene,
  P: SurroundPalette,
  seed: number,
  focus: { pos: XY; heading: number },
  ground: (x: number, y: number) => number = () => 0,
  /** Land use, rivers and railways are drawn unless the map already lies on the ground. */
  opts: { flat?: boolean } = {},
): Built {
  const objects: THREE.Object3D[] = [];
  const disposables: { dispose(): void }[] = [];
  const r = rng(seed ^ 0x51ed);
  const hr = (focus.heading * Math.PI) / 180;
  const fwd: XY = [Math.sin(hr), Math.cos(hr)];
  /** Distance ahead of the camera's position, to skip work behind it. */
  const ahead = (p: XY) => (p[0] - focus.pos[0]) * fwd[0] + (p[1] - focus.pos[1]) * fwd[1];

  /* ---------- land use areas: on the ground, never occlude roads */
  const areaPos = new Map<AreaKind, number[]>();
  const hilly = [focus.pos, [0, 0] as XY, [300, 300] as XY, [-300, 300] as XY].some((p) => Math.abs(ground(p[0], p[1]) - ground(0, 0)) > 0.5);
  for (const a of opts.flat === false ? [] : sc.areas) {
    const tris = triangulate(a.ring);
    if (!tris.length) continue;
    const arr = areaPos.get(a.kind) ?? areaPos.set(a.kind, []).get(a.kind)!;
    const flat = tris.map((t) => t.map((i) => a.ring[i]) as [XY, XY, XY]);
    for (const t of hilly ? tessellate(flat, 40) : flat) for (const p of t) arr.push(...W(p[0], p[1], ground(p[0], p[1]) - 0.03));
  }
  const kinds: AreaKind[] = ['residential', 'commercial', 'industrial', 'farm', 'palm', 'forest', 'park', 'water'];
  kinds.forEach((k, idx) => {
    const pos = areaPos.get(k);
    if (!pos?.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.MeshBasicMaterial({ color: P.areas[k], side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = -8 + idx * 0.01;
    mesh.frustumCulled = false;
    objects.push(mesh);
    disposables.push(g, m);
  });

  /* ---------- rivers and railways */
  const lineMesh = (kind: 'water' | 'rail', color: string, order: number) => {
    const pos: number[] = [];
    for (const l of sc.lines) {
      if ((kind === 'water') !== (l.kind !== 'rail') || l.pts.length < 2) continue;
      const n = rightNormals(l.pts);
      for (let i = 0; i < l.pts.length - 1; i++) {
        const a = l.pts[i];
        const b = l.pts[i + 1];
        const h = l.width / 2;
        const p = (q: XY, nn: XY, s: number) => {
          const x = q[0] + nn[0] * h * s;
          const y = q[1] + nn[1] * h * s;
          return W(x, y, ground(x, y) - 0.02);
        };
        pos.push(...p(a, n[i], -1), ...p(a, n[i], 1), ...p(b, n[i + 1], 1), ...p(a, n[i], -1), ...p(b, n[i + 1], 1), ...p(b, n[i + 1], -1));
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    objects.push(mesh);
    disposables.push(g, m);
  };
  if (opts.flat !== false) {
    lineMesh('water', P.river, -7.5);
    lineMesh('rail', P.rail, -7.4);
  }

  /* ---------- buildings: lit, flat-shaded extrusions */
  const bPos: number[] = [];
  const bCol: number[] = [];
  const col = new THREE.Color();
  const push = (pts: [number, number, number][], c: THREE.Color) => {
    for (const p of pts) {
      bPos.push(...p);
      bCol.push(c.r, c.g, c.b);
    }
  };
  const blockers: { ring: XY[]; box: [number, number, number, number] }[] = [];
  for (const b of sc.buildings) {
    const ring = b.ring;
    const box = boxOf(ring);
    blockers.push({ ring, box });
    // Skip what is well behind the camera; it is never seen.
    if (ring.every((p) => ahead(p) < -40)) continue;
    const pal = b.kind === 'tower' ? P.towerWalls : b.kind === 'industrial' ? P.industrialWalls : P.walls;
    const wall = col.set(pal[Math.floor(r() * pal.length)]).clone();
    const roof = b.kind === 'house' ? col.set(P.roofs[Math.floor(r() * 2)]).clone() : wall.clone().multiplyScalar(0.86);
    // Buildings stand on the lowest ground under their footprint.
    const g0 = Math.min(...ring.map((p) => ground(p[0], p[1])));
    const base = g0 + (b.kind === 'roof' ? b.height - 0.7 : 0);
    const top = g0 + b.height;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const c = ring[(i + 1) % ring.length];
      const a0 = W(a[0], a[1], base);
      const c0 = W(c[0], c[1], base);
      const a1 = W(a[0], a[1], top);
      const c1 = W(c[0], c[1], top);
      push([a0, c0, c1, a0, c1, a1], wall);
    }
    for (const t of triangulate(ring)) {
      push(
        t.map((i) => W(ring[i][0], ring[i][1], top)),
        roof,
      );
      if (b.kind === 'roof') push(t.map((i) => W(ring[i][0], ring[i][1], base)), roof);
    }
  }
  if (bPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(bCol, 3));
    g.computeVertexNormals();
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    objects.push(mesh);
    disposables.push(g, m);
  }
  const hemi = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, P.hemiIntensity);
  const sun = new THREE.DirectionalLight('#ffffff', P.sunIntensity);
  sun.position.set(-0.45, 1, 0.35);
  objects.push(hemi, sun);

  /* ---------- trees: palm rows in plantations, clumps in forests and parks */
  const palmSpots: XY[] = [];
  const treeSpots: XY[] = [];
  const right: XY = [Math.cos(hr), -Math.sin(hr)];
  /** Inside a generous cone around the camera's view, within ~900 m. */
  const nearView = (p: XY) => {
    const f = ahead(p);
    if (f < -20 || f > 900) return false;
    const l = (p[0] - focus.pos[0]) * right[0] + (p[1] - focus.pos[1]) * right[1];
    return Math.abs(l) < 40 + f * 1.25;
  };
  const dist = (p: XY) => Math.hypot(p[0] - focus.pos[0], p[1] - focus.pos[1]);
  /** Keep every point near the camera and thin out far ones to stay within budget. */
  const budget = (pts: XY[], max: number): XY[] => {
    if (pts.length <= max) return pts;
    pts.sort((a, b) => dist(a) - dist(b));
    const near = pts.filter((p) => dist(p) < 260);
    if (near.length >= max) return near.slice(0, max);
    const far = pts.slice(near.length);
    const keep = (max - near.length) / far.length;
    return near.concat(far.filter(() => r() < keep));
  };
  const isBlocked = (p: XY) => blockers.some(({ ring, box }) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && inRing(p, ring));
  for (const a of sc.areas) {
    if (a.kind !== 'palm' && a.kind !== 'forest' && a.kind !== 'park') continue;
    const box = boxOf(a.ring);
    if (a.kind === 'palm') {
      const step = 10;
      for (let x = Math.ceil(box[0] / step) * step; x <= box[2]; x += step) {
        for (let y = Math.ceil(box[1] / step) * step; y <= box[3]; y += step) {
          const p: XY = [x + (r() - 0.5) * 1.5, y + (r() - 0.5) * 1.5];
          if (nearView(p) && inRing(p, a.ring)) palmSpots.push(p);
        }
      }
    } else {
      const density = a.kind === 'forest' ? 1 / 140 : 1 / 450;
      const areaApprox = (box[2] - box[0]) * (box[3] - box[1]);
      const n = Math.min(6000, Math.round(areaApprox * density));
      for (let i = 0; i < n; i++) {
        const p: XY = [box[0] + r() * (box[2] - box[0]), box[1] + r() * (box[3] - box[1])];
        if (nearView(p) && inRing(p, a.ring) && !isBlocked(p)) treeSpots.push(p);
      }
    }
  }
  palmSpots.splice(0, palmSpots.length, ...budget(palmSpots, 1600));
  treeSpots.splice(0, treeSpots.length, ...budget(treeSpots, 1200));
  const m4 = new THREE.Matrix4();
  if (palmSpots.length) {
    const trunk = new THREE.CylinderGeometry(0.28, 0.4, 6.2, 5);
    trunk.translate(0, 3.1, 0);
    const crown = new THREE.ConeGeometry(3.6, 2.2, 7);
    crown.rotateX(Math.PI);
    crown.translate(0, 6.8, 0);
    const mt = new THREE.MeshBasicMaterial({ color: P.palmTrunk });
    const mc = new THREE.MeshBasicMaterial({ color: P.palmCrown });
    const it = new THREE.InstancedMesh(trunk, mt, palmSpots.length);
    const ic = new THREE.InstancedMesh(crown, mc, palmSpots.length);
    palmSpots.forEach((p, i) => {
      const s = 0.85 + r() * 0.3;
      m4.makeRotationY(r() * Math.PI);
      m4.scale(new THREE.Vector3(s, s, s));
      const w = W(p[0], p[1], ground(p[0], p[1]));
      m4.setPosition(w[0], w[1], w[2]);
      it.setMatrixAt(i, m4);
      ic.setMatrixAt(i, m4);
    });
    it.frustumCulled = false;
    ic.frustumCulled = false;
    objects.push(it, ic);
    disposables.push(trunk, crown, mt, mc);
  }
  if (treeSpots.length) {
    const cone = new THREE.ConeGeometry(2.6, 7.5, 6);
    cone.translate(0, 5.4, 0);
    const mc = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const ic = new THREE.InstancedMesh(cone, mc, treeSpots.length);
    const cols = P.forest.map((c) => new THREE.Color(c));
    treeSpots.forEach((p, i) => {
      const s = 0.7 + r() * 0.8;
      m4.makeScale(s, s * (0.8 + r() * 0.5), s);
      const w = W(p[0], p[1], ground(p[0], p[1]));
      m4.setPosition(w[0], w[1], w[2]);
      ic.setMatrixAt(i, m4);
      ic.setColorAt(i, cols[i % cols.length]);
    });
    ic.frustumCulled = false;
    objects.push(ic);
    disposables.push(cone, mc);
  }

  const builtUp = sc.areas.filter((a) => a.kind === 'water' || a.kind === 'residential' || a.kind === 'commercial' || a.kind === 'industrial' || a.kind === 'palm');
  const builtBoxes = builtUp.map((a) => ({ ring: a.ring, box: boxOf(a.ring) }));
  const blocked = (p: XY) =>
    isBlocked(p) || builtBoxes.some(({ ring, box }) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && inRing(p, ring));
  return { objects, disposables, blocked };
}
