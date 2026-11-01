/**
 * Sign-in and registration. The header is an overhead direction sign whose two destinations,
 * "Sign in" and "Create account", are the tabs: picking one is taking that branch.
 */
import { AuthError, MIN_PASSWORD, passwordStrength, type AuthProvider, type User } from '../auth/types';
import { h } from './dom';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset';

const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 20 11h-5v10.5H9V11H4z" fill="currentColor"/></svg>';
// Same mark as public/icon.svg, inline so it also works where files cannot load.
const LOGO =
  '<svg viewBox="0 0 512 512" width="34" height="34" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#1a0d2e"/><path d="M256 300L150 170" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="56" stroke-linecap="round"/><path d="M256 448V300" fill="none" stroke="#fff" stroke-width="56" stroke-linecap="round"/><path d="M256 300l106-130" fill="none" stroke="#c084fc" stroke-width="56" stroke-linecap="round"/><path d="M300 120l122-26-14 124z" fill="#c084fc"/></svg>';
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

export interface AuthScreenOptions {
  /** Offer "Continue without an account". */
  allowGuest: boolean;
}

function field(id: string, label: string, input: HTMLInputElement, extra?: HTMLElement | null, aside?: HTMLElement | null) {
  input.id = id;
  const hint = h('div', { class: 'auth-hint', id: `${id}-hint` });
  input.setAttribute('aria-describedby', hint.id);
  return {
    el: h('div', { class: 'auth-field' }, h('div', { class: 'auth-label-row' }, h('label', { for: id }, label), aside ?? null), extra ? h('div', { class: 'auth-input-wrap' }, input, extra) : input, hint),
    input,
    hint,
  };
}

function passwordToggle(input: HTMLInputElement): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'auth-eye', 'aria-label': 'Show password', 'aria-pressed': 'false', html: EYE }) as HTMLButtonElement;
  b.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(show));
    b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    input.focus();
  });
  return b;
}

export class AuthScreen {
  readonly el: HTMLElement;
  private mode: Mode = 'signin';
  private tabs: Record<'signin' | 'signup', HTMLButtonElement>;
  private body = h('div', { class: 'auth-body' });
  private resolve: ((u: User | null) => void) | null = null;
  private email = '';

