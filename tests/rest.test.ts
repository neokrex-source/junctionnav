import { describe, expect, it } from 'vitest';
import {
  bestRestPlace,
  parseRestPlaces,
  PULL_OUT_MS,
  REST_AT_PLACE,
  REST_OFF_ROAD,
  RESUME_HOLD,
  restKindOfFeature,
  restKindOfTags,
  RestPlaceFinder,
  restPlaceFromFeatures,
  restQuery,
  RestWatch,
  type RestInput,
} from '../src/nav/rest';
import type { LngLat } from '../src/geo/geo';

const AT: LngLat = [101.5, 3.1];
const fuel = { kind: 'fuel' as const, name: 'Petronas Ulu Bernam' };

function input(over: Partial<RestInput>): RestInput {
  return { time: 0, lngLat: AT, speed: 0, accuracy: 8, offset: 0, nearDestination: false, place: undefined, ...over };
}

/** Feeds one fix a second from `from` for `secs` seconds; returns the events. */
function run(w: RestWatch, from: number, secs: number, over: Partial<RestInput>) {
  const out = [];
  for (let t = 0; t < secs; t++) {
    const ev = w.update(input({ time: from + t * 1000, ...over }));
    if (ev) out.push({ t: from + t * 1000, ev });
  }
  return out;
}

