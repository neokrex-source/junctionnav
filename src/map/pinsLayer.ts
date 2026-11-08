/**
 * Your pins on the map (src/pins/pins.ts): a pin you can tap for its card and drag to move, with
 * an arrow on the ground beside it when it has a direction of travel. The arrow lies on the map,
 * so it turns and tilts with it.
 */
import maplibregl from 'maplibre-gl';
import type { LngLat } from '../geo/geo';
import type { Pin } from '../pins/pins';
import { ARROW_SVG } from '../pins/heading';

export const USER_PIN_SVG = `<svg viewBox="0 0 30 40" aria-hidden="true"><path class="up-body" d="M15 39s13-12.3 13-23A13 13 0 0 0 2 16c0 10.7 13 23 13 23z" stroke-width="2"/><circle class="up-dot" cx="15" cy="15.5" r="5.2"/></svg>`;

interface Item {
  pin: maplibregl.Marker;
  el: HTMLButtonElement;
  arrow: maplibregl.Marker | null;
  heading: number | null;
  /** When the last drag ended: the click that follows a drag is not a tap. */
  draggedAt: number;
}

/** The ground arrow: a box turned to the heading around the pin's point, the arrow at its top. */
export function headingArrow(heading: number, cls = 'pin-heading'): maplibregl.Marker {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = `<span class="ph-arrow">${ARROW_SVG}</span>`;
  return new maplibregl.Marker({ element: el, anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'map', rotation: heading });
}

export class PinsLayer {
  private items = new Map<string, Item>();

  constructor(
    private map: maplibregl.Map,
    private cb: { click: (id: string) => void; moved: (id: string, p: LngLat) => void },
  ) {}

  render(pins: Pin[], opts: { draggable: boolean; selected: string | null; hidden?: boolean }) {
    const keep = new Set(opts.hidden ? [] : pins.map((p) => p.id));
    for (const [id, it] of this.items) {
      if (keep.has(id)) continue;
      it.pin.remove();
      it.arrow?.remove();
      this.items.delete(id);
    }
    if (opts.hidden) return;
    for (const p of pins) {
      let it = this.items.get(p.id);
      if (!it) it = this.create(p);
      it.pin.setLngLat(p.lngLat);
      it.pin.setDraggable(opts.draggable);
      it.el.classList.toggle('is-selected', p.id === opts.selected);
      it.el.setAttribute('aria-label', `Pin: ${p.name}`);
      it.el.title = p.name;
      if (p.heading == null) {
        it.arrow?.remove();
        it.arrow = null;
      } else {
        if (!it.arrow) it.arrow = headingArrow(p.heading).setLngLat(p.lngLat).addTo(this.map);
        it.arrow.setLngLat(p.lngLat).setRotation(p.heading);
      }
      it.heading = p.heading;
    }
  }

  private create(p: Pin): Item {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'user-pin';
    el.innerHTML = USER_PIN_SVG;
    const pin = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat(p.lngLat).addTo(this.map);
    const it: Item = { pin, el, arrow: null, heading: null, draggedAt: 0 };
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Date.now() - it.draggedAt < 400) return;
      this.cb.click(p.id);
    });
    pin.on('dragstart', () => el.classList.add('is-dragging'));
    pin.on('drag', () => it.arrow?.setLngLat(pin.getLngLat()));
    pin.on('dragend', () => {
      el.classList.remove('is-dragging');
      it.draggedAt = Date.now();
      const ll = pin.getLngLat();
      this.cb.moved(p.id, [ll.lng, ll.lat]);
    });
    this.items.set(p.id, it);
    return it;
  }
}
