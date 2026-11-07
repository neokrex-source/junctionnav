/** The "Places around you" section of Settings: what is on the device, update now, remove, and the schedule. */
import type { PlacesService } from '../places/service';
import { UPDATE_LABELS } from '../places/schedule';
import type { Settings } from '../state/settings';
import { h } from './dom';
import { formatBytes } from './offlinePanel';

function ago(t: number): string {
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export interface PlacesControls {
  el: HTMLElement;
  update: HTMLSelectElement;
  radius: HTMLSelectElement;
  wifiOnly: HTMLInputElement;
  onMap: HTMLInputElement;
  dispose: () => void;
}

/**
 * Builds the section. It follows the service while it is on screen; call `dispose` when the
 * dialog closes (an update under way carries on).
 */
export function placesPanel(svc: PlacesService, current: Settings): PlacesControls {
  const update = h('select', { id: 'placesUpdate', name: 'placesUpdate' }) as HTMLSelectElement;
  for (const [v, t] of UPDATE_LABELS) update.append(h('option', { value: v }, t));
  update.value = current.placesUpdate;
  const radius = h('select', { id: 'placesRadius', name: 'placesRadius' }) as HTMLSelectElement;
  for (const km of [50, 100, 150]) radius.append(h('option', { value: String(km) }, `Within ${km} km of where you are`));
  radius.value = String(current.placesRadius);
  const wifiOnly = h('input', { id: 'placesWifiOnly', type: 'checkbox' }) as HTMLInputElement;
  wifiOnly.checked = current.placesWifiOnly;
  const onMap = h('input', { id: 'placesOnMap', type: 'checkbox' }) as HTMLInputElement;
  onMap.checked = current.placesOnMap;

  const status = h('div', { class: 'pl-status', role: 'status', 'aria-live': 'polite' });
  const bar = h('progress', { class: 'off-bar', max: '1', value: '0', hidden: '' }) as HTMLProgressElement;
  const now = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Update now');
  const remove = h('button', { type: 'button', class: 'btn btn-ghost pl-remove' }, 'Remove');
  // Only what changed (or is missing) comes down: the manifest's hashes tell.
  now.addEventListener('click', () => void svc.update(false, true));
  remove.addEventListener('click', () => void svc.clear());

  const render = () => {
    const st = svc.state;
    const s = svc.status;
    status.dataset.kind = s.kind;
    if (s.kind === 'updating') {
      status.textContent = s.total ? `Downloading places… ${formatBytes(s.done)} of ${formatBytes(s.total)}` : 'Checking for new places…';
      bar.hidden = false;
      bar.value = s.total ? s.done / s.total : 0;
    } else {
      bar.hidden = true;
      const parts: string[] = [];
      if (st && st.count) {
        parts.push(`${st.count.toLocaleString()} places within ${st.radiusKm} km of ${st.area ?? 'where you were'}`);
        parts.push(`updated ${ago(st.updatedAt)}${day(st.built) ? ` (data of ${day(st.built)})` : ''}`);
        if (st.bytes) parts.push(formatBytes(st.bytes));
      } else {
        parts.push('No places downloaded yet.');
        parts.push(update.value === 'manual' ? 'Tap Update now to get them.' : `They download by themselves${wifiOnly.checked ? ' on Wi-Fi' : ''}, or tap Update now.`);
      }
      status.textContent = parts.join(' · ');
      if (s.kind === 'error') status.append(h('div', { class: 'pl-error' }, `Could not update: ${s.message}`));
    }
    now.toggleAttribute('disabled', s.kind === 'updating');
    remove.hidden = !(st && st.count) || s.kind === 'updating';
  };
  render();
  const off = svc.onChange(render);
  update.addEventListener('change', render);
  wifiOnly.addEventListener('change', render);

  const el = h(
    'div',
    { class: 'grp places-grp' },
    h('label', { for: 'placesUpdate' }, 'Places around you'),
    status,
    bar,
    h('div', { class: 'off-actions' }, now, remove),
    update,
    radius,
    h('label', { class: 'toggle' }, wifiOnly, 'Download only on Wi-Fi'),
    h('label', { class: 'toggle' }, onMap, 'Show places on the map'),
    h(
      'div',
      { class: 'hint' },
      'Restaurants, cafés, shops, petrol stations, clinics, mosques, schools, banks and more around your city, from Overture Maps (businesses from Meta, Microsoft and others) and OpenStreetMap, rebuilt every week. They show on the map with their kind, address, phone and opening hours, and in search and the category buttons, also without internet. Moving to a new city brings its places at the next check. About 10 to 40 MB, depending on the city.',
    ),
  );
  return { el, update, radius, wifiOnly, onMap, dispose: off };
}
