/** The test drive checklist: a button in the simulator bar, a list on tap, and the result at the end. */
import { CHECKS, type CheckId, type TestRun } from '../sim/testRun';
import { h } from './dom';

export class TestCard {
  /** Button that goes into the simulator bar. */
  readonly button: HTMLButtonElement;
  /** The list, shown above the simulator bar. */
  readonly panel: HTMLElement;
  private run: TestRun | null = null;
  private list: HTMLElement;
  private title: HTMLElement;

  constructor() {
    this.button = h('button', { type: 'button', class: 'test-btn', hidden: true, 'aria-expanded': 'false' }) as HTMLButtonElement;
    this.title = h('strong', {});
    this.list = h('ul', { class: 'test-list' });
    const close = h('button', { type: 'button', class: 'mini', 'aria-label': 'Hide checklist', html: '&times;' });
    close.addEventListener('click', () => this.toggle(false));
    this.panel = h('section', { class: 'test-panel card', hidden: true, 'aria-label': 'Test drive checklist' }, h('header', {}, this.title, close), this.list);
    this.button.addEventListener('click', () => this.toggle(this.panel.hidden));
  }

  start(run: TestRun) {
    this.run = run;
    this.button.hidden = false;
    this.title.textContent = run.drive.title;
    this.render();
    // Open at the start so the tester sees what to look for.
    this.toggle(true);
    window.setTimeout(() => this.run === run && this.toggle(false), 6000);
  }

  stop() {
    this.run = null;
    this.button.hidden = true;
    this.toggle(false);
  }

  /** A check was ticked: refresh and flash the button. */
  ticked(_id: CheckId) {
    this.render();
    this.button.classList.remove('is-flash');
    void this.button.offsetWidth;
    this.button.classList.add('is-flash');
  }

  private toggle(open: boolean) {
    this.panel.hidden = !open || !this.run;
    this.button.setAttribute('aria-expanded', String(!this.panel.hidden));
  }

  private render() {
    const run = this.run;
    if (!run) return;
    this.button.textContent = `Checks ${run.passed}/${run.total}`;
    this.button.classList.toggle('is-done', run.passed === run.total);
    this.list.replaceChildren(
      ...run.checks.map((id) => {
        const ok = run.done.has(id);
        const c = CHECKS[id];
        return h(
          'li',
          { class: ok ? 'is-ok' : '' },
          h('span', { class: 'test-mark', 'aria-hidden': 'true' }, ok ? '✓' : '○'),
          h('span', { class: 'test-text' }, h('b', {}, c.title), h('small', {}, ok && run.done.get(id) ? run.done.get(id)! : c.how)),
        );
      }),
    );
  }
}

/** Result at the end of a test drive. */
export function showTestResult(run: TestRun, onAgain: () => void): void {
  const missing = run.missing;
  const list = h(
    'ul',
    { class: 'test-list' },
    ...run.checks.map((id) => {
      const ok = run.done.has(id);
      return h(
        'li',
        { class: ok ? 'is-ok' : '' },
        h('span', { class: 'test-mark', 'aria-hidden': 'true' }, ok ? '✓' : '✗'),
        h('span', { class: 'test-text' }, h('b', {}, CHECKS[id].title), h('small', {}, ok ? run.done.get(id) || 'Seen' : CHECKS[id].how)),
      );
    }),
  );
  const again = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Drive again');
  const form = h(
    'form',
    { method: 'dialog' },
    h('h2', {}, `${run.passed} of ${run.total} checks passed`),
    h('p', { class: 'hint' }, missing.length ? `${run.drive.title}. Not seen this time: ${missing.map((m) => CHECKS[m].title.toLowerCase()).join(', ')}.` : `${run.drive.title}: everything showed up.`),
    list,
    h('menu', {}, again, h('button', { value: 'ok', class: 'btn btn-primary', style: 'flex:0' }, 'Done')),
  );
  const dlg = h('dialog', { class: 'settings test-result', 'aria-label': 'Test drive result' }, form) as HTMLDialogElement;
  again.addEventListener('click', () => {
    dlg.close();
    onAgain();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
