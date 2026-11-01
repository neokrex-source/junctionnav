/** Picker for the ready-made KL test drives. */
import type { TestDrive } from '../sim/drives';
import type { CheckId } from '../sim/testRun';
import { h } from './dom';

/** Short tags for what a drive tests (every drive also checks the route, junction views and arrival). */
const TAGS: Partial<Record<CheckId, string>> = {
  toll: 'Toll plaza',
  lanes: 'Lane advice',
  exitNumber: 'Exit number',
  flyover: 'Ramp up to a flyover',
  descend: 'Down to street level',
  underpass: 'Underpass',
  tunnel: 'Into a tunnel',
  ascend: 'Up to street level',
  map3d: '3D map view',
  tunnelSign: 'Tunnel sign',
  dr: 'No GPS in the tunnel',
};

export function openDrives(drives: TestDrive[], opts: { offlineReady: boolean; online: boolean }): Promise<TestDrive | null> {
  return new Promise((resolve) => {
    let picked: TestDrive | null = null;
    const list = h('div', { class: 'drives' });
    for (const d of drives) {
      const b = h(
        'button',
        { type: 'button', class: 'drive' },
        h('strong', {}, d.title, h('small', {}, ` · ${d.km} km`)),
        h('span', {}, d.summary),
        h('span', { class: 'drive-tags' }, ...d.checks.filter((c) => TAGS[c]).map((c) => h('em', {}, TAGS[c]!))),
      );
      b.addEventListener('click', () => {
        picked = d;
        dlg.close('pick');
      });
      list.append(b);
    }
    const note = opts.offlineReady
      ? 'Runs on the offline maps when there is no internet. The simulator drives at ×2; change the speed or skip to the next junction with the controls.'
      : opts.online
        ? 'Uses the online router and road data. Download the offline maps in Settings to run these without internet.'
        : 'These need internet, or the offline maps from Settings.';
    const form = h(
      'form',
      { method: 'dialog' },
      h('h2', {}, 'KL test drives'),
      h('p', { class: 'hint' }, 'Short simulated drives through Kuala Lumpur interchanges. Each one has a checklist (the Checks button beside the simulator controls) that ticks off the functions as they show up, and a result at the end.'),
      list,
      h('p', { class: 'hint' }, note),
      h('menu', {}, h('button', { value: 'cancel', class: 'btn btn-ghost' }, 'Close')),
    );
    const dlg = h('dialog', { class: 'settings drives-dlg', 'aria-label': 'KL test drives' }, form) as HTMLDialogElement;
    document.body.append(dlg);
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(picked);
    });
    dlg.showModal();
  });
}
