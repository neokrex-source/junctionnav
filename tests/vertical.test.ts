import { describe, expect, it } from 'vitest';
import { LocalFrame, type XY } from '../src/geo/geo';
import type { OsmData, OsmWay } from '../src/junction/osmdata';
import { parseHeight, VerticalModel } from '../src/junction/vertical';

const frame = new LocalFrame([101.6, 3.1]);
let nextNode = 1;
let nextWay = 1;
const shared = new Map<string, number>();

/** A way through local points; points named with a string are shared between ways. */
function way(pts: (XY | string)[], tags: Record<string, string>, named: Record<string, XY> = {}): OsmWay {
  const nodes: number[] = [];
  const geometry: { lat: number; lon: number }[] = [];
  for (const p of pts) {
    const xy = typeof p === 'string' ? named[p] : p;
    let id: number;
    if (typeof p === 'string') {
      id = shared.get(p) ?? nextNode++;
      shared.set(p, id);
    } else id = nextNode++;
    const [lon, lat] = frame.toLngLat(xy[0], xy[1]);
    nodes.push(id);
    geometry.push({ lat, lon });
  }
  return { id: nextWay++, nodes, geometry, tags };
}

/** Max grade along a polyline sampled from the model (rise over run). */
function maxGrade(m: VerticalModel, from: XY, to: XY, tags: (p: XY) => Record<string, string>, step = 10): number {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  let worst = 0;
  let prev = m.heightAt(from, tags(from));
  for (let d = step; d <= len; d += step) {
    const p: XY = [from[0] + ((to[0] - from[0]) * d) / len, from[1] + ((to[1] - from[1]) * d) / len];
    const h = m.heightAt(p, tags(p));
    worst = Math.max(worst, Math.abs(h - prev) / step);
    prev = h;
  }
  return worst;
}

