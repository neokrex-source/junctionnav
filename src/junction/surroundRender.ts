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
    water: '#8ec5ea',
    park: '#b2d69a',
    forest: '#86b775',
    farm: '#c9dc9c',
    palm: '#97c07c',
    residential: '#dcdcd2',
    commercial: '#e3d6cf',
    industrial: '#d7d2dc',
  },
  walls: ['#ece7dc', '#e2ddd2', '#f3efe7', '#d9dee2', '#eadbc9', '#e6e2ee'],
  towerWalls: ['#a9bccb', '#b8c7d2', '#9fb3c4', '#c3ccd3'],
  industrialWalls: ['#cfd5da', '#d9d6cc', '#c7cfd6'],
  roofs: ['#b5604a', '#9a5b4b', '#8d969c', '#a7a39b', '#7b8a92'],
  river: '#79b7e3',
  rail: '#8a8580',
  palmCrown: '#4c8a3a',
  palmTrunk: '#7c644a',
  forest: ['#4f7f45', '#3f6d3c', '#5a8a4c'],
  hemiSky: '#ffffff',
  hemiGround: '#9a9f86',
  hemiIntensity: 1.1,
  sunIntensity: 1.6,
};

export const SURROUND_NIGHT: SurroundPalette = {
  areas: {
    water: '#14273a',
    park: '#18261c',
    forest: '#132119',
    farm: '#1c2619',
    palm: '#16241a',
    residential: '#1f2326',
    commercial: '#252226',
    industrial: '#202128',
  },
  walls: ['#3b3f47', '#353a42', '#41444a', '#393d48'],
  towerWalls: ['#2e3a4a', '#344255', '#2a3646'],
  industrialWalls: ['#34383d', '#2f3439'],
  roofs: ['#2a2c30', '#2e2b2a', '#26292d'],
  river: '#1a3550',
  rail: '#3a3836',
  palmCrown: '#1b2d1d',
  palmTrunk: '#2c241c',
  forest: ['#17271b', '#132117', '#1a2b1e'],
  hemiSky: '#9fb3d9',
  hemiGround: '#20242a',
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
  for (const a of sc.areas) {
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
  lineMesh('water', P.river, -7.5);
  lineMesh('rail', P.rail, -7.4);

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
