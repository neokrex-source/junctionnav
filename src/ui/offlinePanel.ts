/** The "Offline maps" section of Settings: download with progress, pause, resume, update, delete. */
import type { PackManifest } from '../offline/graphLayout';
import type { OfflineStore, PackState } from '../offline/store';
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
  const el = h(
    'div',
    { class: 'grp off' },
    h('label', { for: 'offlineUse' }, 'Offline maps'),
    status,
    bar,
    actions,
    use,
    h('div', { class: 'hint' }, 'With no signal, the map, directions, place search, lane advice and tunnel signs keep working. Buildings around junctions still need internet.'),
  );
  let remote: PackManifest | null | undefined;
  let remoteError = '';
  let checking = false;

  const btn = (label: string, fn: () => void, cls = 'btn btn-ghost') => {
    const b = h('button', { type: 'button', class: cls }, label);
    b.addEventListener('click', fn);
    return b;
  };
  const download = () => void store.download();

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
    if (s.status === 'unsupported') {
      status.textContent = 'This browser cannot keep offline maps. Use a recent Chrome, Edge or Samsung Internet on Android, or Chrome or Edge on a computer.';
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
      const del = btn('Delete', () => {
        if (window.confirm(`Delete the offline maps for ${m.name}? This frees ${formatBytes(inst.bytes)}.`)) void store.remove();
      });
      del.classList.add('off-delete');
      actions.append(del);
      return;
    }
    if (remote === undefined || checking) {
      status.textContent = 'Checking which offline maps are available…';
      void lookUp();
      return;
    }
    if (!remote) {
      status.textContent = remoteError || 'Offline maps are not available right now.';
      actions.append(btn('Try again', () => void lookUp(true)));
      return;
    }
    status.textContent = `${remote.name}: about ${formatBytes(downloadSize(remote))} to download, ${formatBytes(deviceSize(remote))} on this device. Use Wi‑Fi if you can.`;
    actions.append(btn('Download', download, 'btn btn-primary'));
  }

  render(store.state);
  const off = store.onChange(render);
  return { el, dispose: off };
}
