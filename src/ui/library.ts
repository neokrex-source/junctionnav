/**
 * The Places tab: what you saved (Home, Work, your groups, pins, your registered places and
 * recent destinations) and Discover (attractions, foods, resorts, theme parks and shopping malls
 * around the map, with photos and where each comes from). Also the parts of a place page that
 * come from Discover: the photo, the words about it, its source links, "look it up" and Save to.
 */
import { haversine, type LngLat } from '../geo/geo';
import { formatDistance, type LangCode, type Units } from '../routing/instructions';
import type { Place } from '../search/places';
import { FAV, samePlace, type PlaceStore, type SavedGroup } from '../state/places';
import { lookUpLinks } from '../discover/links';
import { DISCOVER_CATS, discoverWords, SOURCE_NAMES, type DiscoverCat, type DiscoverPlace, type DiscoverResult, type SourceKind, type SourceLink } from '../discover/types';
import { h } from './dom';

const svg = (body: string) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const CAT_ICON: Record<DiscoverCat, string> = {
  attractions: svg(`<path ${S} d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18"/>`),
  food: svg(`<path ${S} d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M17 21V3c-2.5 1-3.5 4-3.5 7.5 0 2 1.5 3 3.5 3"/>`),
  resorts: svg(`<path ${S} d="M12 21v-9M12 12C11 9 8 7 4 8c2 1 3 2 3.5 3.5M12 12c1-3 4-5 8-4-2 1-3 2-3.5 3.5M12 12c-2-2-2-5 0-8 2 3 2 6 0 8M6 21h12"/>`),
  themeparks: svg(`<circle ${S} cx="12" cy="10" r="6"/><path ${S} d="M12 4v12M6 10h12M7.8 5.8l8.4 8.4M16.2 5.8l-8.4 8.4M9 21l3-5 3 5M7 21h10"/>`),
  malls: svg(`<path ${S} d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8zM9 8V6a3 3 0 0 1 6 0v2"/>`),
};
export const CAT_COLOR: Record<DiscoverCat, string> = { attractions: '#0d9488', food: '#ea580c', resorts: '#0891b2', themeparks: '#db2777', malls: '#4f46e5' };

export const LIB_ICON = {
  bookmark: svg(`<path ${S} d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z"/>`),
  link: svg(`<path ${S} d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`),
  out: svg(`<path ${S} d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>`),
  refresh: svg(`<path ${S} d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>`),
  check: svg(`<path ${S} stroke-width="2.6" d="m5 12.5 4.5 4.5L19 7.5"/>`),
  plus: svg(`<path ${S} d="M12 5v14M5 12h14"/>`),
  pin: svg(`<path ${S} d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle ${S} cx="12" cy="10" r="2.2"/>`),
  clock: svg(`<circle ${S} cx="12" cy="12" r="8.5"/><path ${S} d="M12 7.5V12l3 2"/>`),
  phone: svg(`<path ${S} d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>`),
  globe: svg(`<circle ${S} cx="12" cy="12" r="8.5"/><path ${S} d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>`),
  tag: svg(`<path ${S} d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.4" fill="currentColor"/>`),
  trash: svg(`<path ${S} d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>`),
  home: svg(`<path ${S} d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>`),
  work: svg(`<rect ${S} x="3" y="7" width="18" height="13" rx="2"/><path ${S} d="M9 7V5h6v2"/>`),
  star: svg(`<path fill="currentColor" d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>`),
  recent: svg(`<path ${S} d="M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5M12 8v4l3 2"/>`),
  mine: svg(`<path ${S} d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><path ${S} d="M9.5 10l1.7 1.7L14.5 8.5"/>`),
  back: svg(`<path ${S} d="M15 5l-7 7 7 7"/>`),
  map: svg(`<path ${S} d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14"/>`),
  edit: svg(`<path ${S} d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>`),
};

export interface LibState {
  tab: 'saved' | 'discover';
  cat: DiscoverCat | null;
  result: DiscoverResult | null;
  loading: boolean;
  /** Why the last search failed, when nothing came back. */
  error: string;
  /** The group open in Saved. */
  group: string | null;
  /** Making a new group. */
  adding: boolean;
  renaming: string | null;
  /** A group whose Delete was tapped once (the second tap deletes it). */
  confirmDelete: string | null;
}

