/**
 * Synthetic demo network (left-hand traffic, Malaysian-style naming). Produces
 * Overpass-shaped road data, an OSRM-shaped route response and GeoJSON for the
 * demo map, so the full pipeline can run offline.
 */
import { LocalFrame, xyBearing, type LngLat, type XY } from '../geo/geo';
import type { OsrmResponse } from '../routing/osrm';
import type { OsmData } from '../junction/osmdata';
import type { FeatureCollection } from 'geojson';
import type { SpeedData } from '../nav/speed';

type Tags = Record<string, string>;
type Pt = string | XY;

interface DNode {
  id: number;
  x: number;
  y: number;
  tags?: Tags;
}
interface DWay {
  id: number;
  nodes: number[];
  tags: Tags;
}

class Net {
  nodes = new Map<number, DNode>();
  ways: DWay[] = [];
  named = new Map<string, number>();
  private nid = 1000;
  private wid = 100;

  node(name: string | null, x: number, y: number, tags?: Tags): number {
    if (name && this.named.has(name)) return this.named.get(name)!;
    const id = ++this.nid;
    this.nodes.set(id, { id, x, y, tags });
    if (name) this.named.set(name, id);
    return id;
  }

  at(name: string): XY {
    const n = this.nodes.get(this.named.get(name)!)!;
    return [n.x, n.y];
  }

  private resolve(p: Pt): XY {
    return typeof p === 'string' ? this.at(p) : p;
  }

  /** A way through control points, smoothed with Catmull-Rom and sampled every `spacing` metres. */
  way(points: Pt[], tags: Tags, spacing = 12): number {
    const ctrl = points.map((p) => this.resolve(p));
    const ids: number[] = [];
    for (let i = 0; i < ctrl.length; i++) {
      const p = points[i];
      ids.push(typeof p === 'string' ? this.named.get(p)! : this.node(null, p[0], p[1]));
      if (i === ctrl.length - 1) break;
      const p0 = ctrl[Math.max(0, i - 1)];
      const p1 = ctrl[i];
      const p2 = ctrl[i + 1];
      const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const k = Math.max(1, Math.round(len / spacing));
      for (let j = 1; j < k; j++) {
        const t = j / k;
        const q = catmull(p0, p1, p2, p3, t);
        ids.push(this.node(null, q[0], q[1]));
      }
    }
    const id = ++this.wid;
    this.ways.push({ id, nodes: ids, tags });
    return id;
  }
}

