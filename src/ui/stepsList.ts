/** Step-by-step directions list. Steps with a junction view get a preview button. */
import type { JunctionCandidate } from '../junction/detect';
import { describeStep, formatDistance, t, type LangCode, type Units } from '../routing/instructions';
import type { Route, Step } from '../routing/types';
import { h } from './dom';
import { maneuverIcon } from './icons';

export interface StepsListOptions {
  lang: LangCode;
  units: Units;
  /** First step to list (use the upcoming maneuver while driving). */
  from?: number;
  /** Current along-route position, to show distances from here. */
  progressS?: number;
  junctions: Map<number, JunctionCandidate>;
  onStep?: (step: Step) => void;
  onPreview?: (cand: JunctionCandidate) => void;
}

const JV_ICON =
  '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21v-7L6 5M12 14l6-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 21h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

export function stepsList(route: Route, o: StepsListOptions): HTMLElement {
  const list = h('ol', { class: 'steps' });
  const from = o.from ?? 0;
  route.steps.forEach((step, i) => {
    if (i < from) return;
    const d = describeStep(step, o.lang);
    const prev = route.steps[i - 1];
    const dist = o.progressS != null ? step.s - o.progressS : prev ? step.s - prev.s : 0;
    const cand = o.junctions.get(i);
    const sub = d.primary !== d.action ? d.primary : '';
    const row = h(
      'li',
      { class: `step${step.waypoint ? ' is-stop' : ''}` },
      h('span', { class: 'st-ico', html: maneuverIcon(step.type, step.modifier, step.drivingSide) }),
      h(
        'button',
        { type: 'button', class: 'st-main' },
        h('span', { class: 'st-act' }, d.exitRef ? h('span', { class: 'st-exit' }, `EXIT ${d.exitRef}`) : '', d.action),
        sub ? h('span', { class: 'st-sub' }, sub) : '',
      ),
      h('span', { class: 'st-dist' }, dist > 0 ? formatDistance(dist, o.units) : ''),
    );
    row.querySelector('.st-main')!.addEventListener('click', () => o.onStep?.(step));
    if (cand) {
      const b = h('button', { type: 'button', class: 'st-jv', html: `${JV_ICON}<span>${t(o.lang, 'junction')}</span>` });
      b.addEventListener('click', () => o.onPreview?.(cand));
      row.append(b);
    }
    list.append(row);
  });
  return list;
}
