/** The "Offline maps" section of Settings: download with progress, pause, resume, update, keep and delete. */
import type { PackManifest } from '../offline/graphLayout';
import type { InstalledPack, OfflineStore, PackState } from '../offline/store';
import { NATIVE } from '../platform';
import { h } from './dom';

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

const downloadSize = (m: PackManifest) => m.files.reduce((a, f) => a + f.parts.reduce((b, p) => b + p.size, 0), 0);
const deviceSize = (m: PackManifest) => m.files.reduce((a, f) => a + f.size, 0);
const builtOn = (m: PackManifest) => {
  const d = new Date(m.built);
  return Number.isNaN(d.getTime()) ? m.version : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * Builds the section. It follows the store while it is on screen; call the returned `dispose`
 * when the dialog closes (the download itself carries on).
 */
export function offlinePanel(store: OfflineStore, use: HTMLSelectElement): { el: HTMLElement; dispose: () => void } {
  const status = h('div', { class: 'off-status', role: 'status', 'aria-live': 'polite' });
  const bar = h('progress', { class: 'off-bar', max: '1', value: '0' }) as HTMLProgressElement;
  const actions = h('div', { class: 'off-actions' });
  // Whether the browser will keep the maps when space runs low, and the way to delete them.
  const keepEl = h('div', { class: 'off-keep', role: 'status', 'aria-live': 'polite', hidden: '' });
  const danger = h('div', { class: 'off-danger', hidden: '' });
  const el = h(
    'div',
    { class: 'grp off' },
    h('label', { for: 'offlineUse' }, 'Offline maps'),
    status,
    bar,
    actions,
    keepEl,
    use,
    h(
      'div',
      { class: 'hint' },
      'With no signal, the map, directions, place search, lane advice, tunnel signs and the hills in the 3D junction view keep working. Buildings around junctions still need internet.',
    ),
    danger,
  );
  let remote: PackManifest | null | undefined;
  let remoteError = '';
  let checking = false;
  /** After a delete: what was freed, shown until the next download. */
  let notice = '';
  let kept: boolean | null | undefined;
  let keptFor: string | undefined;
  let keepAsked = false;

  const btn = (label: string, fn: () => void, cls = 'btn btn-ghost') => {
    const b = h('button', { type: 'button', class: cls }, label);
    b.addEventListener('click', fn);
    return b;
  };
  const download = () => {
    notice = '';
    void store.download();
  };

  function paintKeep() {
    keepEl.replaceChildren();
    const inst = store.installed;
    keepEl.hidden = !inst || kept == null;
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
    const id = store.installed?.dir.join('/');
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

  function paintDelete(inst: InstalledPack | null) {
    danger.replaceChildren();
    danger.hidden = !inst;
    if (!inst) return;
    const del = btn('Delete offline maps', () => {
      const updating = store.state.status === 'downloading' || store.state.status === 'paused' || store.state.status === 'error';
      const msg =
        `Delete the offline maps for ${inst.manifest.name}${updating ? ' and the update being downloaded' : ''}? ` +
        `This frees ${formatBytes(inst.bytes)}. Without internet there will be no map, directions or search until you download them again.`;
      if (!window.confirm(msg)) return;
      const freed = inst.bytes;
      void store.remove().then(() => {
        notice = `Offline maps deleted: ${formatBytes(freed)} freed.`;
        render(store.state);
      });
    });
    del.classList.add('off-delete');
    danger.append(del, h('span', { class: 'off-danger-size' }, `${formatBytes(inst.bytes)} on this device`));
  }

  const lookUp = async (force = false) => {
    if (checking || (remote !== undefined && !force)) return;
    checking = true;
    render(store.state);
    try {
      remote = await store.remote();
      remoteError = '';
    } catch (e) {
      remote = null;
      remoteError = (e as Error).message;
    }
    checking = false;
    render(store.state);
  };

  function render(s: PackState) {
    const inst = store.installed;
    actions.replaceChildren();
    bar.hidden = true;
    use.disabled = !inst;
    checkKept();
    paintDelete(s.status === 'unsupported' ? null : inst);
    if (s.status === 'unsupported') {
      status.textContent = NATIVE
        ? "This phone's Android System WebView is too old to keep offline maps. Update it from the Play Store, then open Settings again."
        : 'This browser cannot keep offline maps. Use a recent Chrome, Edge or Samsung Internet on Android, or Chrome or Edge on a computer.';
      return;
    }
    if (s.status === 'downloading' || s.status === 'paused' || s.status === 'error') {
      bar.hidden = false;
      bar.value = s.total ? s.done / s.total : 0;
      const of = s.total ? `${formatBytes(s.done)} of ${formatBytes(s.total)}` : '';
      const what = s.manifest ? s.manifest.name : 'Offline maps';
      if (s.status === 'downloading') {
        status.textContent = `${inst ? 'Updating' : 'Downloading'} ${what}: ${of}. Keep this page open; Wi‑Fi is best.`;
        actions.append(btn('Pause', () => store.pause()));
      } else if (s.status === 'paused') {
        status.textContent = `${what}: paused at ${of}.`;
        actions.append(btn('Resume', download, 'btn btn-primary'), btn('Cancel', () => void store.cancel()));
      } else {
        status.textContent = s.message;
        bar.hidden = !s.total;
        actions.append(btn(s.total ? 'Resume' : 'Try again', download, 'btn btn-primary'), btn('Cancel', () => void store.cancel()));
      }
      return;
    }
    if (inst) {
      const m = inst.manifest;
      const newer = remote && (remote.version !== m.version || remote.id !== m.id) ? remote : null;
      const extra = newer
        ? ` Newer maps from ${builtOn(newer)} are ready to download (${formatBytes(downloadSize(newer))}).`
        : remote
          ? ' These are the latest.'
          : remote === null && remoteError
            ? ' Could not check for newer maps right now.'
            : '';
      status.textContent = `${m.name} is on this device (${formatBytes(inst.bytes)}, map data from ${builtOn(m)}).${extra}`;
      if (newer) actions.append(btn('Update', download, 'btn btn-primary'));
      else actions.append(btn(checking ? 'Checking…' : 'Check for update', () => void lookUp(true)));
      return;
    }
    // Not on this device yet: the Download button is always there. Without a published pack it
    // checks the server again and starts as soon as the maps are there.
    const get = btn(checking ? 'Checking…' : 'Download', () => (remote ? download() : void lookUp(true).then(() => remote && download())), 'btn btn-primary');
    actions.append(get);
    const before = notice ? `${notice} ` : '';
    if (remote === undefined || checking) {
      get.setAttribute('disabled', '');
      status.textContent = `${before}Checking which offline maps are available…`;
      void lookUp();
      return;
    }
    if (!remote) {
      status.textContent = before + (remoteError || 'Offline maps are not available right now. Tap Download to try again.');
      return;
    }
    status.textContent = `${before}${remote.name}: about ${formatBytes(downloadSize(remote))} to download, ${formatBytes(deviceSize(remote))} on this device. Use Wi‑Fi if you can.`;
  }

  render(store.state);
  const off = store.onChange(render);
  // While the maps are still being prepared on the server, look again every 30 seconds.
  const poll = window.setInterval(() => {
    if (remote === null && !store.installed && store.state.status === 'idle') void lookUp(true);
  }, 30_000);
  return {
    el,
    dispose: () => {
      off();
      clearInterval(poll);
    },
  };
}
