import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/demo/network';
import { destination } from '../src/geo/geo';
import { NavEngine, type Prompt } from '../src/nav/engine';
import { laneTarget } from '../src/nav/lanes';
import {
  buildTunnelQuery,
  isMajor,
  matchTunnelWays,
  mergeTunnels,
  simplifyPath,
  tunnelsFromRoute,
  tunnelStateAt,
} from '../src/nav/tunnels';
import { lanePhrase, tunnelSpeech, tunnelTitle } from '../src/routing/instructions';
import { normalizeOsrm } from '../src/routing/osrm';

const demo = buildDemo();
const route = () => normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];
const osmTunnels = () => demo.osm.ways.filter((w) => w.tags.tunnel === 'yes');

describe('tunnel detection', () => {
  it('reads tunnel stretches from the router classes', () => {
    const spans = tunnelsFromRoute(route());
    expect(spans.length).toBe(1);
    expect(spans[0].source).toBe('router');
    expect(spans[0].fromS).toBeGreaterThan(1150);
    expect(spans[0].fromS).toBeLessThan(1350);
    expect(spans[0].length).toBeGreaterThan(480);
    expect(spans[0].length).toBeLessThan(520);
  });

  it('matches OSM tunnel ways onto the route, skipping the tube going the other way', () => {
    const r = route();
    const spans = matchTunnelWays(r, osmTunnels());
    // The Bukit Demo northbound tube and the short underpass on the exit ramp.
    expect(spans.length).toBe(2);
    const [hill, underpass] = spans;
    expect(hill.name).toBe('Terowong Bukit Demo');
    expect(hill.names.en).toBe('Bukit Demo Tunnel');
    expect(hill.highway).toBe('trunk');
    expect(hill.length).toBeGreaterThan(470);
    expect(isMajor(hill)).toBe(true);
    expect(isMajor(underpass)).toBe(false);
    expect(underpass.fromS).toBeGreaterThan(r.steps.find((s) => s.type === 'off ramp')!.s);
    expect(tunnelTitle(hill, 'en')).toBe('Bukit Demo Tunnel');
    expect(tunnelTitle(hill, 'ms')).toBe('Terowong Bukit Demo');
    expect(tunnelTitle(underpass, 'en')).toBe('Tunnel');
  });

  it('prefers OSM ends and names over the router stretch for the same tunnel', () => {
    const r = route();
    const merged = mergeTunnels(tunnelsFromRoute(r), matchTunnelWays(r, osmTunnels()));
    expect(merged.length).toBe(2);
    expect(merged[0].source).toBe('osm');
    expect(merged[0].name).toBe('Terowong Bukit Demo');
  });

  it('builds a compact along-route Overpass query', () => {
    const r = route();
    const path = simplifyPath(r.line.coords, 6);
    expect(path.length).toBeLessThan(r.line.coords.length / 3);
    const q = buildTunnelQuery(path);
    expect(q).toContain('way(around:30,');
    expect(q).toContain('["tunnel"!="no"]');
    expect(q).toContain('out body geom;');
  });

  it('says what to show before and inside a tunnel', () => {
    const r = route();
    const spans = matchTunnelWays(r, osmTunnels());
    const t = spans[0];
    expect(tunnelStateAt(spans, t.fromS - 1200, 1000)).toBeNull();
    expect(tunnelStateAt(spans, t.fromS - 600, 1000)).toMatchObject({ phase: 'ahead', dist: 600 });
    const inside = tunnelStateAt(spans, t.fromS + t.length / 2, 1000)!;
    expect(inside.phase).toBe('inside');
    expect(inside.progress).toBeCloseTo(0.5, 1);
    // The 100 m underpass never gets a card.
    expect(tunnelStateAt(spans, spans[1].fromS + 10, 1000)).toBeNull();
  });
});