function catmull(p0: XY, p1: XY, p2: XY, p3: XY, t: number): XY {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

export const DEMO_ORIGIN: LngLat = [100.82, 2.88];

export interface DemoPoi {
  id: string;
  cat: string;
  lngLat: LngLat;
  tags: Record<string, string>;
}

export interface DemoSpot {
  name: string;
  sub: string;
  lngLat: LngLat;
}

export interface DemoData {
  pois: DemoPoi[];
  spots: DemoSpot[];
  osm: OsmData;
  osrm: OsrmResponse;
  geojson: FeatureCollection;
  start: LngLat;
  end: LngLat;
  bounds: [LngLat, LngLat];
  /** The toll plaza on the expressway entrance ramp, for the toll reminder. */
  tolls: { id: string; at: LngLat; name: string }[];
  /** A speed camera on E35 and an average speed check on E1, for the speed alerts. */
  speed: SpeedData;
  /** Where a camera on the southbound E1 would stand (the other carriageway from the demo drive), for tests. */
  southCamera: LngLat;
}

let cached: DemoData | null = null;

export function buildDemo(): DemoData {
  if (cached) return cached;
  const net = new Net();
  const T = (t: Tags) => t;

  // --- named nodes
  net.node('P0', 0, -1960);
  net.node('Tu0', 0, -650);
  net.node('Tu1', 0, -150);
  net.node('Tv1', 14, -150);
  net.node('Tv0', 14, -650);
  net.node('A0', 0, -40);
  net.node('J1', 0, 700);
  net.node('Fb0', 2.5, 830);
  net.node('Fb1', 2.5, 1160);
  net.node('M1', 0, 1330);
  net.node('X1', -10, 990);
  net.node('J2', 0, 1800);
  net.node('M2', 300, 2420);
  net.node('E_a', 300, 2700);
  net.node('E_b', 300, 2950);
  net.node('J3', 300, 3300);
  net.node('K1', 560, 4150);
  net.node('J4', 590, 4500, { highway: 'motorway_junction', ref: '114', name: 'Sungai Buloh' });
  net.node('Bb0', 592, 4683);
  net.node('Bb1', 593, 4762);
  net.node('Tn0', 567, 4672);
  net.node('Tn1', 545, 4768);
  net.node('T1', 400, 5200);
  net.node('DEST', 250, 5200);
  net.node('S0', 14, 1800);
  net.node('S1', 14, -40);
  net.node('ES0', 330, 3300);
  net.node('ES1', 330, 1150);
  net.node('E0', 300, 1150);
  net.node('XA0', 200, 4720);
  net.node('XA1', 900, 4720);
  net.node('XAm', 592.4, 4720);
  net.node('XAr', 557.2, 4720);

  const trunk = (o: Tags) => T({ highway: 'trunk', oneway: 'yes', name: 'Jalan Demo', ref: '5', maxspeed: '80', ...o });
  // --- Approach: Jalan Demo through Bukit Demo in twin tunnel tubes
  const tube = { tunnel: 'yes', layer: '-1', 'tunnel:name': 'Terowong Bukit Demo', 'tunnel:name:en': 'Bukit Demo Tunnel', 'tunnel:name:ja': 'ブキッデモトンネル' };
  net.way(['P0', [0, -1300], 'Tu0'], trunk({ lanes: '3', maxspeed: '80' }), 20);
  net.way(['Tu0', 'Tu1'], trunk({ lanes: '3', maxspeed: '80', ...tube }), 20);
  net.way(['Tu1', 'A0'], trunk({ lanes: '3' }), 15);
  net.way(['S1', 'Tv1'], trunk({ lanes: '3' }), 15);
  net.way(['Tv1', 'Tv0'], trunk({ lanes: '3', maxspeed: '80', ...tube }), 20);
  net.way(['Tv0', [14, -1300], [14, -1960]], trunk({ lanes: '3', maxspeed: '80' }), 20);
  // --- Section A: trunk road with flyover / service road split
  net.way(['A0', [0, 300], 'J1'], trunk({ lanes: '3', 'turn:lanes': 'slight_left|through|through' }), 15);
  net.way(['J1', [1.6, 765], 'Fb0'], trunk({ lanes: '2', destination: 'Kuala Lumpur;Lebuhraya Demo' }), 10);
  net.way(['Fb0', 'Fb1'], trunk({ lanes: '2', bridge: 'yes', layer: '1', name: 'Jejantas Demo' }), 15);
  net.way(['Fb1', [1.6, 1240], 'M1'], trunk({ lanes: '2' }), 12);
  net.way(['J1', [-3, 745], [-9, 810], [-10, 900], 'X1'], {
    highway: 'primary',
    oneway: 'yes',
    lanes: '1',
    name: 'Jalan Demo (Susur Tepi)',
    destination: 'Kampung Baru;Taman Melati',
  }, 10);
  net.way(['X1', [-10, 1100], [-7, 1250], 'M1'], { highway: 'primary', oneway: 'yes', lanes: '1', name: 'Jalan Demo (Susur Tepi)' }, 12);
  net.way([[-420, 990], 'X1', [14, 990], [420, 990]], { highway: 'tertiary', lanes: '2', name: 'Jalan Kampung' }, 20);
  net.way(['M1', [0, 1550], 'J2'], trunk({ lanes: '3', 'turn:lanes': 'through|through|slight_right' }), 15);
  net.way(['S0', [14, 990], [14, 700], 'S1'], trunk({ lanes: '3' }), 20);

  // --- Section B: fork to the expressway entry ramp
  net.way(['J2', [-3, 1860], [-20, 1960], [-60, 2100], [-120, 2250], [-170, 2380]], trunk({ lanes: '2', destination: 'Pusat Bandar;Klang' }), 15);
  net.way(['J2', [3.5, 1860], [22, 1955], [65, 2060], [130, 2160], [200, 2250], [255, 2330], [287, 2385], 'M2'], {
    highway: 'motorway_link',
    oneway: 'yes',
    lanes: '1',
    maxspeed: '60',
    destination: 'Kuala Lumpur;Ipoh',
    'destination:ref': 'E1',
  }, 12);

  // --- Section C: expressway E1 northbound, merge with acceleration lane
  const e1 = (o: Tags) => T({ highway: 'motorway', oneway: 'yes', ref: 'E1', name: 'Lebuhraya Demo', toll: 'yes', maxspeed: '110', ...o });
  net.way(['E0', [300, 1800], 'M2'], e1({ lanes: '3' }), 25);
  net.way(['M2', 'E_a'], e1({ lanes: '4' }), 25);
  net.way(['E_a', 'E_b'], e1({ lanes: '3' }), 25);
  net.way(['E_b', 'J3'], e1({ lanes: '4', 'turn:lanes': 'slight_left|slight_left|slight_right|slight_right' }), 25);
  net.way(['ES0', [330, 2400], 'ES1'], e1({ lanes: '3', name: 'Lebuhraya Demo' }), 30);

  // --- Section D: JCT fork, E1 to Ipoh (left) and E35 to Kuala Lumpur (right)
  net.way(['J3', [297, 3360], [286, 3460], [256, 3580], [212, 3720], [152, 3900], [100, 4100]], e1({ lanes: '2', destination: 'Ipoh;Rawang' }), 15);
  const e35 = (o: Tags) => T({ highway: 'motorway', oneway: 'yes', ref: 'E35', name: 'Lebuhraya Demo Timur', toll: 'yes', maxspeed: '90', ...o });
  net.way(['J3', [303, 3360], [318, 3460], [350, 3580], [402, 3710], [462, 3860], [522, 4010], 'K1'], e35({ lanes: '2', destination: 'Kuala Lumpur;Sungai Buloh' }), 15);
  net.way(['K1', [579, 4320], 'J4'], e35({ lanes: '3', 'turn:lanes': 'slight_left|through|through' }), 18);

  // --- Section E: exit 114 diving under Jalan Atas; mainline bridges over it
  net.way(['J4', [591, 4600], 'Bb0'], e35({ lanes: '2', destination: 'Kuala Lumpur;Jalan Duta' }), 15);
  net.way(['Bb0', 'XAm', 'Bb1'], e35({ lanes: '2', bridge: 'yes', layer: '1' }), 15);
  net.way(['Bb1', [600, 5300], [602, 5700]], e35({ lanes: '2' }), 25);
  net.way(['J4', [588.5, 4560], [580, 4620], 'Tn0'], {
    highway: 'motorway_link',
    oneway: 'yes',
    lanes: '1',
    maxspeed: '60',
    destination: 'Sungai Buloh;Kuala Selangor',
    'destination:ref': 'B27',
  }, 10);
  net.way(['Tn0', 'XAr', 'Tn1'], { highway: 'motorway_link', oneway: 'yes', lanes: '1', tunnel: 'yes', layer: '-1', maxspeed: '60' }, 10);
  net.way(['Tn1', [528, 4840], [505, 4930], [470, 5040], [432, 5135], 'T1'], { highway: 'motorway_link', oneway: 'yes', lanes: '1', maxspeed: '60' }, 10);
  net.way(['XA0', 'XAr', 'XAm', 'XA1'], { highway: 'secondary', lanes: '2', name: 'Jalan Atas' }, 25);
  net.way([[100, 5200], 'DEST', 'T1', [800, 5200]], { highway: 'secondary', lanes: '2', name: 'Jalan Sungai Buloh', ref: 'B27', maxspeed: '60' }, 25);

  // Remove the shared node Xam/XAr from the tunnel and bridge ways' crossing: they pass over/under,
  // so the crossing road must not connect to them. Re-create private nodes for the bridge/tunnel ways.
  detachCrossing(net, 'XAm', ['Lebuhraya Demo Timur']);
  detachCrossing(net, 'XAr', ['motorway_link']);

  const frame = new LocalFrame(DEMO_ORIGIN);
  const ll = (n: DNode): LngLat => frame.toLngLat(n.x, n.y);

  // ---------------------------------------------------------- Overpass-shaped data
  const osm: OsmData = {
    ways: net.ways.map((w) => ({
      id: w.id,
      nodes: w.nodes,
      tags: w.tags,
      geometry: w.nodes.map((id) => {
        const p = ll(net.nodes.get(id)!);
        return { lat: p[1], lon: p[0] };
      }),
    })),
    nodes: [...net.nodes.values()]
      .filter((n) => n.tags)
      .map((n) => {
        const p = ll(n);
        return { id: n.id, lat: p[1], lon: p[0], tags: n.tags };
      }),
  };

  // ---------------------------------------------------------- route through the network
  const wayBy = (pred: (w: DWay) => boolean) => net.ways.filter(pred);
  const seq: number[] = [];
  const push = (ids: number[]) => {
    for (const id of ids) if (seq[seq.length - 1] !== id) seq.push(id);
  };
  const between = (w: DWay, a: string | number, b: string | number) => {
    const ia = w.nodes.indexOf(typeof a === 'string' ? net.named.get(a)! : a);
    const ib = w.nodes.indexOf(typeof b === 'string' ? net.named.get(b)! : b);
    return ia <= ib ? w.nodes.slice(ia, ib + 1) : w.nodes.slice(ib, ia + 1).reverse();
  };
  const first = (pred: (w: DWay) => boolean) => wayBy(pred)[0];
  const wP = first((w) => w.nodes[0] === net.named.get('P0'));
  const wA = first((w) => w.nodes[0] === net.named.get('A0'));
  // Start on the first way about 60 m in.
  const startNode = wP.nodes.reduce((best, id) =>
    Math.abs(net.nodes.get(id)!.y + 1900) < Math.abs(net.nodes.get(best)!.y + 1900) ? id : best,
  );
  push(between(wP, startNode, 'Tu0'));
  push(between(first((w) => w.nodes[0] === net.named.get('Tu0')), 'Tu0', 'Tu1'));
  push(between(first((w) => w.nodes[0] === net.named.get('Tu1')), 'Tu1', 'A0'));
  push(between(wA, 'A0', 'J1'));
  push(between(first((w) => w.nodes[0] === net.named.get('J1') && w.tags.highway === 'trunk'), 'J1', 'Fb0'));
  push(between(first((w) => w.tags.bridge === 'yes' && w.tags.ref === '5'), 'Fb0', 'Fb1'));
  push(between(first((w) => w.nodes[0] === net.named.get('Fb1')), 'Fb1', 'M1'));
  push(between(first((w) => w.nodes[0] === net.named.get('M1')), 'M1', 'J2'));
  push(between(first((w) => w.tags.highway === 'motorway_link' && w.nodes[0] === net.named.get('J2')), 'J2', 'M2'));
  push(between(first((w) => w.nodes[0] === net.named.get('M2')), 'M2', 'E_a'));
  push(between(first((w) => w.nodes[0] === net.named.get('E_a')), 'E_a', 'E_b'));
  push(between(first((w) => w.nodes[0] === net.named.get('E_b')), 'E_b', 'J3'));
  push(between(first((w) => w.nodes[0] === net.named.get('J3') && w.tags.ref === 'E35'), 'J3', 'K1'));
  push(between(first((w) => w.nodes[0] === net.named.get('K1')), 'K1', 'J4'));
  push(between(first((w) => w.nodes[0] === net.named.get('J4') && w.tags.highway === 'motorway_link'), 'J4', 'Tn0'));
  push(between(first((w) => w.tags.tunnel === 'yes' && w.tags.highway === 'motorway_link'), 'Tn0', 'Tn1'));
  push(between(first((w) => w.nodes[0] === net.named.get('Tn1')), 'Tn1', 'T1'));
  push(between(first((w) => w.tags.name === 'Jalan Sungai Buloh'), 'T1', 'DEST'));

  const coords = seq.map((id) => ll(net.nodes.get(id)!));
  const xy = seq.map((id) => {
    const n = net.nodes.get(id)!;
    return [n.x, n.y] as XY;
  });
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));

  // Adjacency for intersection bearings.
  const adj = new Map<number, { to: number; canEnter: boolean }[]>();
  for (const w of net.ways) {
    const ow = w.tags.oneway === 'yes' || w.tags.highway === 'motorway' || w.tags.highway === 'motorway_link';
    for (let i = 0; i < w.nodes.length - 1; i++) {
      const a = w.nodes[i];
      const b = w.nodes[i + 1];
      (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, canEnter: true });
      (adj.get(b) ?? adj.set(b, []).get(b)!).push({ to: a, canEnter: !ow });
    }
  }
  const nodeXY = (id: number): XY => {
    const n = net.nodes.get(id)!;
    return [n.x, n.y];
  };

  interface StepDef {
    at: string | number;
    type: string;
    modifier?: string;
    name: string;
    ref?: string;
    destinations?: string;
    exits?: string;
    lanes?: { indications: string[]; valid: boolean }[];
    speed: number;
    classes?: string[];
    /** Intersections passed along the step where the road class changes (OSRM lists these). */
    along?: { at: string; classes?: string[] }[];
  }
  const L = (ind: string, valid: boolean) => ({ indications: [ind], valid });
  const defs: StepDef[] = [
    {
      at: startNode,
      type: 'depart',
      name: 'Jalan Demo',
      ref: '5',
      speed: 21,
      along: [{ at: 'Tu0', classes: ['tunnel'] }, { at: 'Tu1' }],
    },
    {
      at: 'J1',
      type: 'fork',
      modifier: 'slight right',
      name: 'Jejantas Demo',
      ref: '5',
      destinations: 'Kuala Lumpur, Lebuhraya Demo',
      lanes: [L('slight left', false), L('straight', true), L('straight', true)],
      speed: 16,
    },
    {
      at: 'J2',
      type: 'on ramp',
      modifier: 'slight right',
      name: '',
      destinations: 'E1: Kuala Lumpur, Ipoh',
      lanes: [L('straight', false), L('straight', false), L('slight right', true)],
      speed: 16,
    },
    { at: 'M2', type: 'merge', modifier: 'slight right', name: 'Lebuhraya Demo', ref: 'E1', speed: 27, classes: ['motorway', 'toll'] },
    {
      at: 'J3',
      type: 'fork',
      modifier: 'slight right',
      name: 'Lebuhraya Demo Timur',
      ref: 'E35',
      destinations: 'E35: Kuala Lumpur, Sungai Buloh',
      lanes: [L('slight left', false), L('slight left', false), L('slight right', true), L('slight right', true)],
      speed: 27,
      classes: ['motorway', 'toll'],
    },
    {
      at: 'J4',
      type: 'off ramp',
      modifier: 'slight left',
      name: '',
      exits: '114',
      destinations: 'B27: Sungai Buloh, Kuala Selangor',
      lanes: [L('slight left', true), L('straight', false), L('straight', false)],
      speed: 17,
      classes: ['motorway', 'toll'],
    },
    { at: 'T1', type: 'end of road', modifier: 'left', name: 'Jalan Sungai Buloh', ref: 'B27', speed: 12 },
    { at: 'DEST', type: 'arrive', name: 'Jalan Sungai Buloh', speed: 1 },
  ];

  const steps = defs.map((d, k) => {
    const nodeId = typeof d.at === 'string' ? net.named.get(d.at)! : d.at;
    const idx = seq.indexOf(nodeId);
    const nextIdx = k < defs.length - 1 ? seq.indexOf(typeof defs[k + 1].at === 'string' ? net.named.get(defs[k + 1].at as string)! : (defs[k + 1].at as number)) : idx;
    const dist = cum[nextIdx] - cum[idx];
    const here = nodeXY(nodeId);
    const brg = (id: number) => {
      const p = nodeXY(id);
      return Math.round(xyBearing(p[0] - here[0], p[1] - here[1]));
    };
    const prev = idx > 0 ? seq[idx - 1] : null;
    const next = idx < seq.length - 1 ? seq[idx + 1] : null;
    const nb = adj.get(nodeId) ?? [];
    const bearings = nb.map((e) => brg(e.to));
    const order = bearings.map((b, i) => [b, i]).sort((a, b) => a[0] - b[0]);
    const sortedB = order.map((o) => o[0]);
    const sortedE = order.map((o) => nb[o[1]].canEnter);
    const inIdx = prev != null ? order.findIndex((o) => nb[o[1]].to === prev) : undefined;
    const outIdx = next != null ? order.findIndex((o) => nb[o[1]].to === next) : undefined;
    const bb = prev != null ? brg(prev) : 0;
    return {
      distance: dist,
      duration: d.type === 'arrive' ? 0 : dist / d.speed,
      name: d.name,
      ref: d.ref,
      destinations: d.destinations,
      exits: d.exits,
      mode: 'driving',
      driving_side: 'left' as const,
      maneuver: {
        type: d.type,
        modifier: d.modifier,
        location: coords[idx],
        bearing_before: prev != null ? (bb + 180) % 360 : 0,
        bearing_after: next != null ? brg(next) : 0,
      },
      intersections: [
        {
          location: coords[idx],
          bearings: sortedB,
          entry: sortedE,
          in: inIdx != null && inIdx >= 0 ? inIdx : undefined,
          out: outIdx != null && outIdx >= 0 ? outIdx : undefined,
          lanes: d.lanes,
          classes: d.classes,
        },
        ...(d.along ?? []).map((a) => {
          const id = net.named.get(a.at)!;
          const i = seq.indexOf(id);
          const p = nodeXY(id);
          const b = (n: number) => {
            const q = nodeXY(n);
            return Math.round(xyBearing(q[0] - p[0], q[1] - p[1]));
          };
          const bIn = b(seq[i - 1]);
          const bOut = b(seq[i + 1]);
          const inFirst = bIn <= bOut;
          return {
            location: coords[i],
            bearings: inFirst ? [bIn, bOut] : [bOut, bIn],
            entry: inFirst ? [false, true] : [true, false],
            in: inFirst ? 0 : 1,
            out: inFirst ? 1 : 0,
            classes: a.classes,
          };
        }),
      ],
    };
  });
  const distance = cum[cum.length - 1];
  const duration = steps.reduce((a, s) => a + s.duration, 0);
  const osrm: OsrmResponse = {
    code: 'Ok',
    routes: [
      {
        distance,
        duration,
        geometry: { type: 'LineString', coordinates: coords },
        legs: [{ steps, summary: 'Jalan Demo, Lebuhraya Demo', distance, duration }],
      },
    ],
  };

  // ---------------------------------------------------------- demo map GeoJSON
  // Bukit Demo: the wooded hill the tunnel runs through.
  const hill: XY[] = [];
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2;
    const r = 1 + 0.12 * Math.sin(a * 3 + 0.6) + 0.07 * Math.cos(a * 5);
    hill.push([7 + Math.cos(a) * 330 * r, -400 + Math.sin(a) * 300 * r]);
  }
  hill.push(hill[0]);
  const geojson: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { natural: 'wood', name: 'Bukit Demo' },
        geometry: { type: 'Polygon', coordinates: [hill.map(([x, y]) => frame.toLngLat(x, y))] },
      },
      ...net.ways.map((w) => ({
        type: 'Feature' as const,
        properties: { ...w.tags, layer: Number(w.tags.layer ?? 0) },
        geometry: { type: 'LineString' as const, coordinates: w.nodes.map((id) => ll(net.nodes.get(id)!)) },
      })),
    ],
  };
  const xs = [...net.nodes.values()].map((n) => ll(n));
  const bounds: [LngLat, LngLat] = [
    [Math.min(...xs.map((p) => p[0])), Math.min(...xs.map((p) => p[1]))],
    [Math.max(...xs.map((p) => p[0])), Math.max(...xs.map((p) => p[1]))],
  ];
  const poiDefs: [string, number, number, Tags][] = [
    ['fuel', -32, 520, { amenity: 'fuel', name: 'Stesen Minyak Jalan Demo' }],
    ['store', -28, 1250, { shop: 'convenience', name: 'Kedai Serbaneka Demo' }],
    ['rest', 504, 3797, { highway: 'services', name: 'R&R Demo Timur' }],
    ['fuel', 484, 3838, { amenity: 'fuel', name: 'Stesen Minyak R&R Demo' }],
    ['ev', 515, 3846, { amenity: 'charging_station', name: 'Pengecas EV R&R Demo' }],
    ['food', 520, 3790, { amenity: 'food_court', name: 'Medan Selera R&R Demo' }],
    ['food', 238, 5172, { amenity: 'restaurant', name: 'Restoran Sungai Buloh' }],
    ['parking', 262, 5232, { amenity: 'parking', name: 'Parkir Sungai Buloh' }],
    ['store', 410, 5175, { shop: 'convenience', name: 'Kedai Serbaneka Sungai Buloh' }],
  ];
  const pois: DemoPoi[] = poiDefs.map(([cat, x, y, tags], i) => ({ id: `node/${900 + i}`, cat, lngLat: frame.toLngLat(x, y), tags }));
  const spot = (name: string, sub: string, x: number, y: number): DemoSpot => ({ name, sub, lngLat: frame.toLngLat(x, y) });
  const at = (n: string) => net.at(n);
  const spots: DemoSpot[] = [
    spot('Sungai Buloh', 'Demo destination · Jalan Sungai Buloh', ...at('DEST')),
    spot('Sungai Buloh Interchange (Exit 114)', 'Lebuhraya Demo Timur E35', ...at('J4')),
    spot('JCT Demo (E1 / E35)', 'Lebuhraya Demo E1', ...at('J3')),
    spot('Lebuhraya Demo E1 entrance', 'Jalan Demo', ...at('J2')),
    spot('Jejantas Demo (flyover)', 'Jalan Demo', 2.5, 990),
    spot('Jalan Kampung', 'Junction with Jalan Demo', ...at('X1')),
    spot('Jalan Atas', 'Crosses over the exit 114 ramp', 545, 4720),
    spot('Lebuhraya Demo Timur E35', 'Expressway', 470, 3880),
    spot('Terowong Bukit Demo', 'Tunnel on Jalan Demo · 500 m', 0, -400),
    spot('Jalan Demo', 'Demo start', 0, -1900),
  ];
  // The plaza sits on the E1 entrance ramp, as Malaysian expressway entrances do.
  const tolls = [{ id: 'demo/toll', at: frame.toLngLat(130, 2160), name: 'Plaza Tol Demo' }];
  // A speed camera on E35 (on its road, so it counts for this direction only), and an average
  // speed check over the E1 stretch from the merge to the JCT.
  const e35Way = osm.ways.find((w) => w.tags.ref === 'E35' && w.nodes[0] === net.named.get('J3'))!;
  const speed: SpeedData = {
    ways: osm.ways.filter((w) => w.tags.maxspeed).map((w) => ({ id: `demo/${w.id}`, coords: w.geometry.map((g) => [g.lon, g.lat] as LngLat), tags: w.tags })),
    cameras: [{ id: 'demo/cam', at: frame.toLngLat(462, 3860), tags: { highway: 'speed_camera', maxspeed: '90' }, road: { coords: e35Way.geometry.map((g) => [g.lon, g.lat] as LngLat), oneway: 1 } }],
    checks: [{ id: 'demo/avg', tags: { type: 'enforcement', enforcement: 'average_speed', maxspeed: '110' }, devices: [], from: [frame.toLngLat(300, 2470)], to: [frame.toLngLat(300, 3240)] }],
  };
  cached = { pois, spots, osm, osrm, geojson, start: coords[0], end: coords[coords.length - 1], bounds, tolls, speed, southCamera: frame.toLngLat(330, 2400) };
  return cached;
}

/** Give bridge/tunnel ways their own node where they cross another road, so they do not connect. */
function detachCrossing(net: Net, nodeName: string, keepOn: string[]) {
  const id = net.named.get(nodeName)!;
  const n = net.nodes.get(id)!;
  for (const w of net.ways) {
    const i = w.nodes.indexOf(id);
    if (i < 0) continue;
    const isStructure = w.tags.bridge === 'yes' || w.tags.tunnel === 'yes';
    const matches = keepOn.some((k) => w.tags.name === k || w.tags.highway === k);
    if (isStructure && matches) {
      w.nodes[i] = net.node(null, n.x, n.y);
    }
  }
}
