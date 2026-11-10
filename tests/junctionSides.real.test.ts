/**
 * Does the junction view put your branch on the side the route goes? On the real Peninsular
 * Malaysia pack (PACK_DIR, as on GitHub Actions): routes around KL and Perak from the offline
 * router, every split where the route keeps or exits left or right, and the side the view draws
 * the route's lanes on (left or right of the other branch) against the route's own maneuver.
 *
 * Each junction is checked as OpenStreetMap plans it, and as TomTom would hand it over: the same
 * maneuvers turned into a TomTom answer (src/tomtom/routing.ts reads it), with the line drawn up
 * to ~8 m to the side and the maneuver point 25 m early or late (TomTom's map is not
 * OpenStreetMap's), with and without lane data. Prints a table and fails on a wrong side.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { destination, LocalFrame, Polyline, type LngLat } from '../src/geo/geo';
import { detectJunctions } from '../src/junction/detect';
import { buildScene, type JunctionScene } from '../src/junction/scene';
import { OfflineGraph } from '../src/offline/graph';
import { junctionData } from '../src/offline/queries';
import { OfflineRouter } from '../src/offline/router';
import { normalizeOsrm } from '../src/routing/osrm';
import type { Route, Step } from '../src/routing/types';
import { normalizeTomTom, type TtInstruction, type TtRouteResponse, type TtSection } from '../src/tomtom/routing';

const dir = process.env.PACK_DIR;
const ab = (f: string) => {
  const b = readFileSync(join(dir!, f));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const TRIPS: [string, LngLat, LngLat][] = [
  ['KLCC to KLIA', [101.7119, 3.1578], [101.7099, 2.7456]],
  ['Mid Valley to Sunway', [101.6772, 3.1181], [101.607, 3.0731]],
  ['Bangsar South to Wangsa Maju', [101.6656, 3.111], [101.7316, 3.205]],
  ['Putrajaya to Cyberjaya', [101.6939, 2.9264], [101.655, 2.9213]],
  ['UTP to Ipoh', [100.9786, 4.385], [101.0829, 4.5975]],
  ['Ampang to Cheras', [101.7576, 3.1593], [101.736, 3.09]],
  ['Damansara to Kepong', [101.6195, 3.1365], [101.638, 3.214]],
  ['Shah Alam to Klang', [101.5183, 3.0733], [101.4455, 3.0449]],
  ['Jalan Duta to Sungai Buloh', [101.67, 3.172], [101.565, 3.205]],
  ['DASH to Penchala', [101.59416, 3.15696], [101.6462, 3.16528]],
  ['MEX to Tun Razak', [101.71169, 3.11065], [101.72285, 3.15033]],
  ['DUKE to Wangsa Maju', [101.7186, 3.18325], [101.73602, 3.2016]],
  ['Sungai Besi to SUKE', [101.71294, 3.02373], [101.7059, 3.06608]],
  ['Klang to KLCC', [101.4455, 3.0449], [101.7119, 3.1578]],
  ['Subang to Petaling Jaya', [101.5497, 3.1306], [101.6424, 3.1073]],
];

const sideOf = (m: string | undefined): 'left' | 'right' | null => (m?.includes('left') ? 'left' : m?.includes('right') ? 'right' : null);

/** Where the view draws the route's lanes: left or right of the other branches (null: no other branch). */
function viewSide(sc: JunctionScene): 'left' | 'right' | 'middle' | null {
  const taken = sc.signs.find((s) => s.taken);
  const others = sc.signs.filter((s) => !s.taken);
  if (!taken || !others.length) return null;
  const lats = others.map((s) => s.lateral);
  if (taken.lateral < Math.min(...lats) - 0.01) return 'left';
  if (taken.lateral > Math.max(...lats) + 0.01) return 'right';
  return 'middle';
}

/* ------------------------------------------------------------------ TomTom's version */

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

/** The line as another map would draw it: up to ~8 m to either side, wandering slowly. */
function drawnApart(line: LngLat[], seed: number): LngLat[] {
  const r = rng(seed);
  const [p1, p2] = [r() * 6.3, r() * 6.3];
  const pl = new Polyline(line);
  const out: LngLat[] = [];
  for (let s = 0; s <= pl.length; s += 10) {
    const off = 4.5 * Math.sin((2 * Math.PI * s) / 600 + p1) + 3 * Math.sin((2 * Math.PI * s) / 210 + p2);
    out.push(destination(pl.pointAt(s), pl.bearingAt(s, 10) + 90, off));
  }
  out.push(line[line.length - 1]);
  return out;
}

