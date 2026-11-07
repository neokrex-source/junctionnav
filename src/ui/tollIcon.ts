/**
 * The toll plaza glyph: a booth with its striped barrier, in a 24-unit box. One drawing for the
 * chip over the arrival time (SVG) and the plaza's icon on the map (canvas).
 */
export const TOLL_GLYPH = ['M2 21h20', 'M4 21V10l3.5-3 3.5 3v11', 'M6 12.5h3v3H6z', 'M11 12.5h10v3H11z', 'M14.5 12.5l-1.5 3M18.5 12.5l-1.5 3'];

export function tollSvg(cls = 'toll-ico'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TOLL_GLYPH.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
}

/** The map icon: the glyph on an amber disc with a white ring (drawn at twice its size on screen). */
export function tollImage(size = 64): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const r = size / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(r, r, r - 6, 0, Math.PI * 2);
  ctx.fillStyle = '#f59e0b';
  ctx.fill();
  const g = (size - 22) / 24;
  ctx.save();
  ctx.translate(11, 10);
  ctx.scale(g, g);
  ctx.strokeStyle = '#2b1d00';
  ctx.lineWidth = 2.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of TOLL_GLYPH) ctx.stroke(new Path2D(d));
  ctx.restore();
  return ctx.getImageData(0, 0, size, size);
}
