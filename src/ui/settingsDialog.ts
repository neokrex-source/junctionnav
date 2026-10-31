import { SIGN_THEMES } from '../junction/signs';
import { STYLES } from '../map/styles';
import { DEFAULTS, type Settings } from '../state/settings';
import { h } from './dom';

function select(id: string, value: string, options: [string, string][]) {
  const s = h('select', { id, name: id }) as HTMLSelectElement;
  for (const [v, t] of options) s.append(h('option', { value: v }, t));
  s.value = value;
  return s;
}

function grp(label: string, control: HTMLElement, hint?: string) {
  const id = control.id;
  return h('div', { class: 'grp' }, h('label', { for: id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
}

/** Opens the settings dialog; resolves with new settings, or null if cancelled. */
export function openSettings(current: Settings, opts: { offline?: boolean } = {}): Promise<Settings | null> {
  return new Promise((resolve) => {
    const style = select('mapStyle', current.mapStyle, STYLES.map((s) => [s.id, s.label]));
    const customStyleUrl = h('input', { id: 'customStyleUrl', type: 'url', value: current.customStyleUrl, placeholder: 'https://…/style.json' }) as HTMLInputElement;
    const maptilerKey = h('input', { id: 'maptilerKey', type: 'text', value: current.maptilerKey, placeholder: 'Only for MapTiler styles', autocomplete: 'off' }) as HTMLInputElement;
    const appearance = select('appearance', current.appearance, [
      ['auto', 'Auto (night after 7 pm)'],
      ['day', 'Day'],
      ['night', 'Night'],
    ]);
    const signTheme = select('signTheme', current.signTheme, [['auto', 'Auto (by location)'], ...Object.values(SIGN_THEMES).map((t) => [t.id, t.label] as [string, string])]);
    const lang = select('lang', current.lang, [
      ['en', 'English'],
      ['ms', 'Bahasa Melayu'],
      ['ja', '日本語'],
    ]);
    const units = select('units', current.units, [
      ['metric', 'Kilometres'],
      ['imperial', 'Miles'],
    ]);
    const jvMode = select('jvMode', current.jvMode, [
      ['illustration', '3D illustration'],
      ['map', 'Zoomed map'],
      ['both', 'Both'],
    ]);
    const voice = h('input', { id: 'voice', type: 'checkbox' }) as HTMLInputElement;
    voice.checked = current.voice;
    const laneAlerts = select('laneAlerts', current.laneAlerts, [
      ['gps', 'Early lane advice + GPS lane check'],
      ['advice', 'Early lane advice only'],
      ['off', 'Off'],
    ]);
    const tunnels = h('input', { id: 'tunnelAlerts', type: 'checkbox' }) as HTMLInputElement;
    tunnels.checked = current.tunnelAlerts;
    const surround = h('input', { id: 'jvSurround', type: 'checkbox' }) as HTMLInputElement;
    surround.checked = current.jvSurround;
    const routerUrl = h('input', { id: 'routerUrl', type: 'url', value: current.routerUrl }) as HTMLInputElement;
    const overpassUrls = h('input', { id: 'overpassUrls', type: 'text', value: current.overpassUrls.replace(/\n/g, ', ') }) as HTMLInputElement;
    const photonUrl = h('input', { id: 'photonUrl', type: 'url', value: current.photonUrl }) as HTMLInputElement;

    const reset = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Reset servers');
    reset.addEventListener('click', () => {
      routerUrl.value = DEFAULTS.routerUrl;
      overpassUrls.value = DEFAULTS.overpassUrls.replace(/\n/g, ', ');
      photonUrl.value = DEFAULTS.photonUrl;
    });

    const form = h(
      'form',
      { method: 'dialog' },
      h('h2', {}, 'Settings'),
      opts.offline ? null : grp('Map', style),
      opts.offline ? null : grp('Custom style URL', customStyleUrl),
      opts.offline ? null : grp('MapTiler key', maptilerKey),
      h('div', { class: 'row' }, grp('Appearance', appearance), grp('Signboards', signTheme)),
      h('div', { class: 'row' }, grp('Language', lang), grp('Units', units)),
      h('div', { class: 'row' }, grp('Junction view', jvMode), h('div', { class: 'grp' }, h('label', { for: 'voice' }, 'Voice guidance'), h('label', { class: 'toggle' }, voice, 'Spoken prompts'))),
      grp('Lane alerts', laneAlerts, 'Says which lane to be in before exits, entrances and junctions. The GPS check warns again only when your position clearly puts you outside those lanes; phone GPS is accurate to a few metres, so it stays cautious.'),
      h(
        'div',
        { class: 'grp' },
        h('label', { for: 'tunnelAlerts' }, 'Tunnels'),
        h('label', { class: 'toggle' }, tunnels, 'Tunnel sign and voice warning'),
        h('div', { class: 'hint' }, 'Shows the tunnel name and length before you reach it, then the distance to the exit. Guidance keeps going on an estimated position when GPS drops out inside.'),
      ),
      h(
        'div',
        { class: 'grp' },
        h('label', { for: 'jvSurround' }, 'Junction surroundings'),
        h('label', { class: 'toggle' }, surround, 'Show buildings, land use and place names around junctions'),
        opts.offline ? null : h('div', { class: 'hint' }, 'Downloads a few hundred KB from Overpass for each upcoming junction.'),
      ),
      opts.offline ? null : grp('Routing server (OSRM)', routerUrl, 'Public demo servers are for light use. Run your own for real driving (see README).'),
      opts.offline ? null : grp('Junction detail (Overpass API)', overpassUrls, 'Comma separated. Tried in order.'),
      opts.offline ? null : grp('Search (Photon)', photonUrl),
      h('menu', {}, opts.offline ? null : reset, h('button', { value: 'cancel', class: 'btn btn-ghost' }, 'Cancel'), h('button', { value: 'save', class: 'btn btn-primary', style: 'flex:0' }, 'Save')),
    );
    const dlg = h('dialog', { class: 'settings', 'aria-label': 'Settings' }, form) as HTMLDialogElement;
    document.body.append(dlg);
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'save';
      dlg.remove();
      if (!ok) return resolve(null);
      resolve({
        ...current,
        mapStyle: style.value,
        customStyleUrl: customStyleUrl.value.trim(),
        maptilerKey: maptilerKey.value.trim(),
        appearance: appearance.value as Settings['appearance'],
        signTheme: signTheme.value as Settings['signTheme'],
        lang: lang.value as Settings['lang'],
        units: units.value as Settings['units'],
        jvMode: jvMode.value as Settings['jvMode'],
        voice: voice.checked,
        jvSurround: surround.checked,
        laneAlerts: laneAlerts.value as Settings['laneAlerts'],
        tunnelAlerts: tunnels.checked,
        routerUrl: routerUrl.value.trim() || DEFAULTS.routerUrl,
        overpassUrls: overpassUrls.value.split(',').map((s) => s.trim()).filter(Boolean).join('\n') || DEFAULTS.overpassUrls,
        photonUrl: photonUrl.value.trim() || DEFAULTS.photonUrl,
      });
    });
    dlg.showModal();
  });
}
