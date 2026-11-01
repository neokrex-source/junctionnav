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
    link: 'from=3.02373,101.71294@312 (E37 to Sungai Besi)&via=3.03930,101.70557@0 (Plaza Tol Sungai Besi)&to=3.06608,101.70590 (SUKE)&sim=2',
    checks: ['route', 'toll', 'junction', 'lanes', 'flyover', 'map3d', 'arrival'],
    tollStop: 1,
    km: 5.3,
  },
  {
    id: 'dash',
    title: 'DASH to Penchala Link and its tunnel',
    summary: 'Off the elevated DASH at exit 3110A, down onto Penchala Link and through the Penchala tunnel.',
    link: 'from=3.15696,101.59416@79 (DASH eastbound)&to=3.16528,101.64620 (Penchala Link)&sim=2',
    checks: ['route', 'junction', 'exitNumber', 'flyover', 'descend', 'map3d', 'tunnelSign', 'dr', 'arrival'],
    km: 7,
  },
  {
    id: 'mex',
    title: 'MEX down to Jalan Tun Razak',
    summary: 'North on MEX, off at exit 2001 down the ramp at Kampung Pandan, then under the junction.',
    link: 'from=3.11065,101.71169@40 (MEX northbound)&to=3.15033,101.72285 (Jalan Tun Razak)&sim=2',
    checks: ['route', 'junction', 'exitNumber', 'descend', 'map3d', 'tunnelSign', 'dr', 'lanes', 'arrival'],
    km: 4.8,
  },
  {
    id: 'duke',
    title: 'DUKE into the Wangsa Maju underpass',
    summary: 'Off DUKE at Setiawangsa, down into the underpass and through the tunnel at Wangsa Maju.',
    link: 'from=3.18325,101.71860@119 (DUKE eastbound)&to=3.20160,101.73602 (Wangsa Maju)&sim=2',
    checks: ['route', 'lanes', 'junction', 'exitNumber', 'underpass', 'map3d', 'tunnel', 'tunnelSign', 'dr', 'arrival'],
    km: 4.4,
  },
  {
    id: 'smart',
    title: 'SMART tunnel',
    summary: 'Into the 4 km SMART tunnel from Jalan Sungai Besi: lane advice, the tunnel sign, then guidance without GPS all the way through.',
    link: 'from=3.08625,101.69764@338 (Jalan Sungai Besi)&via=3.11466,101.70567@21 (SMART tunnel)&to=3.14422,101.71207 (Jalan Sultan Ismail)&sim=2',
    checks: ['route', 'lanes', 'junction', 'tunnelSign', 'dr', 'arrival'],
    km: 8.1,
  },
];

export function driveQuery(d: TestDrive): string {
  return `?${d.link}`;
}