describe('rest stops', () => {
  it('standing at a petrol station off the carriageway: a rest stop after a few seconds', () => {
    const w = new RestWatch();
    const evs = run(w, 0, 12, { offset: 30, place: fuel });
    expect(evs).toHaveLength(1);
    expect(evs[0].ev?.kind).toBe('start');
    expect(evs[0].t).toBe(REST_AT_PLACE);
    expect(w.resting?.place).toEqual(fuel);
  });

  it('not at a red light: on the road by a petrol station, or stopped on the route', () => {
    const w = new RestWatch();
    expect(run(w, 0, 90, { offset: 4, place: fuel })).toHaveLength(0);
    expect(run(new RestWatch(), 0, 90, { offset: 3, place: null })).toHaveLength(0);
  });

  it('inside a building (a multi-storey car park, a mall): a rest stop wherever the route is', () => {
    const w = new RestWatch();
    const evs = run(w, 0, 10, { offset: 6, place: { kind: 'building' } });
    expect(evs[0]?.ev?.kind).toBe('start');
  });

  it('well off the road with nothing known there: a rest stop after half a minute', () => {
    const w = new RestWatch();
    const evs = run(w, 0, 40, { offset: 60, place: null });
    expect(evs).toHaveLength(1);
    expect(evs[0].t).toBe(REST_OFF_ROAD);
    expect(w.resting?.place).toBeNull();
  });

  it('not in the arrival zone (arriving is its own business)', () => {
    expect(run(new RestWatch(), 0, 60, { offset: 40, place: fuel, nearDestination: true })).toHaveLength(0);
  });

  it('creeping to a space keeps the clock; driving on resets it', () => {
    const w = new RestWatch();
    run(w, 0, 4, { offset: 30, place: fuel });
    run(w, 4000, 2, { offset: 30, place: fuel, speed: 2.5 });
    expect(run(w, 6000, 3, { offset: 30, place: fuel })[0]?.t).toBe(REST_AT_PLACE);
    const v = new RestWatch();
    run(v, 0, 5, { offset: 30, place: fuel });
    run(v, 5000, 1, { offset: 30, place: fuel, speed: 6 });
    expect(run(v, 6000, 7, { offset: 30, place: fuel })).toHaveLength(0);
  });

  it('ends after a few seconds of driving, not on a GPS jump while standing', () => {
    const w = new RestWatch();
    run(w, 0, 10, { offset: 30, place: fuel });
    expect(w.resting).not.toBeNull();
    // GPS jumps 200 m under a roof, the car still standing.
    expect(run(w, 60_000, 5, { offset: 30, place: fuel, lngLat: [101.502, 3.1] })).toHaveLength(0);
    // A jump with a speed worked out from it (poor GPS), once: still standing.
    expect(run(w, 65_000, 1, { offset: 30, place: fuel, lngLat: [101.5015, 3.1], speed: 160, accuracy: 25 })).toHaveLength(0);
    expect(run(w, 66_000, 1, { offset: 30, place: fuel })).toHaveLength(0);
    // Wandering on the spot with a jittery speed: not driving off.
    expect(run(w, 67_000, 4, { offset: 30, place: fuel, speed: 4, lngLat: [101.50005, 3.1] })).toHaveLength(0);
    const off = (m: number): LngLat => [101.5 + m / 111_150, 3.1];
    expect(w.update(input({ time: 70_000, speed: 6, lngLat: off(6) }))).toBeNull();
    expect(w.update(input({ time: 71_000, speed: 6, lngLat: off(13) }))).toBeNull();
    const end = w.update(input({ time: 72_000, speed: 6, lngLat: off(21) }));
    expect(end).toMatchObject({ kind: 'end', duration: 72_000 });
    expect(w.resting).toBeNull();
  });

  it('ends when well away from where it stood, moving even slowly', () => {
    const w = new RestWatch();
    run(w, 0, 10, { offset: 30, place: fuel });
    expect(run(w, 20_000, 1, { speed: 2, lngLat: [101.5008, 3.1] })).toHaveLength(0);
    expect(run(w, 21_000, 1, { speed: 2, lngLat: [101.5009, 3.1] })[0].ev?.kind).toBe('end');
  });

  it('Resume now ends it at once, and no new one starts for a few minutes', () => {
    const w = new RestWatch();
    run(w, 0, 10, { offset: 30, place: fuel });
    expect(w.resumeNow(20_000)?.kind).toBe('end');
    expect(run(w, 21_000, 60, { offset: 30, place: fuel })).toHaveLength(0);
    expect(run(w, 20_000 + RESUME_HOLD, 10, { offset: 30, place: fuel })[0]?.ev?.kind).toBe('start');
  });

  it('holds rerouting while standing, at a rest stop, pulling in, and slowly pulling out', () => {
    const w = new RestWatch();
    // Standing anywhere: GPS wandering is no reason for a new route.
    expect(w.holdReroute(input({ speed: 0.5, offset: 60 }))).toBe(true);
    // Pulling in to a petrol station, slowly.
    expect(w.holdReroute(input({ speed: 5, offset: 40, place: fuel }))).toBe(true);
    // A wrong turn at speed: reroute.
    expect(w.holdReroute(input({ speed: 12, offset: 40, place: fuel }))).toBe(false);
    expect(w.holdReroute(input({ speed: 5, offset: 40, place: null }))).toBe(false);
    run(w, 0, 10, { offset: 30, place: fuel });
    expect(w.holdReroute(input({ time: 20_000, speed: 0, offset: 30 }))).toBe(true);
    [10, 20, 30].forEach((m, i) => w.update(input({ time: 30_000 + i * 1000, offset: 30, speed: 5, place: null, lngLat: [101.5 + m / 111_150, 3.1] })));
    expect(w.resting).toBeNull();
    // Pulling out slowly through the car park, back towards the route.
    expect(w.holdReroute(input({ time: 40_000, speed: 4, offset: 50, place: null }))).toBe(true);
    expect(w.holdReroute(input({ time: 32_000 + PULL_OUT_MS + 1000, speed: 4, offset: 50, place: null }))).toBe(false);
    expect(w.holdReroute(input({ time: 40_000, speed: 12, offset: 50, place: null }))).toBe(false);
  });
});