export const newLibState = (): LibState => ({ tab: 'discover', cat: null, result: null, loading: false, error: '', group: null, adding: false, renaming: null, confirmDelete: null });

export interface LibraryHost {
  L: LangCode;
  units: Units;
  myPos: LngLat | null;
  places: PlaceStore;
  /** Your pins and registered places, as places. */
  pins: Place[];
  mine: Place[];
  /** The hosted preview: no Discover (it has no internet access). */
  noDiscover: boolean;
  head: (title: string, onClose: () => void, back?: boolean) => HTMLElement;
  rerender: () => void;
  open: (p: Place) => void;
  close: () => void;
  runDiscover: (cat: DiscoverCat, force: boolean) => void;
  showGroup: (id: string) => void;
  toast: (msg: string) => void;
}

/** A discovered place as the app's place (search, directions, the place page, saving). */
export function discoverToPlace(p: DiscoverPlace): Place {
  return { name: p.name, sub: [p.kind, p.area].filter(Boolean).join(' · '), lngLat: p.lngLat, kind: 'discover', discover: p };
}

export function groupName(id: string, places: PlaceStore, lang: LangCode): string {
  const w = discoverWords(lang);
  if (id === FAV) return w.favourites;
  const g = places.groups.find((x) => x.id === id);
  if (!g) return '';
  return g.builtIn === 'want' && !g.name ? w.wantToGo : g.name;
}

function ago(t: number, lang: LangCode): string {
  const w = discoverWords(lang);
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return w.justNow;
  if (m < 60) return w.minAgo(m);
  return w.hAgo(Math.round(m / 60));
}

function km(m: number, units: Units): string {
  return formatDistance(m, units);
}

/** A search radius in whole kilometres (or miles): "5 km". */
function radiusText(m: number, units: Units): string {
  return units === 'imperial' ? `${Math.max(1, Math.round(m / 1609.344))} mi` : `${Math.max(1, Math.round(m / 1000))} km`;
}

function photoEl(url: string | undefined, cat: DiscoverCat | undefined, cls: string): HTMLElement {
  const box = h('span', { class: `${cls}${url ? '' : ' is-icon'}`, style: cat ? `--dc:${CAT_COLOR[cat]}` : '' });
  if (!url) {
    box.innerHTML = cat ? CAT_ICON[cat] : LIB_ICON.pin;
    return box;
  }
  const img = h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) as HTMLImageElement;
  img.addEventListener('error', () => {
    box.classList.add('is-icon');
    box.innerHTML = cat ? CAT_ICON[cat] : LIB_ICON.pin;
  });
  box.append(img);
  return box;
}

const SOCIAL_SHORT: Partial<Record<SourceKind, string>> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', wikipedia: 'Wikipedia' };

/* ==================================================================== the tab */

export function renderLibrary(s: HTMLElement, st: LibState, host: LibraryHost) {
  const w = discoverWords(host.L);
  s.append(host.head(w.tab, host.close));
  const tab = (id: LibState['tab'], label: string) =>
    h('button', {
      type: 'button',
      role: 'tab',
      class: 'lib-tab',
      id: `lib-tab-${id}`,
      'aria-selected': String(st.tab === id),
      onclick: () => {
        st.tab = id;
        host.rerender();
      },
    }, label);
  if (!host.noDiscover) s.append(h('div', { class: 'lib-tabs', role: 'tablist' }, tab('discover', w.discover), tab('saved', w.saved)));
  if (st.tab === 'discover' && !host.noDiscover) renderDiscover(s, st, host);
  else renderSaved(s, st, host);
}

