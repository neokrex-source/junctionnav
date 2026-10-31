/** Maneuver banner: icon, distance, where to go, what to do, lanes, and the maneuver after. */
import type { LaneState } from '../nav/lanes';
import { describeStep, formatDistance, lanePhrase, LANGS, type LangCode, type Units } from '../routing/instructions';
import type { Lane, Step } from '../routing/types';
import { h } from './dom';
import { laneIcon, maneuverIcon } from './icons';

export class Banner {
  readonly el: HTMLElement;
  readonly then: HTMLElement;
  private icon = h('div', { class: 'b-icon' });
  private dist = h('div', { class: 'b-dist' });
  private primary = h('div', { class: 'b-primary' });
  private action = h('div', { class: 'b-action' });
  private lanes = h('div', { class: 'b-lanes', hidden: true });
  private cue = h('div', { class: 'b-lanecue', hidden: true, role: 'alert' });
  private key = '';
  private laneKey = '';

  constructor() {
    this.el = h(
      'header',
      { class: 'banner', role: 'status', 'aria-live': 'polite' },
      this.icon,
      h('div', { style: 'min-width:0;display:grid;gap:3px' }, this.primary, this.action),
      this.lanes,
      this.cue,
    );
    this.then = h('div', { class: 'b-then', hidden: true });
  }

  update(step: Step, after: Step | undefined, dist: number, lang: LangCode, units: Units, showLanes = true, lane: LaneState | null = null) {
    const t = describeStep(step, lang);
    const key = `${step.index}|${lang}`;
    if (key !== this.key) {
      this.key = key;
      this.icon.innerHTML = maneuverIcon(step.type, step.modifier, step.drivingSide);
      this.icon.append(this.dist);
      this.primary.textContent = t.primary;
      this.action.innerHTML = '';
      if (t.exitRef) this.action.append(h('span', { class: 'b-exit' }, `EXIT ${t.exitRef}`));
      this.action.append(h('span', {}, t.action));
      this.laneKey = '';
    }
    // Lanes for the maneuver the lane advice is about (may be past an unimportant step), with a
    // marker under the lane we think the car is in.
    const laneStep = lane?.target.known ? lane.target.step : step;
    const lanes = laneStep.intersections[0]?.lanes;
    const lk = `${laneStep.index}|${lane?.current ?? '-'}|${lane?.status ?? '-'}|${lang}`;
    if (lk !== this.laneKey) {
      this.laneKey = lk;
      this.lanes.innerHTML = lanes && lanes.length > 1 && lanes.some((l) => !l.valid) ? laneRow(lanes, laneStep.drivingSide, lane?.current ?? null) : '';
    }
    this.lanes.hidden = !showLanes || !this.lanes.innerHTML || (dist > 2500 && !lane);
    this.el.classList.toggle('lane-wrong', lane?.status === 'wrong');
    if (lane) {
      this.cue.hidden = false;
      this.cue.className = `b-lanecue is-${lane.status}`;
      this.cue.innerHTML = `${cueIcon(lane)}<span>${escapeText(lanePhrase('cue', lane, lang, units))}</span>`;
    } else {
      this.cue.hidden = true;
    }
    this.dist.textContent = formatDistance(dist, units);
    // "Then" hint when the following maneuver comes quickly.
    if (after && after.s - step.s < 350 && after.type !== 'arrive') {
      this.then.hidden = false;
      this.then.innerHTML = '';
      this.then.append(h('span', {}, LANGS[lang].then), h('span', { html: maneuverIcon(after.type, after.modifier, after.drivingSide) }));
    } else {
      this.then.hidden = true;
    }
  }
}

function escapeText(t: string): string {
  return t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

function laneRow(lanes: Lane[], side: 'left' | 'right', current: number | null): string {
  return lanes
    .map((l, i) => `<span class="lane-slot${i === current ? ' is-you' : ''}">${laneIcon(l.indications, l.valid, side)}</span>`)
    .join('');
}

const ARROW = (dir: 'left' | 'right') =>
  `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${dir === 'left' ? 'M20 12H5M11 5l-7 7 7 7' : 'M4 12h15M13 5l7 7-7 7'}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHECK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CAUTION =
  '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 22 20.5H2z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 10v5M12 17.6v.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

function cueIcon(l: LaneState): string {
  if (l.status === 'ok') return CHECK;
  if (l.status === 'late') return CAUTION;
  const dir = l.move ?? (l.target.side === 'middle' ? null : l.target.side);
  return dir ? ARROW(dir) : CAUTION;
}
