/**
 * Day or night from the sun, for the automatic appearance: the app turns dark at sunset and
 * bright at sunrise where the user is, instead of at fixed hours (Kuala Lumpur's sunset is near
 * 19:20 all year, Tokyo's moves between 16:30 and 19:00).
 */

/** Sun altitude above the horizon in degrees (NOAA's low-precision formulas, within about 0.1°). */
export function sunAltitude(date: Date, lat: number, lng: number): number {
  const rad = Math.PI / 180;
  const n = date.getTime() / 86_400_000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  const ha = (gmst + lng) * rad - ra;
  const phi = lat * rad;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha)) / rad;
}

/** The sun's upper edge is above the horizon (sunrise to sunset, refraction included). */
export function isDaylight(date: Date, lat: number, lng: number): boolean {
  return sunAltitude(date, lat, lng) > -0.833;
}

/** Next sunrise or sunset after `date`, to the minute (null near the poles in summer or winter). */
export function nextSunChange(date: Date, lat: number, lng: number): Date | null {
  const day = isDaylight(date, lat, lng);
  const step = 10 * 60_000;
  let t = date.getTime();
  for (let i = 0; i < (26 * 3600_000) / step; i++) {
    const next = t + step;
    if (isDaylight(new Date(next), lat, lng) !== day) {
      let lo = t;
      let hi = next;
      while (hi - lo > 60_000) {
        const mid = (lo + hi) / 2;
        if (isDaylight(new Date(mid), lat, lng) === day) lo = mid;
        else hi = mid;
      }
      return new Date(hi);
    }
    t = next;
  }
  return null;
}