function renderDiscover(s: HTMLElement, st: LibState, host: LibraryHost) {
  const w = discoverWords(host.L);
  s.append(
    h(
      'div',
      { class: 'disc-cats', role: 'group', 'aria-label': w.discover },
      ...DISCOVER_CATS.map((c) =>
        h('button', {
          type: 'button',
          class: 'disc-cat',
          'data-cat': c,
          'aria-pressed': String(st.cat === c),
          style: `--dc:${CAT_COLOR[c]}`,
          html: `${CAT_ICON[c]}<span>${w.cats[c]}</span>`,
          onclick: () => host.runDiscover(c, false),
        }),
      ),
    ),
  );
  const credits = h('p', { class: 'disc-credits' }, w.credits);
  if (!st.cat) {
    s.append(h('p', { class: 'muted disc-hint' }, w.hint), credits);
    return;
  }
  const r = st.result;
  if (!r || r.cat !== st.cat) {
    s.append(h('p', { class: 'muted disc-status', role: 'status' }, st.loading ? w.loading : st.error || w.none), credits);
    return;
  }
  const refresh = h('button', {
    type: 'button',
    class: 'pill disc-refresh',
    html: `${LIB_ICON.refresh}<span>${w.refresh}</span>`,
    disabled: st.loading,
    onclick: () => host.runDiscover(r.cat, true),
  });
  s.append(
    h(
      'div',
      { class: 'disc-meta' },
      h('span', { class: 'disc-area' }, `${w.around(radiusText(r.radius, host.units))} · ${st.loading ? w.loading : w.updated(ago(r.at, host.L))}`),
      refresh,
    ),
  );
  if (r.used.includes('local')) s.append(h('p', { class: 'disc-note' }, w.offline));
  else if (r.failed.length) s.append(h('p', { class: 'disc-note' }, w.partial(r.failed.map((k) => SOURCE_NAMES[k]).join(', '))));
  if (!r.places.length) {
    s.append(h('p', { class: 'muted disc-status' }, w.none), credits);
    return;
  }
  const list = h('ol', { class: 'disc-list' });
  for (const p of r.places) {
    const from = host.myPos ?? r.center;
    const badges = h('span', { class: 'dc-badges' });
    if (p.pick) badges.append(h('span', { class: 'dc-badge is-pick' }, w.pickBadge));
    const kinds = new Set(p.sources.map((x) => x.kind));
    for (const k of ['tiktok', 'instagram', 'facebook', 'wikipedia'] as SourceKind[]) if (kinds.has(k)) badges.append(h('span', { class: `dc-badge is-${k}` }, SOCIAL_SHORT[k]!));
    const card = h(
      'button',
      { type: 'button', class: 'disc-card', onclick: () => host.open(discoverToPlace(p)) },
      photoEl(p.photo?.url, p.cat, 'dc-photo'),
      h(
        'span',
        { class: 'dc-body' },
        h('span', { class: 'dc-name' }, p.name),
        h('span', { class: 'dc-kind' }, [p.kind, p.area].filter(Boolean).join(' · ')),
        p.about ? h('span', { class: 'dc-about' }, p.about.length > 150 ? `${p.about.slice(0, 147).trim()}…` : p.about) : null,
        badges.childNodes.length ? badges : null,
      ),
      h('span', { class: 'dc-dist' }, km(haversine(from, p.lngLat), host.units)),
    );
    list.append(h('li', {}, card));
  }
  s.append(list, credits);
}

/* ==================================================================== saved */

function row(p: { icon?: string; photo?: string; cat?: DiscoverCat; name: string; sub?: string; note?: string; onOpen: () => void; extra?: (HTMLElement | null)[] }): HTMLElement {
  const lead = p.photo || p.cat ? photoEl(p.photo, p.cat, 'lr-photo') : h('span', { class: 'lr-ico', html: p.icon ?? LIB_ICON.pin });
  const main = h(
    'button',
    { type: 'button', class: 'lr-main', onclick: p.onOpen },
    lead,
    h('span', { class: 'lr-body' }, h('span', { class: 'lr-name' }, p.name), p.sub ? h('span', { class: 'lr-sub' }, p.sub) : null),
    p.note ? h('span', { class: 'lr-note' }, p.note) : null,
  );
  return h('li', { class: 'lib-row' }, main, ...(p.extra ?? []).filter((x): x is HTMLElement => !!x));
}

function dist(host: LibraryHost, at: LngLat): string {
  return host.myPos ? km(haversine(host.myPos, at), host.units) : '';
}

function section(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return h('section', { class: 'lib-sec' }, h('h3', {}, title), ...children);
}

