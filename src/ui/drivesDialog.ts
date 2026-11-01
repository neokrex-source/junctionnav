/** Picker for the ready-made KL test drives. */
import type { TestDrive } from '../sim/drives';
import { h } from './dom';

const SHOWS: Record<TestDrive['shows'][number], string> = {
  flyover: 'Ramp up to a flyover',
  descend: 'Down to street level',
  underpass: 'Underpass',
  tunnel: 'Tunnel',
  ascend: 'Up to street level',
};

export function openDrives(drives: TestDrive[], opts: { offlineReady: boolean; online: boolean }): Promise<TestDrive | null> {
  return new Promise((resolve) => {
    let picked: TestDrive | null = null;
    const list = h('div', { class: 'drives' });
    for (const d of drives) {
      const b = h(
        'button',
        { type: 'button', class: 'drive' },
        h('strong', {}, d.title),
        h('span', {}, d.summary),
        h('span', { class: 'drive-tags' }, ...d.shows.map((s) => h('em', {}, SHOWS[s]))),
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
      h('p', { class: 'hint' }, 'Simulated drives through Kuala Lumpur interchanges, to see the junction views, ramp heights and lane advice.'),
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
