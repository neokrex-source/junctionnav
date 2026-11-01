import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/demo/network';
import { ARRIVAL_RADIUS, arrivalRadius, NavEngine, type Prompt } from '../src/nav/engine';
import { arrivalSpeech } from '../src/routing/instructions';
import { normalizeOsrm } from '../src/routing/osrm';

const route = () => normalizeOsrm(structuredClone(buildDemo().osrm), 'Demo')[0];

describe('arrival', () => {
  it('enters the arrival zone 300 m out and goes quiet from there', () => {
    const r = route();
    expect(arrivalRadius(r)).toBe(ARRIVAL_RADIUS);
    const eng = new NavEngine();
    eng.setRoute(r, []);
    let firstNear = -1;
    const after: Prompt[] = [];
    const finalArrive: Prompt[] = [];
    let time = 1e6;
    for (let s = 0; s <= r.line.length; s += 15, time += 1000) {
      const p = eng.update({ lngLat: r.line.pointAt(s), accuracy: 4, heading: r.line.bearingAt(s), speed: 15, time })!;
      const pr = eng.prompts(p);
      finalArrive.push(...pr.filter((x) => x.step.type === 'arrive'));
      if (p.nearDestination && firstNear < 0) firstNear = s;
      if (firstNear >= 0) after.push(...pr);
    }
    expect(r.line.length - firstNear).toBeLessThanOrEqual(ARRIVAL_RADIUS);
    expect(r.line.length - firstNear).toBeGreaterThan(ARRIVAL_RADIUS - 20);
    expect(after).toEqual([]);
    expect(finalArrive).toEqual([]); // no "in 500 metres, you have arrived"
    expect(eng.progress!.arrived).toBe(true);
  });

  it('says it in each language, with the side when known', () => {
    expect(arrivalSpeech('en')).toBe('You have reached your destination.');
    expect(arrivalSpeech('en', 'left')).toBe('You have reached your destination. It is on your left.');
    expect(arrivalSpeech('ms', 'right')).toBe('Anda telah sampai ke destinasi. Destinasi di sebelah kanan.');
    expect(arrivalSpeech('ja')).toBe('目的地に到着しました。');
  });
});
