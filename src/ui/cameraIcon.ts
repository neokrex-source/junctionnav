/**
 * The speed camera glyph: a camera body with its lens, in a 24-unit box. One drawing for the
 * chip over the arrival time (SVG) and the camera's icon on the map (canvas).
 */
export const CAMERA_GLYPH = ['M3.5 8.5h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 2 16v-6a1.5 1.5 0 0 1 1.5-1.5z', 'M16 11.5l5.5-3v9l-5.5-3', 'M5.5 5.5h4', 'M9 13a1.6 1.6 0 1 0-3.2 0a1.6 1.6 0 1 0 3.2 0z'];

export function cameraSvg(cls = 'cam-ico'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CAMERA_GLYPH.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
}

/** The map icon: the glyph in white on a red disc with a white ring (drawn at twice its size on screen). */
export function cameraImage(size = 64): ImageData {
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
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  const g = (size - 22) / 24;
  ctx.save();
  ctx.translate(11, 11);
  ctx.scale(g, g);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of CAMERA_GLYPH) ctx.stroke(new Path2D(d));
  ctx.restore();
  return ctx.getImageData(0, 0, size, size);
}
