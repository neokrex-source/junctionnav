/** Terrain from the public tiles, decoded in Node (the app does this in the browser), for the real-data tests. */
import type { LngLat } from '../src/geo/geo';
import { GridPatch, TERRAIN_URL } from '../src/junction/terrain';
import { decodePng } from './png';

const tiles = new Map<string, Promise<Float32Array | null>>();
let cors: string | null | undefined;
async function tile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  let t = tiles.get(key);
  if (!t) {
    t = (async () => {
      const res = await fetch(TERRAIN_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)), {
        headers: { Origin: 'https://neokrex-source.github.io' },
      });
      if (cors === undefined) cors = res.headers.get('access-control-allow-origin');
      if (!res.ok) return null;
      const { width, rgba } = decodePng(new Uint8Array(await res.arrayBuffer()));
      const out = new Float32Array(width * width);
      for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
      return out;
    })().catch(() => null);
    tiles.set(key, t);
  }
  return t;
}
export async function terrainAt(center: LngLat): Promise<GridPatch | null> {
  const z = 14;
  const n = 2 ** z;
  const txy = (p: LngLat) => {
    const lat = (p[1] * Math.PI) / 180;
    return [((p[0] + 180) / 360) * n, ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n];
  };
  const [cx, cy] = txy(center).map(Math.floor);
  const loaded = new Map<string, Float32Array>();
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const d = await tile(z, cx + dx, cy + dy);
      if (d) loaded.set(`${cx + dx}/${cy + dy}`, d);
    }
  if (!loaded.size) return null;
  return GridPatch.sample(center, 950, 15, (p) => {
    const [fx, fy] = txy(p);
    const d = loaded.get(`${Math.floor(fx)}/${Math.floor(fy)}`);
    if (!d) return null;
    const px = Math.min(255, Math.max(0, Math.floor((fx % 1) * 256)));
    const py = Math.min(255, Math.max(0, Math.floor((fy % 1) * 256)));
    return Math.max(0, d[py * 256 + px]);
  });
}


export function corsHeader(): string | null | undefined {
  return cors;
}