function renderSaved(s: HTMLElement, st: LibState, host: LibraryHost): void {
  if (st.group) return renderGroup(s, st, host, st.group);
  const w = discoverWords(host.L);
  const d = host.places.data;
  // Home and Work.
  const hw = h('ul', { class: 'lib-rows' });
  const clear = (fn: () => void, label: string) => h('button', { type: 'button', class: 'mini lr-act', 'aria-label': label, title: label, html: LIB_ICON.trash, onclick: fn });
  if (d.home) hw.append(row({ icon: LIB_ICON.home, name: w.home, sub: d.home.name, note: dist(host, d.home.lngLat), onOpen: () => host.open(d.home!), extra: [clear(() => host.places.clearHome(), `${w.remove} ${w.home}`)] }));
  if (d.work) hw.append(row({ icon: LIB_ICON.work, name: w.work, sub: d.work.name, note: dist(host, d.work.lngLat), onOpen: () => host.open(d.work!), extra: [clear(() => host.places.clearWork(), `${w.remove} ${w.work}`)] }));
  if (hw.childNodes.length) s.append(h('section', { class: 'lib-sec' }, hw));

  // Groups.
  const groups = h('ul', { class: 'lib-rows lib-groups' });
  const groupRow = (id: string, color: string, icon: string) => {
    const n = host.places.items(id).length;
    const li = row({
      icon,
      name: groupName(id, host.places, host.L),
      note: w.places(n),
      onOpen: () => {
        st.group = id;
        st.renaming = null;
        st.confirmDelete = null;
        host.rerender();
      },
    });
    li.classList.add('is-group');
    li.style.setProperty('--gc', color);
    li.dataset.group = id;
    return li;
  };
  groups.append(groupRow(FAV, '#f59e0b', LIB_ICON.star));
  for (const g of host.places.groups) groups.append(groupRow(g.id, g.color, LIB_ICON.bookmark));
  let adder: HTMLElement;
  if (st.adding) {
    const input = h('input', { type: 'text', class: 'lib-input', id: 'lib-new-group', maxlength: '60', placeholder: w.groupName, 'aria-label': w.groupName }) as HTMLInputElement;
    const create = () => {
      const id = host.places.createGroup(input.value);
      if (!id) return input.focus();
      st.adding = false;
      host.rerender();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && create());
    adder = h(
      'div',
      { class: 'lib-form' },
      input,
      h('button', { type: 'button', class: 'btn btn-primary', onclick: create }, w.create),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => ((st.adding = false), host.rerender()) }, w.cancel),
    );
    queueMicrotask(() => input.focus());
  } else
    adder = h('button', {
      type: 'button',
      class: 'pill lib-add',
      html: `${LIB_ICON.plus}<span>${w.newGroup}</span>`,
      onclick: () => {
        st.adding = true;
        host.rerender();
      },
    });
  s.append(section(w.groups, groups, adder));

  // Pins and your registered places.
  const few = (list: Place[], icon: string, title: string) => {
    if (!list.length) return null;
    const ul = h('ul', { class: 'lib-rows' });
    for (const p of list.slice(0, 6)) ul.append(row({ icon, name: p.name, sub: p.sub, note: dist(host, p.lngLat), onOpen: () => host.open(p) }));
    return section(`${title} (${list.length})`, ul, list.length > 6 ? h('p', { class: 'muted lib-more' }, w.more(list.length - 6)) : null);
  };
  const pins = few(host.pins, LIB_ICON.pin, w.pins);
  const mine = few(host.mine, LIB_ICON.mine, w.myPlaces);
  if (pins) s.append(pins);
  if (mine) s.append(mine);

  // Recent destinations.
  if (d.recents.length) {
    const ul = h('ul', { class: 'lib-rows' });
    for (const p of d.recents.slice(0, 6)) ul.append(row({ icon: LIB_ICON.recent, name: p.name, sub: p.sub, note: dist(host, p.lngLat), onOpen: () => host.open(p) }));
    s.append(section(w.recents, ul, h('button', { type: 'button', class: 'pill', html: `${LIB_ICON.trash}<span>${w.clearRecents}</span>`, onclick: () => host.places.clearRecents() })));
  }
  if (!d.home && !d.work && !host.places.allSaved().length && !host.pins.length && !host.mine.length && !d.recents.length) s.append(h('p', { class: 'muted' }, w.empty));
  s.append(h('p', { class: 'disc-credits' }, w.hereSaved));
}

