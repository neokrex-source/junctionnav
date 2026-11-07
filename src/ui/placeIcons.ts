/**
 * Icons for the kinds of places: a white pictogram on a disc in the kind's colour, like a map pin's
 * head. One drawing (24-unit stroke paths) for the map (canvas images, `place-<group>`) and the
 * place card (SVG).
 */
import { GROUPS, type PlaceGroup } from '../places/format';

export const PLACE_GLYPHS: Record<PlaceGroup, string[]> = {
  food: ['M7 3v8', 'M4.5 3v5a2.5 2.5 0 0 0 5 0V3', 'M7 11v10', 'M17 21V3c-2.5 1-3.5 4-3.5 7.5 0 2 1.5 3 3.5 3'],
  cafe: ['M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z', 'M16 10h1.5a2.5 2.5 0 0 1 0 5H16', 'M8 3c0 1.5 1 1.5 1 3', 'M12 3c0 1.5 1 1.5 1 3'],
  grocery: ['M3 4h2.5l2 11h10l2-7.5H6.5', 'M9.5 19.5a1 1 0 1 0 0.01 0', 'M16.5 19.5a1 1 0 1 0 0.01 0'],
  mall: ['M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z', 'M9 8V6a3 3 0 0 1 6 0v2'],
  shop: ['M4 9.5 5.5 4h13L20 9.5', 'M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0', 'M5.5 12v8h13v-8', 'M10 20v-4.5h4V20'],
  fuel: ['M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16', 'M3 21h12', 'M6 9h6', 'M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3'],
  ev: ['M13 2 5 13.5h6l-1 8.5 8-11.5h-6z'],
  parking: ['M9 20V4h4.5a4.5 4.5 0 0 1 0 9H9'],
  car: ['M5 16.5l1.6-5.2A2 2 0 0 1 8.5 10h7a2 2 0 0 1 1.9 1.3l1.6 5.2', 'M4 16.5h16V20H4z', 'M7 20v1.5', 'M17 20v1.5'],
  rest: ['M4 10h12v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z', 'M16 11h1.5a2.5 2.5 0 0 1 0 5H16', 'M3 21h16', 'M8 3.5c0 1.5 1 1.5 1 3', 'M12 3.5c0 1.5 1 1.5 1 3'],
  hotel: ['M3 18V6', 'M3 14h18v4', 'M21 18v-5a2 2 0 0 0-2-2h-8v3', 'M7 11.5a1.5 1.5 0 1 0 0.01 0'],
  health: ['M12 5v14', 'M5 12h14'],
  education: ['M2 9.5 12 5l10 4.5-10 4.5z', 'M6 11.5V16c3 2.2 9 2.2 12 0v-4.5', 'M22 9.5v5'],
  worship: ['M12 3.5c-3 2.5-5 5-5 7.5h10c0-2.5-2-5-5-7.5z', 'M5.5 11h13v9h-13z', 'M10 20v-4a2 2 0 0 1 4 0v4'],
  bank: ['M3 9.5 12 4l9 5.5z', 'M5.5 10.5v7', 'M10 10.5v7', 'M14 10.5v7', 'M18.5 10.5v7', 'M3 20h18'],
  government: ['M6 21V4', 'M6 4h11l-2 4 2 4H6'],
  transport: ['M7 3h10a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2z', 'M5 10h14', 'M8.5 21l2-4', 'M15.5 21l-2-4'],
  attraction: ['M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z'],
  park: ['M12 3l5.5 8H14l4.5 6h-13L10 11H6.5z', 'M12 17v4'],
  sport: ['M4 9v6', 'M7 7v10', 'M17 7v10', 'M20 9v6', 'M7 12h10'],
  leisure: ['M4 6h16v12H4z', 'M4 10h16', 'M8 6v4', 'M12 6v4', 'M16 6v4'],
  service: ['M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.4 2.4-2.6-.4-.4-2.6z'],
  office: ['M4 8h16v11H4z', 'M9 8V5.5h6V8', 'M4 13h16'],
  locality: ['M12 11a1 1 0 1 0 0.01 0'],
  other: ['M12 9.5a2.5 2.5 0 1 0 0.01 0'],
};

/** The pictogram on its disc, for the place card. */
export function placeSvg(group: PlaceGroup, cls = 'place-ico'): string {
  const g = PLACE_GLYPHS[group] ?? PLACE_GLYPHS.other;
  return `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="${GROUPS[group]?.color ?? GROUPS.other.color}"/><g transform="translate(5 5) scale(0.9167)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${g.map((d) => `<path d="${d}"/>`).join('')}</g></svg>`;
}

/** The map icon: the disc with a white ring, drawn at twice its size on screen. */
export function placeImage(group: PlaceGroup, size = 44): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const r = size / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - 1, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(r, r, r - 4, 0, Math.PI * 2);
  ctx.fillStyle = GROUPS[group]?.color ?? GROUPS.other.color;
  ctx.fill();
  const inner = size - 16;
  ctx.save();
  ctx.translate(8, 8);
  ctx.scale(inner / 24, inner / 24);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of PLACE_GLYPHS[group] ?? PLACE_GLYPHS.other) ctx.stroke(new Path2D(d));
  ctx.restore();
  return ctx.getImageData(0, 0, size, size);
}
