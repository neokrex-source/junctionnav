/**
 * The car traffic jam icon: a car seen from the front with another queuing behind it, on a
 * 24 × 24 grid. Used for the traffic button and for jams (map icon, chip, lists, the popup).
 */
export const JAM_FRONT =
  'M4.4 8.5H12.6A1.2 1.2 0 0 1 13.7 9.25L15 12.6A1.6 1.6 0 0 1 15.5 13.7V18A.8.8 0 0 1 14.7 18.8H14.5V20.2A.8.8 0 0 1 13.7 21H12.3A.8.8 0 0 1 11.5 20.2V18.8H5.5V20.2A.8.8 0 0 1 4.7 21H3.3A.8.8 0 0 1 2.5 20.2V18.8H2.3A.8.8 0 0 1 1.5 18V13.7A1.6 1.6 0 0 1 2 12.6L3.3 9.25A1.2 1.2 0 0 1 4.4 8.5ZM5.1 9.9H11.9L12.9 12.4H4.1ZM3.4 15.4A1.1 1.1 0 1 0 5.6 15.4A1.1 1.1 0 1 0 3.4 15.4ZM11.4 15.4A1.1 1.1 0 1 0 13.6 15.4A1.1 1.1 0 1 0 11.4 15.4Z';
export const JAM_BACK = 'M10.3 7.4 11.6 4.3A1.3 1.3 0 0 1 12.8 3.5H19.2A1.3 1.3 0 0 1 20.4 4.3L21.7 7.4M9.2 7.4H21.8A1 1 0 0 1 22.8 8.4V13.2A1 1 0 0 1 21.8 14.2H17.2M21.4 14.2V16M19.6 10.8H20.8';
/** Line width of the car behind, in grid units. */
export const JAM_BACK_WIDTH = 1.6;

export function jamSvg(cls = 'ico'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${JAM_FRONT}"/><path fill="none" stroke="currentColor" stroke-width="${JAM_BACK_WIDTH}" stroke-linecap="round" stroke-linejoin="round" d="${JAM_BACK}"/></svg>`;
}
