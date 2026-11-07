/**
 * Whether TomTom should be asked right now. With "TomTom first" in Settings and a key, it is;
 * after a failure it rests for a while (longer when the key is refused or the day's allowance is
 * used up) and the usual services answer meanwhile, without the user having to do anything.
 */
import { TomTomError } from './http';

export type TomTomState = 'ready' | 'refused' | 'busy' | 'unreachable' | 'off' | 'nokey';

export class TomTomGate {
  private restUntil = 0;
  state: TomTomState = 'ready';
  /** What went wrong last, in a few words, for the note under the routes and Settings. */
  reason = '';
  onChange: (() => void) | null = null;

  constructor(
    private key: () => string,
    /** "TomTom first" is chosen (and not the demo). */
    private wanted: () => boolean,
    private now: () => number = () => Date.now(),
  ) {}

  get usable(): boolean {
    return this.wanted() && !!this.key().trim() && this.now() >= this.restUntil;
  }

  /** The key was refused (or the day's allowance is used up) a short while ago: nothing should ask TomTom yet. */
  get keyResting(): boolean {
    return this.state === 'refused' && this.now() < this.restUntil;
  }

  /** Why TomTom is not being used, or 'ready'. */
  get status(): TomTomState {
    if (!this.wanted()) return 'off';
    if (!this.key().trim()) return 'nokey';
    return this.now() >= this.restUntil ? 'ready' : this.state;
  }

  ok() {
    if (this.state === 'ready' && !this.reason) return;
    this.state = 'ready';
    this.reason = '';
    this.restUntil = 0;
    this.onChange?.();
  }

  /** TomTom failed: rest it according to what happened. Requests TomTom could not answer as asked (400) do not count. */
  fail(e: unknown) {
    const status = e instanceof TomTomError ? e.status : 0;
    if (status === 400) return;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    let rest: number;
    if (status === 401 || status === 403) {
      this.state = 'refused';
      this.reason = 'TomTom refused the key or its allowance for today is used up';
      rest = 20 * 60_000;
    } else if (status === 429) {
      this.state = 'busy';
      this.reason = 'TomTom is busy';
      rest = 60_000;
    } else {
      this.state = 'unreachable';
      this.reason = offline ? 'no internet connection' : status ? `TomTom answered ${status}` : 'TomTom could not be reached';
      rest = 60_000;
    }
    this.restUntil = this.now() + rest;
    this.onChange?.();
  }

  /** A new key or setting: try TomTom again straight away. */
  reset() {
    this.restUntil = 0;
    this.state = 'ready';
    this.reason = '';
    this.onChange?.();
  }
}