describe('road heights', () => {
  it('reads signed headroom', () => {
    expect(parseHeight('5')).toBe(5);
    expect(parseHeight('5.4 m')).toBe(5.4);
    expect(parseHeight("16'6\"")).toBeCloseTo(5.03, 2);
    expect(parseHeight('default')).toBeNull();
  });

  it('lifts a flyover over the road it crosses, with drivable embankments', () => {
    const cross = { highway: 'primary', name: 'Jalan Bawah' };
    const fly = { highway: 'trunk', oneway: 'yes', name: 'Jejantas', bridge: 'yes', layer: '1' };
    const road = { highway: 'trunk', oneway: 'yes', name: 'Jalan Atas' };
    const named = { s: [0, -110] as XY, n: [0, 110] as XY };
    const osm: OsmData = {
      ways: [
        way([[-400, 0], [400, 0]], cross),
        way([[0, -500], 's'], road, named),
        way(['s', 'n'], fly, named),
        way(['n', [0, 500]], road, named),
      ],
      nodes: [],
    };
    const m = new VerticalModel(osm, frame);
    expect(m.heightAt([0, 0], fly)).toBeCloseTo(6.8, 1);
    expect(m.heightAt([0, 0], cross)).toBeCloseTo(0, 5);
    expect(m.heightAt([0, 330], road)).toBeCloseTo(0, 5);
    expect(m.heightAt([0, -330], road)).toBeCloseTo(0, 5);
    expect(maxGrade(m, [0, -450], [0, 450], (p) => (Math.abs(p[1]) <= 110 ? fly : road))).toBeLessThanOrEqual(0.046);
    expect(m.crossings[0].clearance).toBeCloseTo(6.8, 1);
  });

  it('uses the signed headroom of the road below', () => {
    const cross = { highway: 'secondary', maxheight: '5.0' };
    const fly = { highway: 'primary', bridge: 'yes', layer: '1' };
    const osm: OsmData = { ways: [way([[-300, 0], [300, 0]], cross), way([[0, -300], [0, 300]], fly)], nodes: [] };
    const m = new VerticalModel(osm, frame);
    expect(m.heightAt([0, 0], fly)).toBeCloseTo(6.3, 1);
  });

  it('keeps the expressway level where an exit ramp climbs onto a flyover', () => {
    const main = { highway: 'motorway', oneway: 'yes', ref: 'E1' };
    const ramp = { highway: 'motorway_link', oneway: 'yes' };
    const rampBridge = { highway: 'motorway_link', oneway: 'yes', bridge: 'yes', layer: '1' };
    const under = { highway: 'primary', name: 'Jalan Bawah' };
    const named = { j: [0, 0] as XY, b0: [40, 120] as XY, b1: [90, 260] as XY };
    const osm: OsmData = {
      ways: [
        way([[0, -500], 'j', [0, 600]], main, named),
        way(['j', [12, 60], 'b0'], ramp, named),
        way(['b0', 'b1'], rampBridge, named),
        way(['b1', [130, 400]], ramp, named),
        way([[-200, 190], [400, 190]], under),
      ],
      nodes: [],
    };
    const m = new VerticalModel(osm, frame);
    expect(m.heightAt([0, 0], main)).toBeCloseTo(0, 5);
    expect(m.heightAt([0, 200], main)).toBeCloseTo(0, 5);
    // The ramp starts at the expressway and climbs to clear the road below.
    expect(m.heightAt([6, 30], ramp)).toBeLessThan(2.5);
    const atCrossing = m.crossings.find((c) => c.upper === rampBridge)!;
    expect(atCrossing.clearance).toBeGreaterThan(6.6);
    expect(m.structureAt(atCrossing.at, rampBridge)).toBeGreaterThan(6.6);
  });

  it('sinks an underpass below the road above it', () => {
    const top = { highway: 'secondary', name: 'Jalan Atas' };
    const under = { highway: 'primary', tunnel: 'yes', layer: '-1' };
    const road = { highway: 'primary' };
    const named = { a: [0, -60] as XY, b: [0, 60] as XY };
    const osm: OsmData = {
      ways: [way([[-300, 0], [300, 0]], top), way([[0, -400], 'a'], road, named), way(['a', 'b'], under, named), way(['b', [0, 400]], road, named)],
      nodes: [],
    };
    const m = new VerticalModel(osm, frame);
    expect(m.heightAt([0, 0], under)).toBeCloseTo(-6.8, 1);
    expect(m.heightAt([0, 0], top)).toBeCloseTo(0, 5);
    expect(m.heightAt([0, -300], road)).toBeCloseTo(0, 5);
  });

  it('gives a short bridge over a stream only a small hump', () => {
    const t = { highway: 'residential', bridge: 'yes', layer: '1' };
    const r = { highway: 'residential' };
    const named = { a: [0, -12] as XY, b: [0, 12] as XY };
    const osm: OsmData = { ways: [way([[0, -200], 'a'], r, named), way(['a', 'b'], t, named), way(['b', [0, 200]], r, named)], nodes: [] };
    const m = new VerticalModel(osm, frame);
    expect(m.heightAt([0, 0], t)).toBeGreaterThan(0.8);
    expect(m.heightAt([0, 0], t)).toBeLessThan(2.2);
  });

  it('follows the terrain, spans valleys and runs tunnels at their portal level', () => {
    // Ground climbs 3 % to the north, with a valley at y = 0 and a hill at y = 600.
    const ground = ([, y]: XY) => 0.03 * y - 14 * Math.exp(-((y / 60) ** 2)) + 30 * Math.exp(-(((y - 600) / 120) ** 2));
    const r = { highway: 'trunk' };
    const viaduct = { highway: 'trunk', bridge: 'yes', layer: '1' };
    const tunnel = { highway: 'trunk', tunnel: 'yes', layer: '-1' };
    const named = { v0: [0, -150] as XY, v1: [0, 150] as XY, t0: [0, 450] as XY, t1: [0, 750] as XY };
    const osm: OsmData = {
      ways: [
        way([[0, -500], 'v0'], r, named),
        way(['v0', 'v1'], viaduct, named),
        way(['v1', 't0'], r, named),
        way(['t0', 't1'], tunnel, named),
        way(['t1', [0, 900]], r, named),
      ],
      nodes: [],
    };
    const m = new VerticalModel(osm, frame, { ground });
    expect(m.heightAt([0, -400], r)).toBeCloseTo(ground([0, -400]), 1);
    // Over the valley the deck stays near the straight line between the abutments, well above the valley floor.
    const deck = m.heightAt([0, 0], viaduct);
    expect(deck - ground([0, 0])).toBeGreaterThan(12);
    // In the tunnel the road runs near the portals' level, far below the hilltop.
    const inside = m.heightAt([0, 600], tunnel);
    expect(Math.abs(inside - (ground([0, 450]) + ground([0, 750])) / 2)).toBeLessThan(3);
    expect(ground([0, 600]) - inside).toBeGreaterThan(20);
  });
});