function renderGroup(s: HTMLElement, st: LibState, host: LibraryHost, id: string): void {
  const w = discoverWords(host.L);
  const g: SavedGroup | undefined = host.places.groups.find((x) => x.id === id);
  if (id !== FAV && !g) {
    st.group = null;
    return renderSaved(s, st, host);
  }
  const items = host.places.items(id);
  const name = groupName(id, host.places, host.L);
  const back = h('button', {
    type: 'button',
    class: 'mini',
    'aria-label': w.groups,
    html: LIB_ICON.back,
    onclick: () => {
      st.group = null;
      st.renaming = null;
      st.confirmDelete = null;
      host.rerender();
    },
  });
  const title = h('div', { class: 'lib-group-head', style: `--gc:${id === FAV ? '#f59e0b' : g!.color}` }, back, h('span', { class: 'lg-dot' }), h('h3', {}, name), h('span', { class: 'lr-note' }, w.places(items.length)));
  s.append(title);
  if (st.renaming === id && g) {
    const input = h('input', { type: 'text', class: 'lib-input', id: 'lib-rename', maxlength: '60', value: name, 'aria-label': w.groupName }) as HTMLInputElement;
    const save = () => {
      host.places.renameGroup(id, input.value);
      st.renaming = null;
      host.rerender();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
    s.append(h('div', { class: 'lib-form' }, input, h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, w.saveBtn), h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => ((st.renaming = null), host.rerender()) }, w.cancel)));
    queueMicrotask(() => input.select());
  }
  const acts = h('div', { class: 'pills lib-acts' });
  if (items.length) acts.append(h('button', { type: 'button', class: 'pill', html: `${LIB_ICON.map}<span>${w.showOnMap}</span>`, onclick: () => host.showGroup(id) }));
  if (g) {
    acts.append(h('button', { type: 'button', class: 'pill', html: `${LIB_ICON.edit}<span>${w.rename}</span>`, onclick: () => ((st.renaming = id), host.rerender()) }));
    const confirming = st.confirmDelete === id;
    acts.append(
      h('button', {
        type: 'button',
        class: `pill lib-del${confirming ? ' is-confirm' : ''}`,
        html: `${LIB_ICON.trash}<span>${w.removeGroup}</span>`,
        onclick: () => {
          if (!confirming) {
            st.confirmDelete = id;
            return host.rerender();
          }
          host.places.deleteGroup(id);
          st.group = null;
          st.confirmDelete = null;
          host.rerender();
        },
      }),
    );
  }
  if (acts.childNodes.length) s.append(acts);
  if (st.confirmDelete === id) s.append(h('p', { class: 'disc-note', role: 'alert' }, w.confirmRemoveGroup(items.length)));
  if (!items.length) {
    s.append(h('p', { class: 'muted' }, w.emptyGroup));
    return;
  }
  const others = [FAV, ...host.places.groups.map((x) => x.id)].filter((x) => x !== id);
  const ul = h('ul', { class: 'lib-rows' });
  for (const p of items) {
    const move = h('select', { class: 'lr-move', 'aria-label': `${w.moveTo}: ${p.name}`, title: w.moveTo }) as HTMLSelectElement;
    move.append(h('option', { value: '' }, `${w.moveTo}…`), ...others.map((o) => h('option', { value: o }, groupName(o, host.places, host.L))));
    move.addEventListener('change', () => {
      if (!move.value) return;
      const to = move.value;
      host.places.move(id, to, p);
      host.toast(w.savedTo(groupName(to, host.places, host.L)));
    });
    const del = h('button', {
      type: 'button',
      class: 'mini lr-act',
      'aria-label': `${w.remove}: ${p.name}`,
      title: w.remove,
      html: LIB_ICON.trash,
      onclick: () => {
        host.places.removeFrom(id, p);
        host.toast(w.removedFrom(name));
      },
    });
    ul.append(
      row({
        photo: p.discover?.photo?.url,
        cat: p.discover?.cat,
        icon: LIB_ICON.pin,
        name: p.name,
        sub: p.memo ? `“${p.memo}”` : p.sub,
        note: dist(host, p.lngLat),
        onOpen: () => host.open(p),
        extra: [h('span', { class: 'lr-tools' }, move, del)],
      }),
    );
  }
  s.append(ul);
}

