/**
 * Builds a small offline pack from the demo network with the real build scripts, so tests run the
 * same code path as the Peninsular Malaysia pack built on GitHub Actions (minus osmium: the OPL
 * that osmium would produce is written directly).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDemo } from '../src/demo/network';

const esc = (s: string) => s.replace(/[\s,=@%]|[^\x21-\x7e]/gu, (c) => `%${c.codePointAt(0)!.toString(16)}%`);
const tags = (t: Record<string, string>) => Object.entries(t).map(([k, v]) => `${esc(k)}=${esc(v)}`).join(',');

export interface DemoPack {
  dir: string;
  graph: ArrayBuffer;
  places: ArrayBuffer;
}

let cached: DemoPack | null = null;

export function demoPack(): DemoPack {
  if (cached) return cached;
  const demo = buildDemo();
  const dir = mkdtempSync(join(tmpdir(), 'jn-pack-'));
  const lines: string[] = [];
  for (const n of demo.osm.nodes) lines.push(`n${n.id} T${tags(n.tags ?? {})} x${n.lon} y${n.lat}`);
  for (const w of demo.osm.ways) {
    const refs = w.nodes.map((id, i) => `n${id}x${w.geometry[i].lon.toFixed(7)}y${w.geometry[i].lat.toFixed(7)}`).join(',');
    lines.push(`w${w.id} T${tags(w.tags)} N${refs}`);
  }
  writeFileSync(join(dir, 'roads.opl'), lines.join('\n') + '\n');

  // Places as osmium export would write them (one GeoJSON feature per line).
  const feats = [
    ...demo.pois.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p.lngLat }, properties: p.tags })),
    ...demo.spots.map((s) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: s.lngLat }, properties: { name: s.name, place: 'suburb' } })),
  ];
  writeFileSync(join(dir, 'places.geojsonseq'), feats.map((f) => JSON.stringify(f)).join('\n') + '\n');

  const [w, s, e, n] = [demo.bounds[0][0] - 0.02, demo.bounds[0][1] - 0.02, demo.bounds[1][0] + 0.02, demo.bounds[1][1] + 0.02];
  const run = (script: string, ...args: string[]) =>
    execFileSync(process.execPath, [join('scripts/offline', script), ...args], { stdio: 'pipe' });
  run('build-graph.mjs', join(dir, 'roads.opl'), join(dir, 'graph.bin'), join(dir, 'streets.jsonl'), '--bbox', `${w},${s},${e},${n}`, '--side', 'left');
  run('build-places.mjs', join(dir, 'places.geojsonseq'), join(dir, 'streets.jsonl'), join(dir, 'places.bin'));
  const ab = (f: string) => {
    const b = readFileSync(join(dir, f));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  cached = { dir, graph: ab('graph.bin'), places: ab('places.bin') };
  return cached;
}

/**
 * A road grid big enough for the long-route shortcut (main roads only far from both ends):
 * n x n crossings about 180 m apart, a primary road every 12th line, a trunk road every 60th.
 */
export function gridPack(n = 220): ArrayBuffer {
  const dir = mkdtempSync(join(tmpdir(), 'jn-grid-'));
  const step = 0.0016;
  const hw = (k: number) => (k % 60 === 0 ? 'trunk' : k % 12 === 0 ? 'primary' : k % 4 === 0 ? 'tertiary' : 'residential');
  const at = (i: number, j: number) => `n${i * n + j + 1}x${(100 + j * step).toFixed(7)}y${(2 + i * step).toFixed(7)}`;
  const lines: string[] = [];
  let w = 1;
  for (let i = 0; i < n; i++) lines.push(`w${w++} Thighway=${hw(i)} N${Array.from({ length: n }, (_, j) => at(i, j)).join(',')}`);
  for (let j = 0; j < n; j++) lines.push(`w${w++} Thighway=${hw(j)} N${Array.from({ length: n }, (_, i) => at(i, j)).join(',')}`);
  writeFileSync(join(dir, 'grid.opl'), lines.join('\n') + '\n');
  execFileSync(process.execPath, ['scripts/offline/build-graph.mjs', join(dir, 'grid.opl'), join(dir, 'graph.bin'), join(dir, 'streets.jsonl'), '--bbox', '99.9,1.9,100.5,2.5'], { stdio: 'pipe' });
  const b = readFileSync(join(dir, 'graph.bin'));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
