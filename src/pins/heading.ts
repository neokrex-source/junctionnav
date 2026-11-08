/** A pin's direction of travel: compass names, labels and the arrow's screen angle. */
import type { LangCode } from '../routing/instructions';

const SHORT: Record<LangCode, string[]> = {
  en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  ms: ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL'],
  ja: ['北', '北東', '東', '南東', '南', '南西', '西', '北西'],
};
const LONG: Record<LangCode, string[]> = {
  en: ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'],
  ms: ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'],
  ja: ['北', '北東', '東', '南東', '南', '南西', '西', '北西'],
};

/** 0 to 360, rounded to a whole degree. */
export function normHeading(h: number): number {
  return ((Math.round(h) % 360) + 360) % 360;
}

const octant = (h: number) => Math.round(normHeading(h) / 45) % 8;

/** "NE" (short) or "north-east" (long). */
export function compass(h: number, lang: LangCode, long = false): string {
  return (long ? LONG : SHORT)[lang][octant(h)];
}

/** "north-east (47°)". */
export function headingText(h: number, lang: LangCode): string {
  return `${compass(h, lang, true)} (${normHeading(h)}°)`;
}

/** An arrow that points the way: rotate it by the heading less the map's bearing. */
export const ARROW_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 19 20l-7-3.6L5 20z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
