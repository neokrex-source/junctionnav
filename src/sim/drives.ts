/**
 * Ready-made test drives in and around Kuala Lumpur, each aimed at a set of app functions:
 * ramps climbing onto elevated expressways, drops to street level, underpasses and tunnels,
 * lane advice, the toll plaza, guidance without GPS and arrival. Each one is a trip link (see
 * src/trip/tripLink.ts), so it plans the route with the normal router (or the offline maps) and
 * starts the simulator, and a checklist (src/sim/testRun.ts) ticks off the functions as they
 * show up. The drive report on GitHub Actions replays every drive on the real offline maps and
 * fails when a check would not tick.
 */
import type { CheckId } from './testRun';

export interface TestDrive {
  id: string;
  title: string;
  /** One line on what the drive shows. */
  summary: string;
  /** Trip link query (without the leading "?"). */
  link: string;
  /** Functions the drive tests, in the order they come up. */
  checks: CheckId[];
  /** The stop number (1-based) that is the toll plaza, for the toll check. */
  tollStop?: number;
  /** Rough length and time at the default simulator speed, for the list. */
  km: number;
}

export const KL_DRIVES: TestDrive[] = [
  {
    id: 'suke',
    title: 'Sungai Besi toll onto SUKE',
    summary: 'Through the Sungai Besi toll plaza, then up the ramps onto the elevated SUKE.',
    link: 'from=road:E37|E2~3&via=Plaza Tol Sungai Besi@0&via=road:E19|SUKE&to=Suria KLCC&sim=2',
    checks: ['route', 'toll', 'junction', 'lanes', 'flyover', 'map3d', 'arrival'],
    tollStop: 1,
    km: 30,
  },
  {
    id: 'dash',
    title: 'DASH to Penchala Link and its tunnel',
    summary: 'Off the elevated DASH, down onto Penchala Link and through the Penchala tunnel.',
    link: 'from=road:E31|DASH~7&to=Mont Kiara&sim=2',
    checks: ['route', 'junction', 'lanes', 'flyover', 'descend', 'map3d', 'tunnelSign', 'dr', 'arrival'],
    km: 14,
  },
  {
    id: 'mex',
    title: 'MEX down to Jalan Tun Razak',
    summary: 'North on MEX, down the ramp at the stacked Kampung Pandan interchange and under the roundabout.',
    link: 'from=road:E20|MEX~7&to=Suria KLCC&sim=2',
    checks: ['route', 'junction', 'descend', 'map3d', 'tunnelSign', 'dr', 'arrival'],
    km: 10,
  },
  {
    id: 'duke',
    title: 'DUKE into the Wangsa Maju underpass',
    summary: 'Off DUKE at Setiawangsa, down into the underpass and through the tunnel at Wangsa Maju.',
    link: 'from=road:E33|DUKE~9&to=Zoo Negara&sim=2',
    checks: ['route', 'junction', 'underpass', 'tunnel', 'map3d', 'tunnelSign', 'dr', 'arrival'],
    km: 12,
  },
  {
    id: 'smart',
    title: 'SMART tunnel',
    summary: 'Into the SMART tunnel from Sungai Besi: tunnel signs, then a kilometre without GPS.',
    link: 'from=road:E37|E2~3&via=Plaza Tol Sungai Besi@0&via=road:E38|SMART&to=Pavilion Kuala Lumpur&sim=2',
    checks: ['route', 'junction', 'tunnelSign', 'dr', 'arrival'],
    km: 18,
  },
];

export function driveQuery(d: TestDrive): string {
  return `?${d.link}`;
}
