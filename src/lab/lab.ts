/** Junction View Lab: preview the junction renderer on the offline demo network. */
import '../styles/app.css';
import '../styles/lab.css';
import { buildDemo } from '../demo/network';
import { buildDemoSurroundings } from '../demo/surroundings';
import { detectJunctions, type JunctionCandidate } from '../junction/detect';
import { buildScene, type JunctionScene } from '../junction/scene';
import { guessTheme, SIGN_THEMES, type SignThemeId } from '../junction/signs';
import { describeStep, type LangCode } from '../routing/instructions';
import { normalizeOsrm } from '../routing/osrm';
import { Banner } from '../ui/banner';
import { h } from '../ui/dom';
import { maneuverIcon } from '../ui/icons';
import { JunctionPanel } from '../ui/junctionPanel';

const KIND_LABEL: Record<string, string> = {
  exit: 'Exit',
  entry: 'Entrance ramp',
  fork: 'Fork',
  merge: 'Merge',
  split: 'Divider split',
};

const demo = buildDemo();
const route = normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];
const junctions = detectJunctions(route);

const state = {
  idx: 0,
  theme: 'auto' as 'auto' | SignThemeId,
  night: false,
  source: 'osm' as 'osm' | 'router',
  surround: true,
  lang: 'en' as LangCode,
  dist: 900,
  playing: false,
};

document.body.classList.add('lab-body');
const root = document.getElementById('lab')!;
const banner = new Banner();
const device = h('div', { class: 'device' }, banner.el, banner.then);
const panel = new JunctionPanel(device);

const jlist = h('div', { class: 'jlist', role: 'group', 'aria-label': 'Junction' });
const range = h('input', { id: 'dist', type: 'range', min: '0', max: '1000', step: '5', value: String(state.dist), 'aria-label': 'Distance to junction' }) as HTMLInputElement;
const out = h('output', { for: 'dist' });
const play = h('button', { class: 'play', type: 'button' }, 'Play') as HTMLButtonElement;
const facts = h('dl', { class: 'facts' });

function seg<T extends string>(label: string, id: string, options: [T, string][], get: () => T, set: (v: T) => void) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label, id });
  const paint = () => wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === get())));
  for (const [v, text] of options) {
    const b = h('button', { type: 'button', 'data-v': v }, text);
    b.addEventListener('click', () => {
      set(v);
      paint();
      refresh();
    });
    wrap.append(b);
  }
  paint();
  return h('div', { class: 'ctl' }, h('span', { class: 'lbl' }, label), wrap);
}

const themeSel = h('select', { id: 'theme', 'aria-label': 'Sign style' }) as HTMLSelectElement;
themeSel.append(h('option', { value: 'auto' }, 'Auto (by location)'));
for (const t of Object.values(SIGN_THEMES)) themeSel.append(h('option', { value: t.id }, t.label));
themeSel.addEventListener('change', () => {
  state.theme = themeSel.value as typeof state.theme;
  refresh();
});
const langSel = h('select', { id: 'lang', 'aria-label': 'Language' }) as HTMLSelectElement;
for (const [v, t] of [['en', 'English'], ['ms', 'Bahasa Melayu'], ['ja', '日本語']]) langSel.append(h('option', { value: v }, t));
langSel.addEventListener('change', () => {
  state.lang = langSel.value as LangCode;
  refresh();
});

const controls = h(
  'aside',
  { class: 'panel card' },
  h('div', { class: 'ctl' }, h('span', { class: 'lbl' }, 'Junction on the demo route'), jlist),
  h('div', { class: 'ctl' }, h('span', { class: 'lbl' }, 'Drive up to it'), h('div', { class: 'drive' }, play, range, out)),
  h('div', { class: 'row2' }, h('div', { class: 'ctl' }, h('span', { class: 'lbl' }, 'Sign style'), themeSel), h('div', { class: 'ctl' }, h('span', { class: 'lbl' }, 'Language'), langSel)),
  seg('Time of day', 'tod', [['day', 'Day'], ['night', 'Night']], () => (state.night ? 'night' : 'day'), (v) => (state.night = v === 'night')),
  seg('Road data', 'src', [['osm', 'OSM geometry'], ['router', 'Router only']], () => state.source, (v) => (state.source = v)),
  seg('Surroundings', 'surr', [['on', 'Buildings and land'], ['off', 'Roads only']], () => (state.surround ? 'on' : 'off'), (v) => (state.surround = v === 'on')),
  h('div', { class: 'ctl' }, h('span', { class: 'lbl' }, 'What the data says'), facts),
);

root.append(
  h(
    'main',
    { class: 'lab' },
    h(
      'header',
      { class: 'lab-head' },
      h('h1', {}, 'Junction View Lab'),
      h(
        'p',
        {},
        'Each junction on the demo drive rendered the way JunctionNav shows it in the car: the lane split in perspective, the signboard for every branch, and the arrow for your branch. Drag the distance or press Play to drive up to it.',
      ),
    ),
    h('div', { class: 'lab-main' }, device, controls),
    h(
      'p',
      { class: 'note' },
      'The demo roads are synthetic (left-hand traffic, Malaysian-style names) so this page runs offline. In the app the same renderer uses OpenStreetMap geometry, lane counts, bridge and tunnel layers, and destination tags fetched around each junction on your route. "Router only" shows the fallback drawn from the router’s intersection data when that detail is missing.',
    ),
  ),
);