describe('what is where the car stands', () => {
  it('OpenStreetMap tags', () => {
    expect(restKindOfTags({ amenity: 'fuel', name: 'Shell' })).toBe('fuel');
    expect(restKindOfTags({ amenity: 'charging_station' })).toBe('fuel');
    expect(restKindOfTags({ highway: 'services', name: 'R&R Ulu Bernam' })).toBe('rest');
    expect(restKindOfTags({ highway: 'rest_area' })).toBe('rest');
    expect(restKindOfTags({ amenity: 'parking', parking: 'multi-storey' })).toBe('parking');
    expect(restKindOfTags({ building: 'retail' })).toBe('building');
    expect(restKindOfTags({ shop: 'mall' })).toBe('building');
    expect(restKindOfTags({ amenity: 'restaurant' })).toBe('building');
    expect(restKindOfTags({ highway: 'primary' })).toBeNull();
    expect(restKindOfTags({ building: 'no' })).toBeNull();
  });

  it('the map under the car: OpenMapTiles, TomTom and Protomaps layers', () => {
    expect(restKindOfFeature({ layer: 'poi', props: { class: 'fuel', subclass: 'fuel' }, polygon: false })).toBe('fuel');
    expect(restKindOfFeature({ layer: 'pois', props: { kind: 'gas_station' }, polygon: false })).toBe('fuel');
    expect(restKindOfFeature({ layer: 'pois', props: { category: 'petrol station' }, polygon: false })).toBe('fuel');
    expect(restKindOfFeature({ layer: 'poi', props: { class: 'parking' }, polygon: false })).toBe('parking');
    expect(restKindOfFeature({ layer: 'landuse', props: { kind: 'parking' }, polygon: true })).toBe('parking');
    expect(restKindOfFeature({ layer: 'building', props: { render_height: 12 }, polygon: true })).toBe('building');
    expect(restKindOfFeature({ layer: 'buildings', props: { category: 'building' }, polygon: true })).toBe('building');
    expect(restKindOfFeature({ layer: 'poi', props: { class: 'shop', subclass: 'supermarket' }, polygon: false })).toBe('building');
    // A road or a park is not a place to rest at.
    expect(restKindOfFeature({ layer: 'transportation', props: { class: 'primary' }, polygon: false })).toBeNull();
    expect(restKindOfFeature({ layer: 'park', props: { class: 'park' }, polygon: true })).toBeNull();
  });

  it('the most telling find wins, named ones first; a name from another source fills in', () => {
    expect(bestRestPlace([{ kind: 'building' }, { kind: 'parking' }, null])).toEqual({ kind: 'parking' });
    expect(bestRestPlace([{ kind: 'parking', name: 'P1' }, { kind: 'fuel' }, { kind: 'fuel', name: 'Petron' }])).toEqual({ kind: 'fuel', name: 'Petron' });
    expect(bestRestPlace([undefined, null])).toBeNull();
    expect(restPlaceFromFeatures([{ layer: 'building', props: {}, polygon: true }, { layer: 'poi', props: { class: 'fuel', name: 'BHPetrol' }, polygon: false }])).toEqual({ kind: 'fuel', name: 'BHPetrol' });
  });

  it('asks Overpass what the point is inside and what is right by it', () => {
    const q = restQuery(AT);
    expect(q).toContain('is_in(3.100000,101.500000)');
    expect(q).toContain('amenity"~"^(fuel|charging_station|parking)$');
    expect(q).toContain('highway"~"^(services|rest_area)$');
    expect(parseRestPlaces({ elements: [{ tags: { building: 'yes' } }, { tags: { highway: 'services', name: 'R&R Tapah' } }] })).toEqual({ kind: 'rest', name: 'R&R Tapah' });
    expect(parseRestPlaces({ elements: [] })).toBeNull();
  });

  it('looks once per spot: the map at once, then the other sources', async () => {
    let asked = 0;
    const f = new RestPlaceFinder({
      map: () => [{ layer: 'building', props: {}, polygon: true }],
      overpass: async () => {
        asked++;
        return { elements: [{ tags: { amenity: 'fuel', name: 'Caltex' } }] };
      },
    });
    expect(f.at(AT)).toBeUndefined();
    const pending = f.lookAt(AT, 0);
    // The map already says it is a building.
    expect(f.at(AT)).toEqual({ kind: 'building' });
    expect(await pending).toEqual({ kind: 'fuel', name: 'Caltex' });
    expect(f.at(AT)).toEqual({ kind: 'fuel', name: 'Caltex' });
    await f.lookAt([101.5001, 3.1], 1000);
    expect(asked).toBe(1);
    // Somewhere else: not known there.
    expect(f.at([101.51, 3.1])).toBeUndefined();
  });

  it('nothing there, and a source that fails, is nothing (not unknown)', async () => {
    const f = new RestPlaceFinder({ map: () => [], overpass: async () => Promise.reject(new Error('offline')) });
    expect(await f.lookAt(AT, 0)).toBeNull();
    expect(f.at(AT)).toBeNull();
  });
});
