/**
 * Synthetic surroundings for the demo network, in the same shape as the Overpass
 * surroundings query: a town along Jalan Demo, an industrial park, oil palm estates,
 * a river and lake, an R&R, and Sungai Buloh town at exit 114.
 */
import { LocalFrame, rng, type XY } from '../geo/geo';
import type { SurroundData } from '../junction/surroundings';
import { DEMO_ORIGIN } from './network';

type Tags = Record<string, string>;

let cached: SurroundData | null = null;

export function buildDemoSurroundings(): SurroundData {
  if (cached) return cached;
  const frame = new LocalFrame(DEMO_ORIGIN);
  const r = rng(20261031);
  const ways: SurroundData['ways'] = [];
  const pois: SurroundData['pois'] = [];
  let id = 50000;
  const geom = (pts: XY[]) =>
    pts.map(([x, y]) => {
      const [lon, lat] = frame.toLngLat(x, y);
      return { lat, lon };
    });
  const poly = (pts: XY[], tags: Tags) => ways.push({ id: ++id, tags, geometry: geom([...pts, pts[0]]) });
  const line = (pts: XY[], tags: Tags) => ways.push({ id: ++id, tags, geometry: geom(pts) });
  const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const bld = (x0: number, y0: number, x1: number, y1: number, tags: Tags) => poly(rect(x0, y0, x1, y1), tags);
  const poi = (x: number, y: number, tags: Tags) => {
    const [lon, lat] = frame.toLngLat(x, y);
    pois.push({ id: `node/${++id}`, tags, lat, lon });
  };
  const levels = (lo: number, hi: number) => String(lo + Math.floor(r() * (hi - lo + 1)));
  /** Rows of terrace houses running north-south. */
  const terraces = (x0: number, x1: number, y0: number, y1: number, rowLen = 64) => {
    for (let x = x0; x + 8 <= x1; x += 24) {
      for (let y = y0; y + rowLen <= y1; y += rowLen + 14) bld(x, y, x + 8, y + rowLen, { building: 'terrace', 'building:levels': levels(1, 2) });
    }
  };
  /** Shophouse blocks along a road. */
  const shophouses = (x0: number, x1: number, y0: number, y1: number, step = 104, len = 84) => {
    for (let y = y0; y + len <= y1; y += step) bld(x0, y, x1, y + len, { building: 'retail', 'building:levels': levels(3, 4) });
  };

  /* ---------------- town along Jalan Demo */
  poly(rect(-360, 40, -80, 660), { landuse: 'residential' });
  poly(rect(80, 40, 330, 660), { landuse: 'residential' });
  poly(rect(-360, 1340, -80, 1720), { landuse: 'residential' });
  shophouses(-62, -28, 80, 660);
  shophouses(34, 66, 80, 660);
  shophouses(-62, -28, 1360, 1740);
  shophouses(34, 66, 1360, 1740);
  terraces(-330, -92, 60, 650);
  terraces(96, 320, 60, 650);
  terraces(-330, -92, 1360, 1710);
  poi(-230, 400, { place: 'suburb', name: 'Taman Melati' });
  poi(-250, 1170, { place: 'village', name: 'Kampung Baru' });
  poi(200, 330, { place: 'town', name: 'Bandar Demo' });

  /* ---------------- commercial centre at Jalan Kampung, beside the flyover */
  poly(rect(40, 1000, 300, 1320), { landuse: 'commercial' });
  bld(48, 1012, 150, 1112, { building: 'retail', height: '22', name: 'Demo Mall' });
  bld(190, 1030, 215, 1055, { building: 'office', height: '78' });
  bld(236, 1080, 259, 1103, { building: 'office', height: '58' });
  bld(190, 1150, 213, 1173, { building: 'apartments', height: '48' });
  bld(236, 1150, 262, 1176, { building: 'apartments', height: '64' });
  bld(48, 1150, 150, 1210, { building: 'commercial', 'building:levels': '5' });
  bld(-130, 1004, -36, 1070, { building: 'commercial', 'building:levels': '3' });
  bld(-130, 905, -36, 976, { building: 'commercial', 'building:levels': '2' });
  bld(-215, 1185, -185, 1215, { building: 'mosque', height: '14' });
  poi(-200, 1200, { amenity: 'place_of_worship', religion: 'muslim', name: 'Masjid Kampung Baru' });
  poi(100, 1062, { shop: 'mall', name: 'Demo Mall' });
  poly(rect(-360, 760, -110, 960), { leisure: 'park', name: 'Taman Rekreasi' });
  // Roadside blocks just past the flyover split.
  shophouses(34, 66, 705, 980, 92, 76);
  for (let y = 720; y + 46 <= 880; y += 56) bld(-82, y, -40, y + 46, { building: 'commercial', 'building:levels': levels(2, 3) });
  bld(-160, 1260, -110, 1320, { building: 'school', 'building:levels': '3', name: 'Sekolah Kebangsaan Demo' });
  poi(-135, 1290, { amenity: 'school', name: 'Sekolah Kebangsaan Demo' });

  /* ---------------- industrial park by the expressway entrance */
  poly(rect(-340, 1870, -80, 2060), { landuse: 'industrial' });
  poly(rect(-340, 2060, -175, 2320), { landuse: 'industrial' });
  poly(rect(115, 1820, 260, 1975), { landuse: 'industrial' });
  for (let x = -330; x + 60 <= -90; x += 78) bld(x, 1885, x + 60, 1960, { building: 'warehouse', height: String(9 + Math.round(r() * 4)) });
  for (let x = -330; x + 60 <= -90; x += 78) bld(x, 1975, x + 60, 2045, { building: 'industrial', height: String(8 + Math.round(r() * 5)) });
  bld(-330, 2080, -260, 2180, { building: 'warehouse', height: '12' });
  bld(-245, 2080, -185, 2180, { building: 'warehouse', height: '10' });
  bld(-330, 2200, -195, 2300, { building: 'factory', height: '14' });
  bld(125, 1832, 250, 1890, { building: 'warehouse', height: '11' });
  bld(125, 1905, 250, 1965, { building: 'warehouse', height: '9' });
  poi(-215, 2120, { place: 'neighbourhood', name: 'Kawasan Perindustrian Demo' });

  /* ---------------- oil palm estates and a river along the E1 */
  poly(
    [
      [40, 2470],
      [262, 2470],
      [270, 3270],
      [40, 3270],
    ],
    { landuse: 'farmland', crop: 'oil_palm' },
  );
  poly(
    [
      [362, 2380],
      [840, 2380],
      [840, 3300],
      [362, 3300],
    ],
    { landuse: 'orchard', trees: 'oil_palms' },
  );
  line(
    [
      [-260, 2880],
      [-60, 2850],
      [120, 2870],
      [300, 2845],
      [520, 2865],
      [720, 2835],
      [950, 2860],
    ],
    { waterway: 'river', name: 'Sungai Demo' },
  );
  poi(560, 2700, { place: 'hamlet', name: 'Ladang Sawit Demo' });

  /* ---------------- lake, forest and estate around the JCT */
  const lake: XY[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    lake.push([130 + Math.cos(a) * (70 + r() * 14), 3460 + Math.sin(a) * (55 + r() * 12)]);
  }
  poly(lake, { natural: 'water', name: 'Tasik Demo' });
  poly(
    [
      [650, 3330],
      [920, 3360],
      [930, 3960],
      [690, 3930],
      [640, 3650],
    ],
    { natural: 'wood' },
  );
  poly(
    [
      [292, 3570],
      [332, 3570],
      [402, 3760],
      [430, 3930],
      [200, 3960],
      [236, 3740],
    ],
    { landuse: 'orchard', trees: 'oil_palms' },
  );
  poly(rect(-40, 3330, 60, 4100), { natural: 'wood' });

  /* ---------------- R&R on the E35 */
  bld(480, 3782, 528, 3812, { building: 'retail', height: '8', name: 'R&R Demo Timur' });
  bld(468, 3828, 500, 3848, { building: 'roof', height: '6' });
  bld(505, 3828, 512, 3836, { building: 'yes', height: '4' });

  /* ---------------- Sungai Buloh at exit 114 */
  poly(rect(640, 4320, 880, 4660), { landuse: 'industrial' });
  for (let y = 4335; y + 85 <= 4650; y += 105) {
    bld(650, y, 735, y + 85, { building: 'warehouse', height: String(10 + Math.round(r() * 3)) });
    bld(760, y, 860, y + 80, { building: 'industrial', height: String(9 + Math.round(r() * 4)) });
  }
  poly(rect(130, 4300, 500, 4640), { landuse: 'residential' });
  terraces(150, 470, 4320, 4630, 60);
  poly(rect(180, 4640, 500, 4800), { landuse: 'commercial' });
  for (let x = 200; x + 40 <= 490; x += 48) {
    bld(x, 4652, x + 40, 4704, { building: 'retail', 'building:levels': levels(2, 4) });
    if (x + 40 <= 470) bld(x, 4736, x + 40, 4790, { building: 'retail', 'building:levels': levels(2, 4) });
  }
  poly(rect(110, 4810, 300, 5000), { leisure: 'park', name: 'Taman Tasik Sungai Buloh' });
  poly(rect(100, 5100, 420, 5340), { landuse: 'commercial' });
  for (let x = 120; x + 34 <= 236; x += 40) bld(x, 5212, x + 34, 5290, { building: 'retail', 'building:levels': levels(3, 4) });
  for (let x = 296; x + 34 <= 392; x += 40) bld(x, 5212, x + 34, 5290, { building: 'retail', 'building:levels': levels(3, 5) });
  for (let x = 120; x + 34 <= 372; x += 42) bld(x, 5112, x + 34, 5186, { building: 'retail', 'building:levels': levels(2, 4) });
  bld(170, 5320, 196, 5346, { building: 'apartments', height: '46' });
  bld(220, 5322, 248, 5350, { building: 'apartments', height: '52' });
  bld(440, 5212, 468, 5230, { building: 'roof', height: '5.5' });
  bld(472, 5214, 484, 5226, { building: 'yes', height: '4' });
  poi(456, 5221, { amenity: 'fuel', name: 'Stesen Minyak Sungai Buloh' });
  bld(660, 5040, 770, 5150, { building: 'hospital', height: '26' });
  poi(715, 5095, { amenity: 'hospital', name: 'Hospital Sungai Buloh' });
  poi(330, 5010, { place: 'town', name: 'Sungai Buloh' });
  line(
    [
      [95, 3900],
      [100, 4300],
      [108, 4700],
      [115, 5100],
      [118, 5700],
    ],
    { railway: 'rail', name: 'KTM Demo' },
  );
  poly(rect(-200, 4200, 70, 5400), { landuse: 'farmland', crop: 'oil_palm' });

  cached = { ways, rels: [], pois };
  return cached;
}
