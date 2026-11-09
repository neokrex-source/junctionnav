/** Writes the day JunctionNav map style for the route alignment pictures. Usage: vite-node scripts/dev/route-align-style.ts <out dir> */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { techOnlineStyle } from '../../src/map/techStyle';

const out = process.argv[2] ?? 'route-align';
writeFileSync(join(out, 'style-day.json'), JSON.stringify(techOnlineStyle(false, 'en')));
