/**
 * Registering a place, or changing one of yours: its name, kind, note, phone and website, where
 * it is (and the direction of travel there, so a route arrives on the right side of the road),
 * and who can see it. The form edits the draft it is given, so moving the pin and coming back
 * keeps what was typed.
 */
import { ARROW_SVG, headingText } from '../pins/heading';
import type { LangCode } from '../routing/instructions';
import { cleanFields, FORM_GROUPS, groupLabel, NAME_MAX, NOTE_MAX, placeWords, type Visibility } from '../community/types';
import type { PlaceFields } from '../community/store';
import { h } from './dom';
import { placeSvg } from './placeIcons';

export interface PlaceDraft extends PlaceFields {
  /** The place being changed (null: a new one). */
  id: string | null;
  /** The pin it was made from (removed once the place is saved). */
  fromPin?: string;
  /** What is there (an address or coordinates), shown under Location. */
  where: string;
}

export interface PlaceFormOptions {
  lang: LangCode;
  draft: PlaceDraft;
  /** Why Public cannot be chosen (no service, no account), or null when it can. */
  publicBlocked: string | null;
  onMove: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

let seq = 0;

export function placeForm(o: PlaceFormOptions): HTMLFormElement {
  const w = placeWords(o.lang);
  const d = o.draft;
  const id = (k: string) => `pf-${k}-${++seq}`;
  const form = h('form', { class: 'pf', novalidate: true }) as HTMLFormElement;
  const error = h('p', { class: 'pf-error', role: 'alert', hidden: true });

  const label = (forId: string, text: string, extra?: string) => h('label', { for: forId }, text, extra ? h('span', { class: 'pf-count' }, extra) : null);

  const nameId = id('name');
  const name = h('input', { id: nameId, type: 'text', maxlength: String(NAME_MAX), autocomplete: 'off', autocapitalize: 'words', required: true, value: d.name }) as HTMLInputElement;
  name.addEventListener('input', () => {
    d.name = name.value;
    name.removeAttribute('aria-invalid');
    error.hidden = true;
  });

  const kindId = id('kind');
  const kind = h('select', { id: kindId }) as HTMLSelectElement;
  for (const g of FORM_GROUPS) kind.append(h('option', { value: g }, groupLabel(g, o.lang)));
  kind.value = FORM_GROUPS.includes(d.category) ? d.category : 'other';
  const kindIco = h('span', { class: 'pf-kind-ico', html: placeSvg(kind.value as PlaceFields['category']) });
  kind.addEventListener('change', () => {
    d.category = kind.value as PlaceFields['category'];
    kindIco.innerHTML = placeSvg(d.category);
  });

  // Where it is, and the direction of travel there.
  const move = h('button', { class: 'pill', type: 'button' }, w.movePin);
  move.addEventListener('click', () => o.onMove());
  const arrow = h('span', { class: `pf-arrow${d.heading == null ? ' is-any' : ''}`, html: ARROW_SVG, style: d.heading == null ? '' : `transform: rotate(${d.heading}deg)` });
  const where = h(
    'div',
    { class: 'pf-where' },
    arrow,
    h('span', { class: 'pf-where-text' }, h('strong', {}, d.where), h('span', {}, d.heading == null ? `${w.direction}: ${w.anyDirection}` : w.heading(headingText(d.heading, o.lang)))),
    move,
  );

  const noteId = id('note');
  const note = h('textarea', { id: noteId, rows: '3', maxlength: String(NOTE_MAX), placeholder: w.notePlaceholder }) as HTMLTextAreaElement;
  note.value = d.note;
  const count = h('span', { class: 'pf-count' });
  const paintCount = () => (count.textContent = d.note.length > NOTE_MAX - 100 ? `${d.note.length}/${NOTE_MAX}` : '');
  note.addEventListener('input', () => {
    d.note = note.value;
    paintCount();
  });
  paintCount();

  const phoneId = id('phone');
  const phone = h('input', { id: phoneId, type: 'tel', inputmode: 'tel', autocomplete: 'off', maxlength: '30', value: d.phone }) as HTMLInputElement;
  phone.addEventListener('input', () => (d.phone = phone.value));
  const webId = id('web');
  const web = h('input', { id: webId, type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', maxlength: '200', placeholder: 'example.com', value: d.website }) as HTMLInputElement;
  web.addEventListener('input', () => (d.website = web.value));

  // Who can see it.
  const group = `pf-vis-${++seq}`;
  if (o.publicBlocked && d.visibility === 'public' && !d.id) d.visibility = 'private';
  const choice = (v: Visibility, title: string, hint: string, disabled: boolean) => {
    const r = h('input', { type: 'radio', name: group, value: v, checked: d.visibility === v, disabled }) as HTMLInputElement;
    r.addEventListener('change', () => r.checked && (d.visibility = v));
    return h('label', { class: `pf-vis${disabled ? ' is-off' : ''}` }, r, h('span', { class: 'pf-vis-text' }, h('strong', {}, title), h('span', {}, hint)));
  };
  const vis = h(
    'fieldset',
    { class: 'pf-vis-group' },
    h('legend', {}, w.whoSees),
    choice('private', w.private, w.privateHint, false),
    choice('public', w.public, o.publicBlocked ?? w.publicHint, !!o.publicBlocked && d.visibility !== 'public'),
  );

  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, w.save);
  const cancel = h('button', { class: 'btn btn-ghost', type: 'button' }, w.cancel);
  cancel.addEventListener('click', () => o.onCancel());
  const row = h('div', { class: 'sheet-row' }, save, cancel);

  form.append(
    h('div', { class: 'pf-field' }, label(nameId, w.name), name),
    h('div', { class: 'pf-field' }, label(kindId, w.kind), h('div', { class: 'pf-kind' }, kindIco, kind)),
    h('div', { class: 'pf-field' }, h('span', { class: 'pf-label' }, w.location), where),
    h('div', { class: 'pf-field' }, h('label', { for: noteId }, w.note, count), note),
    h('div', { class: 'pf-row' }, h('div', { class: 'pf-field' }, label(phoneId, w.phone), phone), h('div', { class: 'pf-field' }, label(webId, w.website), web)),
    vis,
    error,
    row,
  );

  if (o.onDelete) {
    // Deleting takes a second tap, so a slip of the finger does not lose the place.
    let armed = 0;
    const del = h('button', { class: 'btn btn-danger pf-delete', type: 'button' }, w.delete) as HTMLButtonElement;
    del.addEventListener('click', () => {
      if (armed && Date.now() - armed < 4000) return o.onDelete!();
      armed = Date.now();
      del.textContent = w.deleteConfirm;
      window.setTimeout(() => {
        if (del.isConnected) del.textContent = w.delete;
        armed = 0;
      }, 4000);
    });
    form.append(del);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const clean = cleanFields(d);
    if (!clean.name) {
      error.textContent = w.needName;
      error.hidden = false;
      name.setAttribute('aria-invalid', 'true');
      name.focus();
      return;
    }
    Object.assign(d, clean);
    o.onSave();
  });
  return form;
}
