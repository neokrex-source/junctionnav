/** SVG icons for maneuvers and lanes (24×24 viewBox, stroke-based, uses currentColor). */
import type { ManeuverType, Modifier } from '../routing/types';

const MOD_ANGLE: Record<string, number> = {
  straight: 0,
  'slight right': 45,
  right: 90,
  'sharp right': 135,
  'slight left': -45,
  left: -90,
  'sharp left': -135,
};

function head(x: number, y: number, angle: number, size = 4.2): string {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const px = -dy;
  const py = dx;
  const tip = [x + dx * size * 0.9, y + dy * size * 0.9];
  const l = [x - px * size, y - py * size];
  const r = [x + px * size, y + py * size];
  return `<path d="M${l[0].toFixed(2)} ${l[1].toFixed(2)} L${tip[0].toFixed(2)} ${tip[1].toFixed(2)} L${r[0].toFixed(2)} ${r[1].toFixed(2)} Z" fill="currentColor" stroke="none"/>`;
}

function turn(angle: number, opts: { faint?: boolean; stroke?: number } = {}): string {
  const sw = opts.stroke ?? 2.6;
  const a = (angle * Math.PI) / 180;
  const midY = Math.abs(angle) > 100 ? 13 : 11.5;
  const len = Math.abs(angle) > 100 ? 6 : 6.5;
  const ex = 12 + Math.sin(a) * len;
  const ey = midY - Math.cos(a) * len;
  const path = `<path d="M12 21.5 V${midY} L${ex.toFixed(2)} ${ey.toFixed(2)}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${opts.faint ? ' opacity=".35"' : ''}/>`;
  return path + (opts.faint ? '' : head(ex, ey, angle));
}

function svg(body: string, cls = 'ico'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

export function maneuverIcon(type: ManeuverType, modifier: Modifier | undefined, drivingSide: 'left' | 'right' = 'right'): string {
  const m = modifier ?? 'straight';
  switch (type) {
    case 'arrive':
      return svg(
        '<path d="M12 21.5s6.5-6.1 6.5-11A6.5 6.5 0 0 0 5.5 10.5c0 4.9 6.5 11 6.5 11z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="12" cy="10.3" r="2.4" fill="currentColor"/>',
      );
    case 'depart':
      return svg('<path d="M12 3.5 19 20 12 16.2 5 20z" fill="currentColor"/>');
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
    case 'exit roundabout':
    case 'exit rotary': {
      const ang = MOD_ANGLE[m] ?? 0;
      const a = (ang * Math.PI) / 180;
      const ex = 12 + Math.sin(a) * 9;
      const ey = 10 - Math.cos(a) * 9;
      return svg(
        `<circle cx="12" cy="10" r="4.2" fill="none" stroke="currentColor" stroke-width="2.4"/>` +
          `<path d="M12 21.5 V14.2" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>` +
          `<path d="M${(12 + Math.sin(a) * 4.2).toFixed(2)} ${(10 - Math.cos(a) * 4.2).toFixed(2)} L${ex.toFixed(2)} ${ey.toFixed(2)}" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>` +
          head(ex, ey, ang, 3.6),
      );
    }
    case 'merge': {
      const side = m.includes('left') ? -1 : 1;
      return svg(
        `<path d="M12 21.5 V4" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" opacity=".35"/>` +
          `<path d="M${12 - side * 6} 21.5 C${12 - side * 6} 15 12 14 12 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>` +
          head(12, 7.5, 0),
      );
    }
    case 'fork': {
      const side = m.includes('left') ? -1 : 1;
      return svg(
        `<path d="M12 21.5 V13 L${12 - side * 5.5} 5.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".35"/>` +
          `<path d="M12 21.5 V13 L${12 + side * 5.5} 5.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` +
          head(12 + side * 5.5, 5.5, side * 36),
      );
    }
    case 'off ramp':
    case 'on ramp': {
      const side = m.includes('left') ? -1 : 1;
      return svg(turn(0, { faint: true }) + turn(side * 45));
    }
    default: {
      if (m === 'uturn') {
        const s = drivingSide === 'left' ? 1 : -1;
        const x0 = 12 - s * 4;
        const x1 = 12 + s * 4;
        return svg(
          `<path d="M${x0} 21.5 V10 a4 4 0 0 1 ${s * 8} 0 V14.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>` +
            head(x1, 15.5, 180),
        );
      }
      return svg(turn(MOD_ANGLE[m] ?? 0));
    }
  }
}

const IND_ANGLE: Record<string, number> = {
  straight: 0,
  none: 0,
  'slight right': 45,
  right: 90,
  'sharp right': 135,
  'slight left': -45,
  left: -90,
  'sharp left': -135,
};

/** Lane icon with every indication drawn; the one matching `active` is emphasised. */
export function laneIcon(indications: string[], valid: boolean, drivingSide: 'left' | 'right' = 'right'): string {
  const inds = indications.length ? indications : ['straight'];
  let body = '';
  for (const ind of inds) {
    if (ind === 'uturn') {
      const s = drivingSide === 'left' ? 1 : -1;
      body += `<path d="M${12 - s * 3.5} 21.5 V11 a3.5 3.5 0 0 1 ${s * 7} 0 V14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>${head(12 + s * 3.5, 15, 180, 3.4)}`;
    } else {
      body += turn(IND_ANGLE[ind] ?? 0, { stroke: 2.4 });
    }
  }
  return svg(body, `ico lane ${valid ? 'is-valid' : 'is-invalid'}`);
}