function ttManeuver(st: Step): Partial<TtInstruction> {
  const m = st.modifier ?? 'straight';
  const lr = m.includes('left') ? 'LEFT' : m.includes('right') ? 'RIGHT' : '';
  const angle = m === 'straight' ? 0 : (lr === 'LEFT' ? -1 : 1) * (m.startsWith('slight') ? 30 : m.startsWith('sharp') ? 135 : m === 'uturn' ? 180 : 90);
  switch (st.type) {
    case 'depart':
      return { maneuver: 'DEPART', instructionType: 'LOCATION_DEPARTURE' };
    case 'arrive':
      return { maneuver: 'ARRIVE', instructionType: 'LOCATION_ARRIVAL' };
    case 'fork':
      return lr ? { maneuver: `KEEP_${lr}`, junctionType: 'BIFURCATION', turnAngleInDecimalDegrees: angle } : { maneuver: 'STRAIGHT', junctionType: 'BIFURCATION', turnAngleInDecimalDegrees: 0 };
    case 'off ramp':
      return { maneuver: lr ? `MOTORWAY_EXIT_${lr}` : 'TAKE_EXIT', turnAngleInDecimalDegrees: angle };
    case 'on ramp':
      return { maneuver: 'ENTER_MOTORWAY', turnAngleInDecimalDegrees: angle };
    default:
      if (!lr) return { maneuver: 'STRAIGHT', turnAngleInDecimalDegrees: 0 };
      return { maneuver: m.startsWith('slight') ? `BEAR_${lr}` : m.startsWith('sharp') ? `SHARP_${lr}` : m === 'uturn' ? 'MAKE_UTURN' : `TURN_${lr}`, turnAngleInDecimalDegrees: angle };
  }
}

/**
 * The route as TomTom would answer it: `apart` draws the line to the side, `shift` moves the
 * maneuver points along the route, `lanes` passes the lane data on.
 */
function asTomTom(route: Route, o: { apart: boolean; shift: number; lanes: boolean; seed: number }): Route {
  const geometry = o.apart ? drawnApart(route.geometry, o.seed) : route.geometry;
  const line = new Polyline(geometry);
  const pts = geometry.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
  const nearestIdx = (p: LngLat) => {
    const pr = line.project(p);
    let i = line.segmentAt(pr.s);
    if (line.cum[i + 1] - pr.s < pr.s - line.cum[i]) i++;
    return i;
  };
  const sections: TtSection[] = [];
  const instructions: TtInstruction[] = route.steps.map((st, k) => {
    const last = k === route.steps.length - 1;
    const s = st.type === 'depart' ? 0 : last ? route.line.length : Math.max(0, Math.min(route.line.length, st.s + o.shift));
    const at = route.line.pointAt(s);
    const idx = st.type === 'depart' ? 0 : last ? pts.length - 1 : nearestIdx(at);
    const lanes = st.intersections[0]?.lanes;
    if (o.lanes && lanes && lanes.length >= 2 && idx > 2) {
      const dirOf = (d: string) => ({ straight: 'STRAIGHT', 'slight right': 'SLIGHT_RIGHT', right: 'RIGHT', 'sharp right': 'SHARP_RIGHT', uturn: 'LEFT_U_TURN', 'slight left': 'SLIGHT_LEFT', left: 'LEFT', 'sharp left': 'SHARP_LEFT' })[d] ?? 'STRAIGHT';
      const follow = dirOf(st.modifier ?? 'straight');
      sections.push({ startPointIndex: Math.max(0, idx - 3), endPointIndex: idx, sectionType: 'LANES', lanes: lanes.map((l) => ({ directions: l.indications.map(dirOf), ...(l.valid ? { follow } : {}) })) });
    }
    return {
      point: pts[idx],
      pointIndex: idx,
      routeOffsetInMeters: Math.round(line.cum[idx]),
      travelTimeInSeconds: Math.round(line.cum[idx] / 15),
      street: st.name,
      roadNumbers: st.ref ? st.ref.split(';') : undefined,
      drivingSide: 'LEFT',
      ...ttManeuver(st),
    } as TtInstruction;
  });
  const json: TtRouteResponse = {
    routes: [
      {
        summary: { lengthInMeters: Math.round(line.length), travelTimeInSeconds: Math.round(route.duration) },
        legs: [{ summary: { lengthInMeters: Math.round(line.length), travelTimeInSeconds: Math.round(route.duration) }, points: pts }],
        sections,
        guidance: { instructions },
      },
    ],
  };
  return normalizeTomTom(json)[0];
}

/* ------------------------------------------------------------------ the check */

