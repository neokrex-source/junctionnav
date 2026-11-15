/**
 * Writes the demo network's offline pack files (graph.bin, places.bin) for the browser check of
 * offline maps by country (scripts/dev/offline-countries-check.cjs). Runs only with DEMO_PACK_OUT.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDemo } from '../src/demo/network';
import { demoPack } from './offlineFixture';

const out = process.env.DEMO_PACK_OUT;

describe.skipIf(!out)('demo pack files', () => {
  it('writes them', () => {
    const p = demoPack();
    mkdirSync(out!, { recursive: true });
    writeFileSync(join(out!, 'graph.bin'), Buffer.from(p.graph));
    writeFileSync(join(out!, 'places.bin'), Buffer.from(p.places));
    const d = buildDemo();
    writeFileSync(join(out!, 'demo.json'), JSON.stringify({ bounds: d.bounds, start: d.start }));
    expect(p.graph.byteLength).toBeGreaterThan(100);
  });
});