describe('driving through a tunnel', () => {
  function setup() {
    const r = route();
    const spans = mergeTunnels(tunnelsFromRoute(r), matchTunnelWays(r, osmTunnels()));
    const eng = new NavEngine();
    eng.setRoute(r, []);
    eng.setTunnels(spans);
    return { r, eng, t: spans[0] };
  }

  it('announces the tunnel once, before the entrance, with name, length and headlights', () => {
    const { r, eng, t } = setup();
    const prompts: Prompt[] = [];
    let time = 1e6;
    for (let s = 0; s <= t.toS + 100; s += 21) {
      const p = eng.update({ lngLat: r.line.pointAt(s), accuracy: 4, heading: r.line.bearingAt(s), speed: 21, time })!;
      prompts.push(...eng.prompts(p));
      time += 1000;
    }
    const tp = prompts.filter((p) => p.kind === 'tunnel');
    expect(tp.length).toBe(1);
    expect(tp[0].tunnel!.dist).toBeLessThanOrEqual(650);
    expect(tp[0].tunnel!.dist).toBeGreaterThan(40);
    const text = tunnelSpeech(tp[0].tunnel!, 'en', 'metric');
    expect(text).toMatch(/^Tunnel ahead in .+: Bukit Demo Tunnel, .+ long\. Turn on your headlights\.$/);
    expect(tunnelSpeech(tp[0].tunnel!, 'ms', 'metric')).toContain('Terowong Bukit Demo');
    expect(tunnelSpeech(tp[0].tunnel!, 'ja', 'metric')).toContain('ブキッデモトンネル');
  });

  it('keeps moving on an estimate when GPS stops in the tunnel, then snaps back', () => {
    const { r, eng, t } = setup();
    let time = 1e6;
    let s = t.fromS - 200;
    // Good fixes up to just inside the entrance.
    while (s < t.fromS + 20) {
      eng.update({ lngLat: r.line.pointAt(s), accuracy: 4, heading: r.line.bearingAt(s), speed: 20, time });
      s += 20;
      time += 1000;
    }
    const lastGood = eng.progress!.s;
    expect(eng.deadReckon(time - 500)).toBeNull(); // too soon to guess
    // Ten seconds with no fixes: estimates every second.
    const est: number[] = [];
    for (let k = 1; k <= 10; k++) {
      const f = eng.deadReckon(time + k * 1000)!;
      expect(f.dr).toBe(true);
      const p = eng.update(f)!;
      expect(p.dr).toBe(true);
      expect(p.offRoute).toBe(false);
      expect(p.tunnel?.phase).toBe('inside');
      est.push(p.s);
    }
    expect(est[9] - lastGood).toBeGreaterThan(200);
    expect(est[9] - lastGood).toBeLessThan(240);
    // Never runs far past the exit without GPS.
    const far = eng.deadReckon(time + 120_000)!;
    expect(eng.update(far)!.s).toBeLessThanOrEqual(t.toS + 151);
    // GPS back after the exit: real position again.
    const back = eng.update({ lngLat: r.line.pointAt(t.toS + 60), accuracy: 5, heading: r.line.bearingAt(t.toS + 60), speed: 20, time: time + 121_000 })!;
    expect(back.dr).toBe(false);
    expect(Math.abs(back.s - (t.toS + 60))).toBeLessThan(3);
  });

  it('pulls an estimate that ran ahead back to the real position when GPS returns', () => {
    const { r, eng, t } = setup();
    let time = 1e6;
    for (let s = t.fromS - 100; s <= t.fromS + 20; s += 20, time += 1000) {
      eng.update({ lngLat: r.line.pointAt(s), accuracy: 4, heading: r.line.bearingAt(s), speed: 20, time });
    }
    // Stuck in a jam: the estimate runs on to the cap past the exit.
    for (let k = 1; k <= 40; k++) eng.update(eng.deadReckon(time + k * 1000)!);
    expect(eng.progress!.s).toBeGreaterThan(t.toS + 100);
    // GPS comes back near the exit, 250 m behind the estimate.
    const realS = t.toS - 100;
    const p = eng.update({ lngLat: r.line.pointAt(realS), accuracy: 8, heading: r.line.bearingAt(realS), speed: 5, time: time + 41_000 })!;
    expect(p.onRoute).toBe(true);
    expect(p.offRoute).toBe(false);
    expect(Math.abs(p.s - realS)).toBeLessThan(3);
  });

  it('ignores wild network fixes inside the tunnel instead of going off route', () => {
    const { r, eng, t } = setup();
    let time = 1e6;
    for (let s = t.fromS - 100; s <= t.fromS + 40; s += 20, time += 1000) {
      eng.update({ lngLat: r.line.pointAt(s), accuracy: 4, heading: r.line.bearingAt(s), speed: 20, time });
    }
    for (let k = 0; k < 6; k++, time += 1000) {
      const s = t.fromS + 100 + k * 20;
      const wild = destination(r.line.pointAt(s), 90, 400);
      const p = eng.update({ lngLat: wild, accuracy: 600, heading: null, speed: null, time })!;
      expect(p.dr).toBe(true);
      expect(p.onRoute).toBe(true);
      expect(p.offRoute).toBe(false);
    }
  });

  it('moves lane advice before the tunnel when the junction comes soon after it', () => {
    const { r, eng, t } = setup();
    const fork = r.steps[1];
    const plain = laneTarget(r, fork, 21)!;
    const target = laneTarget(r, fork, 21, eng.tunnels)!;
    expect(plain.viaTunnel).toBeNull();
    expect(plain.fromS).toBeGreaterThan(t.fromS); // without tunnels it would start inside
    expect(target.viaTunnel?.id).toBe(t.id);
    expect(target.fromS).toBeLessThan(t.fromS - 300);
    const lane = { target, dist: fork.s - target.fromS, current: null, status: 'advise' as const, move: 'right' as const, changes: 1 };
    expect(lanePhrase('early', lane, 'en', 'metric')).toMatch(/^The junction in .+, after the tunnel\. Move to the right 2 lanes before the tunnel\.$/);
    expect(lanePhrase('hint', lane, 'en', 'metric')).toBe('Use the right 2 lanes before the tunnel.');
    // Once inside, plain wording again.
    const insideLane = { ...lane, dist: fork.s - (t.fromS + 50) };
    expect(lanePhrase('hint', insideLane, 'en', 'metric')).toBe('Use the right 2 lanes.');
  });

  it('does not check lanes from GPS inside a tunnel', () => {
    const { r, eng, t } = setup();
    let time = 1e6;
    let p = null;
    for (let s = t.fromS + 20; s < t.toS - 20; s += 20, time += 1000) {
      const brg = r.line.bearingAt(s, 15);
      p = eng.update({ lngLat: destination(r.line.pointAt(s), brg - 90, 3.5), accuracy: 4, heading: brg, speed: 20, time })!;
      if (p.lane) expect(p.lane.current).toBeNull();
    }
    expect(p!.lane?.target.step.index).toBe(1);
  });
});
