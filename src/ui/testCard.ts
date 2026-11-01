/** The test drive checklist: a button in the simulator bar, a list on tap, and the result at the end. */
import { CHECKS, type CheckId, type TestRun } from '../sim/testRun';
import { h } from './dom';

/** A setting a check needs, with a button to turn it on (Map view for the 3D check, say). */
export interface CheckFix {
  label: string;
  run: () => void;
}

export class TestCard {
  /** Button that goes into the simulator bar. */
  readonly button: HTMLButtonElement;
  /** The list, shown above the simulator bar. */
  readonly panel: HTMLElement;
  private run: TestRun | null = null;
  private list: HTMLElement;
  private title: HTMLElement;
  private popTimer = 0;
  private closeTimer = 0;

  constructor(private fixFor: (id: CheckId) => CheckFix | null = () => null) {
    this.button = h('button', { type: 'button', class: 'test-btn', hidden: true, 'aria-expanded': 'false', 'aria-live': 'polite' }) as HTMLButtonElement;
    this.title = h('strong', {});
    this.list = h('ul', { class: 'test-list' });
    const close = h('button', { type: 'button', class: 'test-close', 'aria-label': 'Hide checklist', html: '&times;' });
    close.addEventListener('click', () => this.toggle(false));
    this.panel = h(
      'section',
      { class: 'test-panel', hidden: true, 'aria-label': 'Test drive checklist' },
      h('header', {}, h('span', {}, h('small', {}, 'Test drive'), this.title), close),
      this.list,
    );
    this.button.addEventListener('click', () => this.toggle(this.panel.hidden));
  }

  get active(): boolean {
    return !!this.run;
  }

  start(run: TestRun) {
    this.run = run;
    this.button.hidden = false;
    this.title.textContent = run.drive.title;
    this.render();
    // Open at the start so the tester sees what to look for, then get out of the way.
    this.toggle(true);
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => this.run === run && this.toggle(false), 7000);
  }

  stop() {
    this.run = null;
    this.button.hidden = true;
    window.clearTimeout(this.popTimer);
    window.clearTimeout(this.closeTimer);
    this.toggle(false);
  }

  /** A check was ticked: refresh, and show its name on the button for a moment. */
  ticked(id: CheckId) {
    const run = this.run;
    if (!run) return;
    this.render();
    this.button.textContent = `✓ ${CHECKS[id].title}`;
    this.button.classList.remove('is-flash');
    void this.button.offsetWidth;
    this.button.classList.add('is-flash');
    window.clearTimeout(this.popTimer);
    this.popTimer = window.setTimeout(() => this.run === run && this.paintButton(), 2600);
  }

  /** Settings changed (a fix was applied): redraw the list. */
  refresh() {
    this.render();
  }

  private toggle(open: boolean) {
    this.panel.hidden = !open || !this.run;
    this.button.setAttribute('aria-expanded', String(!this.panel.hidden));
    if (!this.panel.hidden) window.clearTimeout(this.closeTimer);
  }

  private paintButton() {
    const run = this.run;
    if (!run) return;
    this.button.textContent = `Checks ${run.passed}/${run.total}`;
    this.button.classList.toggle('is-done', run.passed === run.total);
  }

  private render() {
    const run = this.run;
    if (!run) return;
    this.paintButton();
    this.list.replaceChildren(...run.checks.map((id) => checkItem(run, id, run.done.has(id) ? '✓' : '○', run.done.has(id) ? null : this.fixFor(id))));
  }
}

function checkItem(run: TestRun, id: CheckId, mark: string, fix: CheckFix | null): HTMLElement {
  const ok = run.done.has(id);
  const c = CHECKS[id];
  const text = h('span', { class: 'test-text' }, h('b', {}, c.title), h('small', {}, ok ? run.done.get(id) || 'Seen' : c.how));
  if (fix) {
    const b = h('button', { type: 'button', class: 'test-fix' }, fix.label);
    b.addEventListener('click', fix.run);
    text.append(b);
  }
  return h('li', { class: ok ? 'is-ok' : '' }, h('span', { class: 'test-mark', 'aria-hidden': 'true' }, mark), text);
}

/** Result at the end of a test drive. */
export function showTestResult(run: TestRun, onAgain: () => void): void {
  const missing = run.missing;
  const list = h('ul', { class: 'test-list' }, ...run.checks.map((id) => checkItem(run, id, run.done.has(id) ? '✓' : '✗', null)));
  const views = run.views.length
    ? h('details', { class: 'test-views' }, h('summary', {}, `Junction views (${run.views.length})`), h('ul', {}, ...run.views.map((v) => h('li', {}, v))))
    : '';
  const again = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Drive again');
  const mins = Math.max(1, Math.round((Date.now() - run.started) / 60000));
  const form = h(
    'form',
    { method: 'dialog' },
    h('h2', {}, missing.length ? `${run.passed} of ${run.total} checks passed` : `All ${run.total} checks passed`),
    h(
      'p',
      { class: 'hint' },
      `${run.drive.title}, ${mins} min. ` +
        (missing.length
          ? `Not seen this time: ${missing.map((m) => CHECKS[m].title.toLowerCase()).join(', ')}. Ending the drive early or skipping ahead can miss a check.`
          : 'Everything showed up.'),
    ),
    list,
    views,
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