/* ==================================================================== the place page */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function linkRow(l: SourceLink): HTMLElement {
  return h(
    'li',
    {},
    h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', class: `src-link is-${l.kind}` }, h('span', { class: 'sl-kind' }, SOURCE_NAMES[l.kind]), h('span', { class: 'sl-label' }, l.label === SOURCE_NAMES[l.kind] ? hostOf(l.url) : l.label), h('span', { class: 'sl-out', html: LIB_ICON.out })),
  );
}

/** The photo with its credit, the words about the place and where they are from, and its details. */
export function discoverTop(p: DiscoverPlace, lang: LangCode): HTMLElement[] {
  const w = discoverWords(lang);
  const out: HTMLElement[] = [];
  if (p.photo) {
    const credit = p.photo.page
      ? h('a', { href: p.photo.page, target: '_blank', rel: 'noopener noreferrer' }, `${w.photoFrom}: ${p.photo.credit ?? SOURCE_NAMES.commons}`)
      : h('span', {}, `${w.photoFrom}: ${p.photo.credit ?? hostOf(p.photo.url)}`);
    out.push(h('figure', { class: 'place-photo' }, h('img', { src: p.photo.url, alt: p.name, decoding: 'async', referrerpolicy: 'no-referrer' }), h('figcaption', {}, credit)));
  }
  if (p.pick) out.push(h('p', { class: 'place-badges' }, h('span', { class: 'dc-badge is-pick' }, w.pickBadge)));
  if (p.about) {
    const from = p.aboutFrom ? p.sources.find((x) => x.kind === p.aboutFrom) : undefined;
    out.push(
      h(
        'div',
        { class: 'place-about' },
        h('p', {}, p.about),
        p.aboutFrom ? h('p', { class: 'pd-src' }, from ? h('a', { href: from.url, target: '_blank', rel: 'noopener noreferrer' }, w.aboutFrom(SOURCE_NAMES[p.aboutFrom])) : w.aboutFrom(SOURCE_NAMES[p.aboutFrom])) : null,
      ),
    );
  }
  const rows: HTMLElement[] = [];
  const r = (icon: string, content: Node | string) => rows.push(h('div', { class: 'pd-row' }, h('span', { class: 'pd-ico', html: icon }), h('span', { class: 'pd-text' }, content)));
  if (p.hours) r(LIB_ICON.clock, p.hours.replace(/;\s*/g, '; '));
  if (p.address) r(LIB_ICON.pin, p.address);
  if (p.phone) r(LIB_ICON.phone, h('a', { href: `tel:${p.phone.replace(/[^\d+]/g, '')}` }, p.phone));
  if (p.website) r(LIB_ICON.globe, h('a', { href: p.website, target: '_blank', rel: 'noopener noreferrer' }, p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 48)));
  if (p.cuisine) r(CAT_ICON.food, p.cuisine);
  if (p.price) r(LIB_ICON.tag, p.price);
  if (rows.length) out.push(h('div', { class: 'place-details' }, ...rows));
  return out;
}

/** Where the place comes from: every source link (OSM, Wikivoyage, Wikipedia, its own pages). */
export function discoverSources(p: DiscoverPlace, lang: LangCode): HTMLElement {
  const w = discoverWords(lang);
  return h('section', { class: 'place-sources' }, h('h3', {}, w.sources), h('ul', { class: 'src-list' }, ...p.sources.map(linkRow)));
}

