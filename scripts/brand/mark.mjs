#!/usr/bin/env node
// The JunctionNav mark, drawn once here and written out for every place it appears:
//   public/icon.svg            the app icon (web, favicon, manifest)
//   public/icon-maskable.svg   the same with room for round and squircle masks
//   scripts/brand/mark-*.svg   the mark alone (for the Android foreground, splash and docs)
// The PNG sizes are made from these by scripts/brand/icons.cjs.
//
// The design: the road ahead seen from the driver's seat, splitting at the horizon. The approach
// runs in perspective with its lane dashes; the branch not taken fades off to the left; the branch
// taken curves right, lit from lilac into the orange the app gives every junction, ending in an
// arrowhead. "See every split before you reach it."
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (n) => Math.round(n * 10) / 10;

// The taken branch: a cubic from the fork up and to the right, and its arrowhead along the end tangent.
const FORK = [256, 300];
const TAKEN = [[256, 300], [272, 254], [300, 220], [334, 192]];
const OTHER = [[256, 300], [240, 254], [210, 214], [174, 184]];
const end = TAKEN[3];
const prev = TAKEN[2];
const len = Math.hypot(end[0] - prev[0], end[1] - prev[1]);
const d = [(end[0] - prev[0]) / len, (end[1] - prev[1]) / len];
const n = [-d[1], d[0]];
const head = (scale = 1) => {
  const back = 10 * scale;
  const tip = [end[0] + d[0] * 92 * scale, end[1] + d[1] * 92 * scale];
  const a = [end[0] - d[0] * back + n[0] * 48 * scale, end[1] - d[1] * back + n[1] * 48 * scale];
  const b = [end[0] - d[0] * back - n[0] * 48 * scale, end[1] - d[1] * back - n[1] * 48 * scale];
  // A navigation arrowhead: swept-back barbs with a notch where the road comes in.
  const notch = [end[0] + d[0] * 16 * scale, end[1] + d[1] * 16 * scale];
  return `M${f(tip[0])} ${f(tip[1])}L${f(a[0])} ${f(a[1])}L${f(notch[0])} ${f(notch[1])}L${f(b[0])} ${f(b[1])}Z`;
};
const cubic = (c) => `M${c[0][0]} ${c[0][1]}C${c[1][0]} ${c[1][1]} ${c[2][0]} ${c[2][1]} ${c[3][0]} ${c[3][1]}`;

/** The mark's shapes, in the 512 box; `ink` for the one-colour version. */
function shapes(id, ink = null, fade = false) {
  const road = ink ?? (fade ? `url(#${id}-fade)` : '#ffffff');
  const take = ink ?? `url(#${id}-take)`;
  const arrow = ink ?? '#fb923c';
  const dash = ink ? '#000000' : '#1c0d36';
  const other = ink ? `stroke="${ink}" stroke-opacity=".45"` : 'stroke="#ffffff" stroke-opacity=".4"';
  return [
    ink ? '' : `<path d="M86 168H426" stroke="#c4a1ff" stroke-opacity=".38" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="${cubic(OTHER)}" fill="none" ${other} stroke-width="40" stroke-linecap="round"/>`,
    `<path d="M132 512L228 ${FORK[1]}H284L380 512Z" fill="${road}"/>`,
    `<path d="${cubic(TAKEN)}" fill="none" stroke="${take}" stroke-width="50" stroke-linecap="round"/>`,
    `<path d="${head()}" fill="${arrow}" stroke="${arrow}" stroke-width="6" stroke-linejoin="round"/>`,
    ink ? '' : `<path d="M248.5 502h15l-2.6-64h-9.8zM251.2 410h9.6l-1.6-46h-6.4zM252.8 340h6.4l-1-28h-4.4z" fill="${dash}"/>`,
  ].join('');
}

