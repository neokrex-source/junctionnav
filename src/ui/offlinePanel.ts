/**
 * The "Offline maps" section of Settings: the countries and regions of Asia to download, each
 * with its size, progress, pause and resume, update and delete; what is on the device; and
 * whether the browser will keep it.
 */
import type { PackManifest } from '../offline/graphLayout';
import { deviceSize, downloadSize, packName, type Catalog, type CatalogEntry, type InstalledPack, type JobState, type OfflineStore, type PackGroup } from '../offline/store';
import { NATIVE } from '../platform';
import { h } from './dom';

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

const builtOn = (m: PackManifest) => {
  const d = new Date(m.built);
  return Number.isNaN(d.getTime()) ? m.version : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export const GROUP_NAMES: Record<PackGroup, string> = {
  sea: 'Southeast Asia',
  east: 'East Asia',
  south: 'South Asia',
  central: 'Central Asia',
  west: 'West Asia',
};
const GROUP_ORDER: PackGroup[] = ['sea', 'east', 'south', 'central', 'west'];

export interface OfflinePanelOptions {
  /** The app's language, for the country names. */
  lang: string;
  /** Where the map is, to open that part of the list first. */
  at?: [number, number] | null;
}

/**
 * Builds the section. It follows the store while it is on screen; call the returned `dispose`
 * when the dialog closes (downloads carry on).
 */
export function offlinePanel(store: OfflineStore, use: HTMLSelectElement, o: OfflinePanelOptions = { lang: 'en' }): { el: HTMLElement; dispose: () => void } {
  const status = h('div', { class: 'off-status', role: 'status', 'aria-live': 'polite' });
  const keepEl = h('div', { class: 'off-keep', role: 'status', 'aria-live': 'polite', hidden: '' });
  const filter = h('input', { type: 'search', class: 'off-filter', id: 'offFilter', placeholder: 'Find a country or region', 'aria-label': 'Find a country or region', autocomplete: 'off' }) as HTMLInputElement;
  const listEl = h('div', { class: 'off-list' });
  const el = h(
    'div',
    { class: 'grp off' },
    h('label', { for: 'offFilter' }, 'Offline maps by country'),
    status,
    keepEl,
    filter,
    listEl,
    use,
    h(
      'div',
      { class: 'hint' },
      `Download the countries you drive in. With no signal, the map, directions, place search, lane advice, tunnel signs and the hills in the 3D junction view keep working in them; a route offline stays within one download. Big countries come in regions. Buildings around junctions still need internet.${NATIVE ? '' : ' In the browser, the maps published with the site download here; the rest download in the JunctionNav Android app.'}`,
    ),
  );
  let catalog: Catalog | null = null;
  let catalogError = '';
  let loading = false;
  /** After a delete: what was freed. */
  let notice = '';
  let kept: boolean | null | undefined;
  let keptFor = '';
  let keepAsked = false;
  /** Groups opened or closed by hand. */
  const open = new Map<PackGroup, boolean>();

  const btn = (label: string, fn: () => void, cls = 'btn btn-ghost') => {
    const b = h('button', { type: 'button', class: cls }, label);
    b.addEventListener('click', fn);
    return b;
  };

  function paintKeep() {
    keepEl.replaceChildren();
    keepEl.hidden = !store.ready || kept == null;
    if (keepEl.hidden) return;
    keepEl.dataset.kept = String(!!kept);
    if (kept) {
      const why = NATIVE ? "they're stored in the app, so Android won't clear them to free up space." : "the browser won't clear these maps to free up space.";
      keepEl.append(h('span', { class: 'off-keep-dot', 'aria-hidden': 'true' }), h('span', {}, `Kept on this device: ${why}`));
      return;
    }
    const text = keepAsked
      ? "The browser hasn't agreed to keep them yet. Adding JunctionNav to your home screen usually lets it."
      : 'The browser may clear these maps if the device runs low on space.';
    const ask = btn('Keep them', () => {
      keepAsked = true;
      void store.keep().then((k) => {
        kept = k;
        paintKeep();
      });
    });
    keepEl.append(h('span', { class: 'off-keep-dot', 'aria-hidden': 'true' }), h('span', {}, text), ask);
  }

  function checkKept() {
    const id = store.installed.map((p) => p.dir[1]).join('|');
    if (id === keptFor) return;
    keptFor = id;
    kept = undefined;
    paintKeep();
    if (id)
      void store.kept().then((k) => {
        if (keptFor !== id) return;
        kept = k;
        paintKeep();
      });
  }

  const load = async (force = false) => {
    if (loading) return;
    loading = true;
    render();
    try {
      catalog = await store.catalog(force);
      catalogError = '';
    } catch (e) {
      catalogError = (e as Error).message;
    }
    loading = false;
    render();
  };

  const remove = (inst: InstalledPack, name: string) => {
    const job = store.jobs.get(inst.id);
    const msg = `Delete the offline maps for ${name}${job ? ' and the update being downloaded' : ''}? This frees ${formatBytes(inst.bytes)}. Without internet there will be no map, directions or search there until you download them again.`;
    if (!window.confirm(msg)) return;
    void store.remove(inst.id).then(() => {
      notice = `Offline maps for ${name} deleted: ${formatBytes(inst.bytes)} freed.`;
      render();
    });
  };

  /** One country's line: its name and size, where it stands, and what can be done. */
  function row(e: CatalogEntry): HTMLElement {
    const name = packName(e, o.lang);
    const inst = store.installed.find((p) => p.id === e.id);
    const job: JobState | undefined = store.jobs.get(e.id);
    const size = formatBytes(downloadSize(e.manifest));
    const state = h('span', { class: 'off-row-state' });
    const acts = h('span', { class: 'off-row-acts' });
    const li = h('li', { class: 'off-row', 'data-pack': e.id }, h('span', { class: 'off-row-name' }, name), state, acts);
    const bar = (j: JobState) => {
      const b = h('progress', { class: 'off-bar', max: '1', value: String(j.total ? j.done / j.total : 0) }) as HTMLProgressElement;
      li.append(b);
    };
    if (job) {
      li.dataset.state = job.status;
      const of = job.total ? `${formatBytes(job.done)} of ${formatBytes(job.total)}` : size;
      if (job.status === 'downloading') {
        state.textContent = `${inst ? 'Updating' : 'Downloading'}: ${of}`;
        acts.append(btn('Pause', () => store.pause(e.id)));
        bar(job);
      } else if (job.status === 'queued') {
        state.textContent = `Waiting to download (${size})`;
        acts.append(btn('Cancel', () => void store.cancel(e.id)));
      } else if (job.status === 'paused') {
        state.textContent = `Paused at ${of}`;
        acts.append(btn('Resume', () => void store.download(e.id), 'btn btn-primary'), btn('Cancel', () => void store.cancel(e.id)));
        bar(job);
      } else {
        state.textContent = job.message;
        state.classList.add('is-error');
        acts.append(btn(job.total && job.done ? 'Resume' : 'Try again', () => void store.download(e.id), 'btn btn-primary'), btn('Cancel', () => void store.cancel(e.id)));
        if (job.total && job.done) bar(job);
      }
      return li;
    }
    if (inst) {
      li.dataset.state = 'installed';
      const newer = e.manifest.version !== inst.manifest.version;
      state.textContent = newer
        ? `On this device (${formatBytes(inst.bytes)}). Newer maps from ${builtOn(e.manifest)}: ${size}.`
        : `On this device: ${formatBytes(inst.bytes)}, map data from ${builtOn(inst.manifest)}`;
      if (newer && store.canDownload(e)) acts.append(btn('Update', () => void store.download(e.id), 'btn btn-primary'));
      const del = btn('Delete', () => remove(inst, name));
      del.classList.add('off-delete');
      acts.append(del);
      return li;
    }
    li.dataset.state = 'available';
    state.textContent = `${size} to download, ${formatBytes(deviceSize(e.manifest))} on the device`;
    if (store.canDownload(e))
      acts.append(
        btn('Download', () => {
          notice = '';
          void store.download(e.id);
        }, 'btn btn-primary'),
      );
    else acts.append(h('span', { class: 'off-app-only' }, 'In the Android app'));
    return li;
  }

  function render() {
    checkKept();
    use.disabled = !store.ready;
    if (store.state.status === 'unsupported') {
      status.textContent = NATIVE
        ? "This phone's Android System WebView is too old to keep offline maps. Update it from the Play Store, then open Settings again."
        : 'This browser cannot keep offline maps. Use a recent Chrome, Edge or Samsung Internet on Android, or Chrome or Edge on a computer.';
      listEl.replaceChildren();
      filter.hidden = true;
      return;
    }
    const total = store.installed.reduce((a, p) => a + p.bytes, 0);
    const names = store.installed.map((p) => {
      const e = catalog?.packs.find((x) => x.id === p.id);
      return e ? packName(e, o.lang) : p.manifest.name;
    });
    status.textContent = [notice, names.length ? `On this device: ${names.join(', ')} (${formatBytes(total)}).` : 'No offline maps on this device yet.'].filter(Boolean).join(' ');
    if (!catalog) {
      listEl.replaceChildren(
        h('p', { class: 'muted off-loading' }, loading ? 'Getting the list of countries…' : catalogError || 'Getting the list of countries…'),
        ...(catalogError && !loading ? [btn('Try again', () => void load(true), 'btn btn-primary')] : []),
      );
      if (!loading && !catalogError) void load();
      return;
    }
    const q = filter.value.trim().toLowerCase();
    const groups = new Map<PackGroup, CatalogEntry[]>();
    for (const e of catalog.packs) {
      const names = [e.name.en, e.name.ms, e.name.ja, e.id, ...(e.countries ?? [])].filter(Boolean).join(' ').toLowerCase();
      if (q && !names.includes(q)) continue;
      const list = groups.get(e.group) ?? [];
      list.push(e);
      groups.set(e.group, list);
    }
    const here = o.at;
    const sections: HTMLElement[] = [];
    for (const g of GROUP_ORDER) {
      const list = groups.get(g);
      if (!list?.length) continue;
      list.sort((a, b) => packName(a, o.lang).localeCompare(packName(b, o.lang)));
      const busy = list.some((e) => store.jobs.has(e.id) || store.installed.some((p) => p.id === e.id));
      const near = !!here && list.some((e) => here[0] >= e.bbox[0] && here[0] <= e.bbox[2] && here[1] >= e.bbox[1] && here[1] <= e.bbox[3]);
      const isOpen = open.get(g) ?? (!!q || busy || near);
      const det = h('details', { class: 'off-group', 'data-group': g }, h('summary', {}, h('span', {}, GROUP_NAMES[g]), h('span', { class: 'off-count' }, String(list.length))), h('ul', { class: 'off-rows' }, ...list.map(row)));
      det.open = isOpen;
      det.addEventListener('toggle', () => open.set(g, det.open));
      sections.push(det);
    }
    listEl.replaceChildren(...(sections.length ? sections : [h('p', { class: 'muted' }, 'No country or region by that name.')]));
  }

  filter.addEventListener('input', render);
  render();
  const off = store.onChange(() => render());
  // While the maps are still being prepared on the server, look again every 30 seconds.
  const poll = window.setInterval(() => {
    if (!catalog && !loading && catalogError) void load(true);
  }, 30_000);
  return {
    el,
    dispose: () => {
      off();
      clearInterval(poll);
    },
  };
}
