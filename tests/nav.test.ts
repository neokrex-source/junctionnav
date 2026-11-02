import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/demo/network';
import { haversine, Polyline, angleDiff, type LngLat } from '../src/geo/geo';
import { detectJunctions } from '../src/junction/detect';
import { buildOverpassQuery, parseOverpass } from '../src/junction/osmdata';
import { NavEngine } from '../src/nav/engine';
import { describeStep, formatDistance, spokenInstruction } from '../src/routing/instructions';
import { normalizeOsrm, OsrmRouter } from '../src/routing/osrm';
import { parseDestinations } from '../src/routing/types';
import { parseCoordinates } from '../src/search/places';

const demo = buildDemo();
const route = () => normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];

describe('geo', () => {
  it('measures distance and projects onto a line', () => {
    const a: LngLat = [101.0, 3.0];
    const b: LngLat = [101.01, 3.0];
    expect(haversine(a, b)).toBeGreaterThan(1100);
    expect(haversine(a, b)).toBeLessThan(1120);
    const line = new Polyline([a, b]);
    const p = line.project([101.005, 3.0005]);
    expect(p.s).toBeGreaterThan(550);
    expect(p.s).toBeLessThan(560);
    expect(p.dist).toBeGreaterThan(50);
    expect(p.dist).toBeLessThan(60);
  });
  it('signs angle differences', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
  });
});

describe('routing', () => {
  it('parses OSRM destinations', () => {
    expect(parseDestinations('E1, AH2: Ipoh, Kuala Lumpur')).toEqual({ refs: ['E1', 'AH2'], places: ['Ipoh', 'Kuala Lumpur'] });
    expect(parseDestinations('Klang')).toEqual({ refs: [], places: ['Klang'] });
  });
  it('builds an OSRM URL with heading, stops and exclusions', () => {
    const r = new OsrmRouter('https://example.org/route/v1/driving/');
    const url = r.buildUrl({ origin: [101.1, 3.1], destination: [101.2, 3.2], bearing: 92.4, alternatives: true }, ['tolls', 'ferries']);
    expect(url).toContain('/route/v1/driving/101.100000,3.100000;101.200000,3.200000?');
    expect(url).toContain('bearings=92%2C60%3B');
    expect(url).toContain('exclude=toll%2Cferry');
    expect(url).toContain('alternatives=3');
    const via = r.buildUrl({ origin: [101.1, 3.1], via: [[101.15, 3.15]], destination: [101.2, 3.2], bearing: 10, alternatives: true }, []);
    expect(via).toContain('101.150000,3.150000;101.200000');
    expect(via).toContain('alternatives=false');
    expect(via).toContain('bearings=10%2C60%3B%3B');
  });
  it('normalizes steps with monotonic positions', () => {
    const r = route();
    expect(r.steps.length).toBe(8);
    for (let i = 1; i < r.steps.length; i++) expect(r.steps[i].s).toBeGreaterThan(r.steps[i - 1].s);
    expect(r.hasToll).toBe(true);
  });
  it('writes instructions in three languages', () => {
    const r = route();
    const exit = r.steps.find((s) => s.type === 'off ramp')!;
    expect(describeStep(exit, 'en').action).toBe('Take exit 114 on the left toward Sungai Buloh / Kuala Selangor');
    expect(describeStep(exit, 'ms').action).toContain('susur keluar 114');
    expect(describeStep(exit, 'ja').action).toContain('出口です');
    expect(spokenInstruction(exit, 1000, 'en', 'metric')).toBe('In 1 kilometre, take exit 114 on the left toward Sungai Buloh / Kuala Selangor');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatDistance(437)).toBe('450 m');
  });
});

describe('junction data', () => {
  it('builds one Overpass query for several junctions', () => {
    const q = buildOverpassQuery([[101.1, 3.1], [101.2, 3.2]], 300);
    expect(q.match(/way\(around:300/g)?.length).toBe(2);
    expect(q).toContain('out body geom;');
    expect(q).toContain('motorway_junction');
  });
  it('parses Overpass JSON', () => {
    const d = parseOverpass({
      elements: [
        { type: 'way', id: 1, nodes: [1, 2], geometry: [{ lat: 3, lon: 101 }, { lat: 3.001, lon: 101 }], tags: { highway: 'motorway' } },
        { type: 'node', id: 5, lat: 3, lon: 101, tags: { highway: 'motorway_junction', ref: '12' } },
      ],
    });
    expect(d.ways.length).toBe(1);
    expect(d.nodes[0].tags?.ref).toBe('12');
  });
});

describe('navigation engine', () => {
  it('tracks progress, junction windows and prompts along the demo route', () => {
    const r = route();
    const js = detectJunctions(r);
    const eng = new NavEngine();
    eng.setRoute(r, js);
    const spoken: string[] = [];
    let sawJunction = 0;
    for (let s = 0; s <= r.line.length; s += 10) {
      const p = eng.update({ lngLat: r.line.pointAt(s), accuracy: 5, heading: r.line.bearingAt(s), speed: 25, time: s })!;
      expect(p.onRoute).toBe(true);
      expect(Math.abs(p.s - s)).toBeLessThan(2);
      if (p.junction) sawJunction++;
      for (const pr of eng.prompts(p)) if (pr.kind === 'maneuver') spoken.push(spokenInstruction(pr.step, pr.distance, 'en', 'metric'));
    }
    expect(sawJunction).toBeGreaterThan(100);
    expect(spoken.some((t) => t.startsWith('In 1 kilometre, take exit 114'))).toBe(true);
    expect(spoken.filter((t) => t.includes('exit 114')).length).toBeLessThanOrEqual(4);
    expect(eng.progress?.arrived).toBe(true);
  });

  it('flags off-route after repeated far fixes', () => {
    const r = route();
    const eng = new NavEngine();
    eng.setRoute(r, []);
    const far: LngLat = [r.geometry[0][0] + 0.01, r.geometry[0][1]];
    let p = null;
    for (let i = 0; i < 4; i++) p = eng.update({ lngLat: far, accuracy: 8, heading: 0, speed: 10, time: i * 1000 });
    expect(p!.offRoute).toBe(true);
  });
});

describe('search', () => {
  it('accepts typed coordinates', () => {
    expect(parseCoordinates('3.139, 101.6869')).toEqual([101.6869, 3.139]);
    expect(parseCoordinates('Kuala Lumpur')).toBeNull();
  });
});