function defs(id) {
  return (
    `<linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b1b74"/><stop offset=".58" stop-color="#1c0d36"/><stop offset="1" stop-color="#0b0910"/></linearGradient>` +
    `<radialGradient id="${id}-glow" cx=".5" cy=".3" r=".56"><stop offset="0" stop-color="#b77bff" stop-opacity=".5"/><stop offset="1" stop-color="#b77bff" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id}-fade" gradientUnits="userSpaceOnUse" x1="0" y1="300" x2="0" y2="512"><stop offset=".45" stop-color="#ffffff"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="${id}-take" gradientUnits="userSpaceOnUse" x1="256" y1="300" x2="390" y2="150"><stop offset="0" stop-color="#e9d5ff"/><stop offset=".45" stop-color="#c084fc"/><stop offset="1" stop-color="#fb923c"/></linearGradient>`
  );
}

const svg = (body, box = '0 0 512 512') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${body}</svg>\n`;

/** The app icon: the mark on the plum squircle (`pad`: shrink the mark for round masks). */
function icon(id, { rx = 112, pad = 0 } = {}) {
  const s = 1 - pad;
  const t = (512 * pad) / 2;
  const clip = `<clipPath id="${id}-clip"><rect width="512" height="512" rx="${rx}"/></clipPath>`;
  return svg(
    `<defs>${defs(id)}${clip}</defs><g clip-path="url(#${id}-clip)"><rect width="512" height="512" fill="url(#${id}-bg)"/><rect width="512" height="512" fill="url(#${id}-glow)"/>` +
      `<g transform="translate(${t} ${t}) scale(${s})">${shapes(id)}</g></g>`,
  );
}

const out = (p, s) => {
  mkdirSync(dirname(join(ROOT, p)), { recursive: true });
  writeFileSync(join(ROOT, p), s);
  console.log('wrote', p);
};

out('public/icon.svg', icon('jn'));
// Maskable: full-bleed background, the mark inside the round safe zone (80%).
out('public/icon-maskable.svg', icon('jnm', { rx: 0, pad: 0.12 }));
// The mark alone, in colour (for dark grounds) and in one colour (Android's themed icons).
out('scripts/brand/mark.svg', svg(`<defs>${defs('jk')}</defs>${shapes('jk')}`));
out('scripts/brand/mark-mono.svg', svg(shapes('jo', '#ffffff')));
// On its own on a dark ground (launch screens, the web splash): the approach fades in from below.
out('scripts/brand/mark-fade.svg', svg(`<defs>${defs('jd')}</defs>${shapes('jd', null, true)}`));
// Full bleed (Apple touch icon, the round launcher icon): the system rounds the corners itself.
out('scripts/brand/full.svg', icon('jf', { rx: 0 }));
// Android's adaptive icon foreground: a 108 dp canvas, the mark in the middle 72 dp, and the
// road running on to the bottom edge so the mask cuts it off the way the icon's own corner does.
const FG = '-128 -128 768 768';
const longRoad = 'M74 640L228 300H284L438 640Z';
out('scripts/brand/fg.svg', svg(`<defs>${defs('jg')}</defs>${shapes('jg').replace(`M132 512L228 ${FORK[1]}H284L380 512Z`, longRoad)}`, FG));
// Its one-colour twin for themed icons: the dashes cut out of the road.
out(
  'scripts/brand/fg-mono.svg',
  svg(
    `<path d="${cubic(OTHER)}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="40" stroke-linecap="round"/>` +
      `<path fill-rule="evenodd" fill="#fff" d="${longRoad}M248.5 502h15l-2.6-64h-9.8zM251.2 410h9.6l-1.6-46h-6.4zM252.8 340h6.4l-1-28h-4.4z"/>` +
      `<path d="${cubic(TAKEN)}" fill="none" stroke="#fff" stroke-width="50" stroke-linecap="round"/><path d="${head()}" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>`,
    FG,
  ),
);
// For the HTML splash and the sign-in screen: the mark's parts as strings.
out(
  'scripts/brand/mark.json',
  JSON.stringify({ other: cubic(OTHER), road: `M132 512L228 ${FORK[1]}H284L380 512Z`, taken: cubic(TAKEN), head: head(), dashes: 'M248.5 502h15l-2.6-64h-9.8zM251.2 410h9.6l-1.6-46h-6.4zM252.8 340h6.4l-1-28h-4.4z' }, null, 1) + '\n',
);