describe.skipIf(!dir)('junction views put the route on its side', () => {
  const G = dir ? new OfflineGraph(ab('graph.bin')) : (null as unknown as OfflineGraph);
  const router = dir ? new OfflineRouter(G) : (null as unknown as OfflineRouter);

  it('routes around KL and Perak, as OpenStreetMap and as TomTom would plan them', () => {
    const variants = [
      { id: 'osm', label: 'OpenStreetMap route' },
      { id: 'tt', label: 'TomTom, same line', apart: false, shift: 0, lanes: true },
      { id: 'tt-apart', label: 'TomTom, line 8 m off, no lanes', apart: true, shift: 0, lanes: false },
      { id: 'tt-early', label: 'TomTom, off and 25 m early', apart: true, shift: -25, lanes: false },
      { id: 'tt-late', label: 'TomTom, off and 25 m late', apart: true, shift: 25, lanes: true },
    ] as const;
    type Tally = { n: number; osm: number; right: number; wrong: number; unsure: number; far: number };
    const tally = new Map<string, Tally>(variants.map((v) => [v.id, { n: 0, osm: 0, right: 0, wrong: 0, unsure: 0, far: 0 }]));
    const lines: string[] = ['JUNCTION SIDES'];
    const wrongs: string[] = [];
    let seed = 11;
    for (const [name, a, b] of TRIPS) {
      const res = router.route({ coords: [a, b], bearings: [null, null] });
      if (res.code !== 'Ok') {
        lines.push(`  ${name}: no route (${res.message})`);
        continue;
      }
      const route = normalizeOsrm(res, 'Offline')[0];
      const tt = Object.fromEntries(variants.filter((v) => v.id !== 'osm').map((v) => [v.id, asTomTom(route, { apart: 'apart' in v && v.apart, shift: 'shift' in v ? v.shift : 0, lanes: 'lanes' in v && v.lanes, seed: seed++ })])) as Record<string, Route>;
      const js = detectJunctions(route);
      lines.push(`  ${name}: ${(route.distance / 1000).toFixed(1)} km, ${js.length} junction views`);
      for (const j of js) {
        const step = route.steps[j.stepIndex];
        const want = sideOf(step.modifier);
        if (!want || j.kind === 'merge') continue;
        const row: string[] = [];
        for (const v of variants) {
          const r = v.id === 'osm' ? route : tt[v.id];
          const cand = v.id === 'osm' ? j : detectJunctions(r).find((c) => c.stepIndex === j.stepIndex);
          const t = tally.get(v.id)!;
          if (!cand) {
            row.push(`${v.id}:none`);
            continue;
          }
          t.n++;
          const sc = buildScene(r, cand, junctionData(G, [cand.location], 450));
          if (sc.source === 'osm') t.osm++;
          // Where the view's split lies against OpenStreetMap's (metres along the route).
          const split = (sc as JunctionScene & { shift?: number }).shift ?? 0;
          const at = r.line.pointAt(cand.s + split);
          const far = new LocalFrame(at).toXY(route.line.pointAt(j.s));
          if (Math.hypot(far[0], far[1]) > 15) t.far++;
          const got = viewSide(sc);
          if (got === want) t.right++;
          else if (got === null || got === 'middle') t.unsure++;
          else {
            t.wrong++;
            wrongs.push(`${name} ${(j.s / 1000).toFixed(2)} km ${j.kind} ${step.type}/${step.modifier} ${v.id}: drawn ${got} (${sc.source}) at ${j.location[1].toFixed(5)},${j.location[0].toFixed(5)}`);
          }
          row.push(`${v.id}:${got ?? '-'}/${sc.source[0]}`);
        }
        lines.push(`    ${(j.s / 1000).toFixed(2).padStart(6)} km ${j.kind.padEnd(5)} ${step.type}/${step.modifier} want ${want}  ${row.join('  ')}`);
      }
    }
    lines.push('', '  variant                          views  from OSM  right side  wrong side  unsure  split >15 m off');
    for (const v of variants) {
      const t = tally.get(v.id)!;
      lines.push(`  ${v.label.padEnd(32)} ${String(t.n).padStart(5)}  ${String(t.osm).padStart(8)}  ${String(t.right).padStart(10)}  ${String(t.wrong).padStart(10)}  ${String(t.unsure).padStart(6)}  ${String(t.far).padStart(6)}`);
    }
    if (wrongs.length) lines.push('', '  WRONG SIDE:', ...wrongs.map((w) => `    ${w}`));
    console.log(lines.join('\n'));
    expect(tally.get('osm')!.n).toBeGreaterThan(20);
    expect(wrongs, 'junction views with the route on the wrong side').toEqual([]);
  }, 300_000);
});