junctions.forEach((j, i) => {
  const st = route.steps[j.stepIndex];
  const t = describeStep(st, 'en');
  const b = h(
    'button',
    { type: 'button', class: 'jbtn', 'data-i': String(i) },
    h('span', { class: 'ji', html: maneuverIcon(st.type, st.modifier, st.drivingSide) }),
    h('span', { class: 'jt' }, `${KIND_LABEL[j.kind] ?? j.kind}${verticalHint(j)}`),
    h('span', { class: 'js' }, t.primary),
  );
  b.addEventListener('click', () => {
    state.idx = i;
    state.dist = 900;
    range.value = String(state.dist);
    refresh();
  });
  jlist.append(b);
});

function verticalHint(j: JunctionCandidate): string {
  const sc = buildScene(route, j, demo.osm);
  return sc.vertical === 'up' ? ' · ramp up' : sc.vertical === 'down' ? ' · goes under' : sc.vertical === 'level' ? ' · stay below' : '';
}

const sceneCache = new Map<string, JunctionScene>();
function labSurround() {
  const base = buildDemoSurroundings();
  const extra = demo.pois.filter((p) => ['fuel', 'ev', 'rest'].includes(p.cat)).map((p) => ({ id: p.id, tags: p.tags, lat: p.lngLat[1], lon: p.lngLat[0] }));
  return { ...base, pois: [...base.pois, ...extra] };
}
function sceneFor(j: JunctionCandidate): JunctionScene {
  const k = `${j.id}|${state.source}|${state.surround}`;
  let sc = sceneCache.get(k);
  if (!sc) {
    sc = buildScene(route, j, state.source === 'osm' ? demo.osm : null, { lang: state.lang, surround: state.surround ? labSurround() : null });
    sceneCache.set(k, sc);
  }
  return sc;
}

function refresh() {
  const j = junctions[state.idx];
  jlist.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.i) === state.idx)));
  const scene = sceneFor(j);
  const themeId = state.theme === 'auto' ? guessTheme(scene.origin) : state.theme;
  const theme = SIGN_THEMES[themeId];
  panel.show(scene, theme, { night: state.night, lang: state.lang, units: 'metric', mode: 'illustration', total: 1000 });
  panel.setDistance(state.dist);
  const step = route.steps[j.stepIndex];
  banner.update(step, route.steps[j.stepIndex + 1], state.dist, state.lang, 'metric');
  out.textContent = `${Math.round(state.dist)} m`;
  const t = describeStep(step, state.lang);
  facts.innerHTML = '';
  const row = (k: string, v: string) => facts.append(h('dt', {}, k), h('dd', {}, v));
  row('Instruction', t.action);
  row('Source', scene.source === 'osm' ? 'OSM road geometry' : 'Router intersection data');
  row('Lanes', scene.lanes ? scene.lanes.map((l) => (l.valid ? '●' : '○')).join(' ') + `  (${scene.lanes.filter((l) => l.valid).length} of ${scene.lanes.length} for you)` : `${scene.approachLanes}`);
  for (const s of [...scene.signs].sort((a, b) => a.order - b.order)) {
    row(s.taken ? 'Your sign' : 'Other sign', [s.exitRef ? `Exit ${s.exitRef}` : '', s.refs.join(' '), s.places.join(', ')].filter(Boolean).join(' · ') || 'No sign text in the data');
  }
  if (scene.junctionName) row('Interchange', scene.junctionName);
}

range.addEventListener('input', () => {
  state.dist = Number(range.value);
  stop();
  refresh();
});

let raf = 0;
let last = 0;
function tick(t: number) {
  const dt = last ? (t - last) / 1000 : 0;
  last = t;
  state.dist -= dt * 60; // sped up: 1 km in ~17 s
  if (state.dist <= 0) {
    state.dist = 0;
    stop();
  }
  range.value = String(state.dist);
  panel.setDistance(state.dist);
  out.textContent = `${Math.round(state.dist)} m`;
  const j = junctions[state.idx];
  banner.update(route.steps[j.stepIndex], route.steps[j.stepIndex + 1], state.dist, state.lang, 'metric');
  if (state.playing) raf = requestAnimationFrame(tick);
}
function stop() {
  state.playing = false;
  cancelAnimationFrame(raf);
  play.textContent = 'Play';
}
play.addEventListener('click', () => {
  if (state.playing) return stop();
  if (state.dist <= 5) state.dist = 1000;
  state.playing = true;
  last = 0;
  play.textContent = 'Pause';
  raf = requestAnimationFrame(tick);
});

refresh();
// Expose for automated checks.
(window as unknown as { __lab: unknown }).__lab = { state, refresh, panel, junctions };