/** Searches for the place on TikTok, Instagram, Facebook and Google Maps. */
export function lookUpRow(name: string, area: string | undefined, at: LngLat, lang: LangCode): HTMLElement {
  const w = discoverWords(lang);
  return h(
    'div',
    { class: 'lookup' },
    h('span', { class: 'lu-label' }, w.lookUp),
    ...lookUpLinks(name, area, at).map((l) => h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', class: 'pill lu-link', 'data-kind': l.label.toLowerCase().replace(/\s+/g, '') }, l.label)),
  );
}

/** Your note and link on a saved place. */
export function savedNotes(p: Place, lang: LangCode): HTMLElement | null {
  const w = discoverWords(lang);
  if (!p.memo && !p.link) return null;
  let host = '';
  if (p.link) {
    try {
      host = new URL(p.link).hostname.replace(/^www\./, '');
    } catch {
      host = p.link;
    }
  }
  return h(
    'div',
    { class: 'place-memo' },
    p.memo ? h('p', {}, `“${p.memo}”`) : null,
    p.link ? h('a', { href: /^https?:\/\//i.test(p.link) ? p.link : `https://${p.link}`, target: '_blank', rel: 'noopener noreferrer', html: `${LIB_ICON.link}<span>${host || w.link}</span>` }) : null,
  );
}

/**
 * Save to: a tick for each group (Favourites, Want to go, yours), a new group, and your note and
 * link once the place is saved.
 */
export function savePanel(place: Place, places: PlaceStore, lang: LangCode, rerender: () => void, toastFn: (m: string) => void): HTMLElement {
  const w = discoverWords(lang);
  const inGroups = new Set(places.groupsWith(place));
  const ids = [FAV, ...places.groups.map((g) => g.id)];
  const list = h('ul', { class: 'save-list' });
  for (const id of ids) {
    const on = inGroups.has(id);
    const color = id === FAV ? '#f59e0b' : (places.groups.find((g) => g.id === id)?.color ?? '#0d9488');
    list.append(
      h(
        'li',
        {},
        h('button', {
          type: 'button',
          class: 'save-opt',
          'aria-pressed': String(on),
          'data-group': id,
          style: `--gc:${color}`,
          html: `<span class="so-box">${on ? LIB_ICON.check : ''}</span><span class="so-name"></span><span class="so-count">${places.items(id).length}</span>`,
          onclick: () => {
            const name = groupName(id, places, lang);
            if (on) {
              places.removeFrom(id, place);
              toastFn(w.removedFrom(name));
            } else {
              places.addTo(id, place);
              toastFn(w.savedTo(name));
            }
            rerender();
          },
        }),
      ),
    );
    (list.lastElementChild!.querySelector('.so-name') as HTMLElement).textContent = groupName(id, places, lang);
  }
  const input = h('input', { type: 'text', class: 'lib-input', id: 'save-new-group', maxlength: '60', placeholder: w.newGroup, 'aria-label': w.newGroup }) as HTMLInputElement;
  const create = () => {
    const id = places.createGroup(input.value);
    if (!id) return input.focus();
    places.addTo(id, place);
    toastFn(w.savedTo(groupName(id, places, lang)));
    rerender();
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && create());
  const panel = h('div', { class: 'save-panel', role: 'group', 'aria-label': w.saveTo }, h('h3', {}, w.saveTo), list, h('div', { class: 'lib-form' }, input, h('button', { type: 'button', class: 'btn btn-ghost', html: `${LIB_ICON.plus}<span>${w.create}</span>`, onclick: create })));
  const saved = places.savedCopy(place);
  if (saved) {
    const memo = h('textarea', { class: 'lib-input', id: 'save-memo', rows: '2', maxlength: '500', placeholder: w.note, 'aria-label': w.note }) as HTMLTextAreaElement;
    memo.value = saved.memo ?? '';
    const link = h('input', { type: 'url', class: 'lib-input', id: 'save-link', maxlength: '500', placeholder: w.linkHint, 'aria-label': w.link }) as HTMLInputElement;
    link.value = saved.link ?? '';
    const keep = () => {
      places.updateItem(place, { memo: memo.value, link: link.value });
      rerender();
    };
    panel.append(
      h('label', { class: 'sub-label', for: 'save-memo' }, w.note),
      memo,
      h('label', { class: 'sub-label', for: 'save-link' }, w.link),
      link,
      h('div', { class: 'sheet-row' }, h('button', { type: 'button', class: 'btn btn-primary', id: 'save-notes', onclick: keep }, w.saveBtn)),
    );
  }
  return panel;
}

/** Whether a place is saved in any group (for the Save button's star). */
export function isSaved(p: Place, places: PlaceStore): boolean {
  return places.groupsWith(p).length > 0 || places.allSaved().some((x) => samePlace(x, p));
}