  constructor(
    private auth: AuthProvider,
    private opts: AuthScreenOptions,
  ) {
    const way = (m: 'signin' | 'signup', label: string, side: 'left' | 'right') =>
      h(
        'button',
        { type: 'button', class: `auth-way is-${side}`, role: 'tab', id: `auth-tab-${m}`, 'aria-controls': 'auth-panel', 'aria-selected': 'false' },
        h('span', { class: 'auth-arrow', html: ARROW }),
        h('span', { class: 'auth-way-label' }, label),
      ) as HTMLButtonElement;
    this.tabs = { signin: way('signin', 'Sign in', 'left'), signup: way('signup', 'Create account', 'right') };
    this.tabs.signin.addEventListener('click', () => this.show('signin'));
    this.tabs.signup.addEventListener('click', () => this.show('signup'));
    const tablist = h('div', { class: 'auth-ways', role: 'tablist', 'aria-label': 'Account' }, this.tabs.signin, this.tabs.signup);
    tablist.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const next = e.key === 'ArrowLeft' ? 'signin' : 'signup';
      this.show(next);
      this.tabs[next].focus();
    });
    const sign = h(
      'header',
      { class: 'auth-sign' },
      h('div', { class: 'auth-panel-frame' }, h('div', { class: 'auth-brand' }, h('span', { class: 'auth-logo', html: LOGO }), h('span', {}, 'JunctionNav')), tablist),
    );
    this.body.id = 'auth-panel';
    this.body.setAttribute('role', 'tabpanel');
    this.el = h('div', { class: 'auth', hidden: true }, sign, h('main', { class: 'auth-main' }, this.body));
    document.body.append(this.el);
  }

  /** Shows the screen and resolves once someone is signed in (or chooses to continue as a guest). */
  open(): Promise<User | null> {
    this.el.hidden = false;
    this.show(this.auth.pendingRecovery() ? 'reset' : 'signin');
    return new Promise((r) => (this.resolve = r));
  }

  close() {
    this.el.hidden = true;
  }

  private done(u: User | null) {
    this.close();
    const r = this.resolve;
    this.resolve = null;
    r?.(u);
  }

  private show(mode: Mode) {
    this.mode = mode;
    for (const [m, b] of Object.entries(this.tabs)) {
      const on = m === mode || (m === 'signin' && (mode === 'forgot' || mode === 'reset'));
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    this.body.setAttribute('aria-labelledby', `auth-tab-${mode === 'signup' ? 'signup' : 'signin'}`);
    this.body.replaceChildren(this.form());
    requestAnimationFrame(() => (this.body.querySelector('input:not([type=checkbox])') as HTMLInputElement | null)?.focus({ preventScroll: true }));
  }

  private form(): HTMLElement {
    const error = h('p', { class: 'auth-error', role: 'alert', hidden: true });
    const note = h('p', { class: 'auth-note', role: 'status', hidden: true });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary auth-submit' }) as HTMLButtonElement;
    const remember = h('input', { type: 'checkbox', id: 'auth-remember', checked: true }) as HTMLInputElement;
    const rememberRow = h('label', { class: 'auth-check', for: 'auth-remember' }, remember, 'Keep me signed in on this device');
    const form = h('form', { class: 'auth-form', novalidate: true }) as HTMLFormElement;
    const fields: Partial<Record<'name' | 'email' | 'password' | 'confirm', { input: HTMLInputElement; hint: HTMLElement }>> = {};

    const showError = (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      error.textContent = msg;
      error.hidden = false;
      for (const f of Object.values(fields)) f?.input.removeAttribute('aria-invalid');
      const key = e instanceof AuthError ? e.field : undefined;
      const f = key ? fields[key] : undefined;
      if (f) {
        f.input.setAttribute('aria-invalid', 'true');
        f.input.focus();
      }
    };
    const run = async (label: string, busy: string, fn: () => Promise<void>) => {
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = busy;
      try {
        await fn();
      } catch (e) {
        showError(e);
      } finally {
        submit.disabled = false;
        submit.textContent = label;
      }
    };

    const emailInput = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', spellcheck: 'false', value: this.email, required: true }) as HTMLInputElement;
    emailInput.addEventListener('input', () => (this.email = emailInput.value));
    const email = field('auth-email', 'Email', emailInput);
    fields.email = email;

    if (this.mode === 'signin') {
      const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true }) as HTMLInputElement;
      const forgot = h('button', { type: 'button', class: 'auth-link' }, 'Forgot password?');
      forgot.addEventListener('click', () => this.show('forgot'));
      const password = field('auth-password', 'Password', pw, passwordToggle(pw), forgot);
      fields.password = password;
      submit.textContent = 'Sign in';
      form.append(email.el, password.el, rememberRow, error, note, submit);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        void run('Sign in', 'Signing in…', async () => this.done(await this.auth.signIn(emailInput.value, pw.value, remember.checked)));
      });
    } else if (this.mode === 'signup') {
      const nameInput = h('input', { type: 'text', autocomplete: 'name', autocapitalize: 'words', maxlength: '60', required: true }) as HTMLInputElement;
      const name = field('auth-name', 'Name', nameInput);
      fields.name = name;
      const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: String(MIN_PASSWORD), required: true }) as HTMLInputElement;
      const password = field('auth-password', 'Password', pw, passwordToggle(pw));
      fields.password = password;
      // Strength as three lane markings.
      const meter = h('div', { class: 'auth-meter', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'));
      password.hint.before(meter);
      const paintMeter = () => {
        const s = passwordStrength(pw.value);
        meter.dataset.level = String(s);
        password.hint.textContent = !pw.value
          ? `At least ${MIN_PASSWORD} characters.`
          : s === 0
            ? `${MIN_PASSWORD - pw.value.length} more character${MIN_PASSWORD - pw.value.length === 1 ? '' : 's'} needed.`
            : ['', 'Weak: add numbers, capitals or symbols, or make it longer.', 'Good.', 'Strong.'][s];
      };
      pw.addEventListener('input', paintMeter);
      paintMeter();
      submit.textContent = 'Create account';
      form.append(name.el, email.el, password.el, rememberRow, error, note, submit);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        void run('Create account', 'Creating account…', async () => {
          const r = await this.auth.signUp(nameInput.value, emailInput.value, pw.value, remember.checked);
          if (r.user) return this.done(r.user);
          this.show('signin');
          const n = this.body.querySelector('.auth-note') as HTMLElement | null;
          if (n) {
            n.textContent = r.message ?? 'Check your email to finish creating the account.';
            n.hidden = false;
          }
        });
      });
    } else if (this.mode === 'forgot') {
      const back = h('button', { type: 'button', class: 'auth-link' }, 'Back to sign in');
      back.addEventListener('click', () => this.show('signin'));
      const title = h('h2', { class: 'auth-title' }, 'Reset your password');
      if (this.auth.kind === 'local') {
        // Accounts in this browser have no email recovery: explain, and offer to remove the account.
        const msg = h('p', { class: 'auth-text' });
        void this.auth.requestPasswordReset(emailInput.value).then((t) => (msg.textContent = t));
        submit.textContent = 'Remove account';
        submit.classList.replace('btn-primary', 'btn-danger');
        form.append(title, msg, email.el, error, submit, back);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!emailInput.value.trim()) return showError(new AuthError('Enter the email of the account to remove.', 'email'));
          if (!window.confirm(`Remove the account for ${emailInput.value.trim()} from this browser?`)) return;
          void run('Remove account', 'Removing…', async () => {
            await this.auth.deleteAccount!(emailInput.value, '');
            this.show('signup');
          });
        });
      } else {
        submit.textContent = 'Send reset link';
        form.append(title, h('p', { class: 'auth-text' }, 'Enter the email you registered with and we will send a link to choose a new password.'), email.el, error, note, submit, back);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          void run('Send reset link', 'Sending…', async () => {
            note.textContent = await this.auth.requestPasswordReset(emailInput.value);
            note.hidden = false;
          });
        });
      }
    } else {
      const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: String(MIN_PASSWORD), required: true }) as HTMLInputElement;
      const password = field('auth-password', 'New password', pw, passwordToggle(pw));
      password.hint.textContent = `At least ${MIN_PASSWORD} characters.`;
      fields.password = password;
      submit.textContent = 'Save new password';
      form.append(h('h2', { class: 'auth-title' }, 'Choose a new password'), password.el, error, submit);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        void run('Save new password', 'Saving…', async () => this.done(await this.auth.completePasswordReset(pw.value)));
      });
    }

    const foot = h('div', { class: 'auth-foot' });
    if (this.auth.kind === 'local') foot.append(h('p', {}, 'Your account is saved in this browser only. It is not shared with other devices or browsers.'));
    if (this.opts.allowGuest) {
      const guest = h('button', { type: 'button', class: 'auth-link' }, 'Continue without an account');
      guest.addEventListener('click', () => this.done(null));
      foot.append(guest);
    }
    if (foot.childElementCount) form.append(foot);
    return form;
  }
}
