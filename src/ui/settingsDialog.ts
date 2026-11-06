import { SIGN_THEMES } from '../junction/signs';
import { STYLES } from '../map/styles';
import type { OfflineStore } from '../offline/store';
import { BUILT_IN_TOMTOM_KEY, DEFAULTS, type Settings } from '../state/settings';
import { TomTomTraffic } from '../traffic/tomtom';
import { runningCopy } from '../native/appMode';
import { APK_URL, APP_VERSION, NATIVE, TRAFFIC_NEWS_URL } from '../platform';
import { h } from './dom';
import { offlinePanel } from './offlinePanel';

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

export interface AccountOptions {
  name: string;
  email: string;
  /** 'local' accounts live in this browser and can be removed here. */
  kind: 'local' | 'supabase';
  onSignOut: () => void;
  onRemove?: () => void;
}

/** Opens the settings dialog; resolves with new settings, or null if cancelled. */
export interface SettingsOptions {
  /** The self-contained preview: no servers or map styles to choose. */
  preview?: boolean;
  account?: AccountOptions | null;
  onSignIn?: () => void;
  /** Offline maps storage, when this build offers them. */
  pack?: OfflineStore;
}

export function openSettings(current: Settings, opts: SettingsOptions = {}): Promise<Settings | null> {
  return new Promise((resolve) => {
    const style = select('mapStyle', current.mapStyle, STYLES.map((s) => [s.id, s.label]));
    const customStyleUrl = h('input', { id: 'customStyleUrl', type: 'url', value: current.customStyleUrl, placeholder: 'https://…/style.json' }) as HTMLInputElement;
    const maptilerKey = h('input', { id: 'maptilerKey', type: 'text', value: current.maptilerKey, placeholder: 'Only for MapTiler styles', autocomplete: 'off' }) as HTMLInputElement;
    const appearance = select('appearance', current.appearance, [
      ['auto', 'Automatic (sunrise and sunset)'],
      ['day', 'Always bright'],
      ['night', 'Always dark'],
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
    const jvSize = select('jvSize', current.jvSize, [
      ['1:3', '1:3 (a quarter of the screen)'],
      ['2:3', '2:3 (two fifths)'],
      ['full', 'Full screen while it is up'],
    ]);
    const closeUp = h('input', { id: 'closeUp', type: 'checkbox' }) as HTMLInputElement;
    closeUp.checked = current.closeUp;
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
    const mapGround = h('input', { id: 'jvMapGround', type: 'checkbox' }) as HTMLInputElement;
    mapGround.checked = current.jvMapGround;
    const offlineUse = select('offlineUse', current.offlineUse, [
      ['auto', 'Use them when there is no internet'],
      ['always', 'Always use them (saves mobile data)'],
    ]);
    const pack = opts.pack ? offlinePanel(opts.pack, offlineUse) : null;
    // In the Android app: the built-in copy, or the latest website build downloaded into the app.
    const appMode = select('appMode', current.appMode, [
      ['built-in', 'Built into the app'],
      ['web', 'Latest from the website'],
    ]);
    const run = runningCopy();
    const runText =
      run.kind === 'built-in'
        ? `Now running the built-in version ${APP_VERSION}.`
        : `Now running the website version${run.built ? ` of ${new Date(run.built).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.`;
    const appVersion = NATIVE
      ? h(
          'div',
          { class: 'grp' },
          h('label', { for: 'appMode' }, 'App version'),
          appMode,
          h('div', { class: 'app-running' }, runText),
          h(
            'div',
            { class: 'hint' },
            'Built into the app: opens with no internet from the very first start and changes only when you install a newer installer. Latest from the website: the app downloads the newest version from the website (about 2 MB) and updates itself when online, keeping a copy so it still opens with no signal. Both use the same account, saved places and offline maps.',
          ),
        )
      : null;
    // On the website: the same app as an Android app, built by .github/workflows/android.yml.
    const androidApp =
      APK_URL && !opts.preview
        ? h(
            'div',
            { class: 'grp' },
            h('label', {}, 'Android app'),
            h('a', { class: 'btn btn-ghost apk-link', href: APK_URL, rel: 'noopener' }, 'Download the Android installer (APK)'),
            h(
              'div',
              { class: 'hint' },
              'The same app installed on your phone: it opens without internet from the first start, speaks with Android’s own voices and keeps the screen on while you drive. Open the downloaded file and allow your browser to install apps when Android asks.',
            ),
          )
        : null;
    // Live traffic (TomTom, the user's own free key) and traffic news (no key).
    const tomtomKey = h('input', {
      id: 'tomtomKey',
      type: 'text',
      value: current.tomtomKey,
      placeholder: BUILT_IN_TOMTOM_KEY ? 'Built-in key in use; paste your own to use it instead' : 'Paste your free TomTom API key',
      autocomplete: 'off',
      spellcheck: 'false',
    }) as HTMLInputElement;
    const trafficMap = h('input', { id: 'trafficMap', type: 'checkbox' }) as HTMLInputElement;
    trafficMap.checked = current.trafficMap;
    const trafficAlerts = h('input', { id: 'trafficAlerts', type: 'checkbox' }) as HTMLInputElement;
    trafficAlerts.checked = current.trafficAlerts;
    const trafficNews = h('input', { id: 'trafficNews', type: 'checkbox' }) as HTMLInputElement;
    trafficNews.checked = current.trafficNews;
    const keyState = h('div', { class: 'key-state', role: 'status' });
    const testKey = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Test key') as HTMLButtonElement;
    testKey.addEventListener('click', async () => {
      const key = tomtomKey.value.trim() || BUILT_IN_TOMTOM_KEY;
      if (!key) {
        keyState.dataset.ok = 'false';
        keyState.textContent = 'Paste a key first.';
        return;
      }
      testKey.disabled = true;
      keyState.dataset.ok = '';
      keyState.textContent = 'Checking…';
      try {
        // A small box in central Kuala Lumpur.
        const list = await new TomTomTraffic(() => key).incidents([101.66, 3.12, 101.73, 3.18]);
        keyState.dataset.ok = 'true';
        keyState.textContent = `The key works: ${list.length} incident${list.length === 1 ? '' : 's'} in central Kuala Lumpur right now.`;
      } catch (err) {
        keyState.dataset.ok = 'false';
        keyState.textContent = (err as Error).message === 'Failed to fetch' ? 'TomTom could not be reached. Check your internet connection.' : (err as Error).message;
      } finally {
        testKey.disabled = false;
      }
    });
    const traffic = opts.preview
      ? null
      : h(
          'div',
          { class: 'grp' },
          h('label', { for: 'tomtomKey' }, 'Live traffic (TomTom key)'),
          h('div', { class: 'key-row' }, tomtomKey, testKey),
          keyState,
          h('label', { class: 'toggle' }, trafficMap, 'Show live traffic on the map and your route'),
          h('label', { class: 'toggle' }, trafficAlerts, 'Voice guide for traffic: warnings ahead, clearing traffic, arrival time changes, faster routes and news'),
          TRAFFIC_NEWS_URL ? h('label', { class: 'toggle' }, trafficNews, 'Traffic news from Malaysian news sites') : null,
          h(
            'div',
            { class: 'hint' },
            'Live traffic colours slow roads on the map, marks accidents, closures, roadworks and floods, warns you before the ones on your route, gives arrival times with traffic and offers a faster route when one opens up. It needs a free TomTom key (no card): sign up at ',
            h('a', { href: 'https://developer.tomtom.com/user/register', target: '_blank', rel: 'noopener' }, 'developer.tomtom.com'),
            ', open your dashboard and copy the API key here. The free allowance covers hours of driving every day.' +
              (TRAFFIC_NEWS_URL ? ' Traffic news needs no key: headlines are collected every 20 minutes, and the ones naming roads on your route are flagged.' : ''),
          ),
        );
    const routerUrl = h('input', { id: 'routerUrl', type: 'url', value: current.routerUrl }) as HTMLInputElement;
    const overpassUrls = h('input', { id: 'overpassUrls', type: 'text', value: current.overpassUrls.replace(/\n/g, ', ') }) as HTMLInputElement;
    const photonUrl = h('input', { id: 'photonUrl', type: 'url', value: current.photonUrl }) as HTMLInputElement;

    const reset = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Reset servers');
    reset.addEventListener('click', () => {
      routerUrl.value = DEFAULTS.routerUrl;
      overpassUrls.value = DEFAULTS.overpassUrls.replace(/\n/g, ', ');
      photonUrl.value = DEFAULTS.photonUrl;
    });

    let accountEl: HTMLElement | null = null;
    const acc = opts.account;
    if (acc) {
      const initials = acc.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
      const signOut = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Sign out');
      signOut.addEventListener('click', () => {
        dlg.close('cancel');
        acc.onSignOut();
      });
      const remove = acc.onRemove ? h('button', { type: 'button', class: 'btn btn-ghost acct-remove' }, 'Remove account') : null;
      remove?.addEventListener('click', () => {
        if (!window.confirm(`Remove the account for ${acc.email} and its saved places from this browser?`)) return;
        dlg.close('cancel');
        acc.onRemove!();
      });
      accountEl = h(
        'div',
        { class: 'acct' },
        h('span', { class: 'acct-avatar', 'aria-hidden': 'true' }, initials),
        h('div', { class: 'acct-who' }, h('strong', {}, acc.name), h('span', {}, acc.email), h('small', {}, acc.kind === 'local' ? 'Account saved in this browser' : 'Account synced online')),
        h('div', { class: 'acct-actions' }, signOut, remove),
      );
    } else if (opts.account === null) {
      const signIn = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Sign in');
      signIn.addEventListener('click', () => {
        dlg.close('cancel');
        opts.onSignIn?.();
      });
      accountEl = h(
        'div',
        { class: 'acct' },
        h('span', { class: 'acct-avatar', 'aria-hidden': 'true' }, '?'),
        h('div', { class: 'acct-who' }, h('strong', {}, 'Not signed in'), h('small', {}, 'Saved places stay in this browser')),
        h('div', { class: 'acct-actions' }, signIn),
      );
    }

    const form = h(
      'form',
      { method: 'dialog' },
      h('h2', {}, 'Settings'),
      accountEl,
      appVersion,
      opts.preview ? null : grp('Map', style),
      opts.preview ? null : grp('Custom style URL', customStyleUrl),
      opts.preview ? null : grp('MapTiler key', maptilerKey),
      h('div', { class: 'row' }, grp('Appearance', appearance), grp('Signboards', signTheme)),
      h('div', { class: 'row' }, grp('Language', lang), grp('Units', units)),
      h('div', { class: 'row' }, grp('Junction view', jvMode), grp('View size', jvSize)),
      h(
        'div',
        { class: 'grp' },
        h('label', { for: 'closeUp' }, 'Close-up at splits'),
        h('label', { class: 'toggle' }, closeUp, 'Zoom the map in to 50 m at forks, turns, dividers, ramps, exits, entrances and junctions'),
        h('div', { class: 'hint' }, 'The route line gets thinner so the road shows. Through every junction the route is orange from 300 m before the split (as in the junction view) and dark orange for the 100 m either side of the split itself; the other roads at the split are grey, so only the orange line is your way. Works with the automatic map scale.'),
      ),
      h('div', { class: 'grp' }, h('label', { for: 'voice' }, 'Voice guidance'), h('label', { class: 'toggle' }, voice, 'Spoken prompts')),
      grp('Lane alerts', laneAlerts, 'Says which lane to be in before exits, entrances and junctions. The GPS check warns again only when your position clearly puts you outside those lanes; phone GPS is accurate to a few metres, so it stays cautious.'),
      h(
        'div',
        { class: 'grp' },
        h('label', { for: 'tunnelAlerts' }, 'Tunnels'),
        h('label', { class: 'toggle' }, tunnels, 'Tunnel sign and voice warning'),
        h('div', { class: 'hint' }, 'Shows the tunnel name and length before you reach it, then the distance to the exit. Guidance keeps going on an estimated position when GPS drops out inside.'),
      ),
      traffic,
      pack?.el,
      androidApp,
      h(
        'div',
        { class: 'grp' },
        h('label', { for: 'jvSurround' }, 'Junction surroundings'),
        h('label', { class: 'toggle' }, surround, 'Show buildings, land use and place names around junctions'),
        h('label', { class: 'toggle' }, mapGround, 'Lay the map under the 3D view'),
        h(
          'div',
          { class: 'hint' },
          'The 3D view shows the streets, parks and water around each junction as on the map, and every flyover, bridge and tunnel within 900 m at its real height.' +
            (opts.preview ? '' : ' Surroundings download a few hundred KB from Overpass for each upcoming junction.'),
        ),
      ),
      opts.preview ? null : grp('Routing server (OSRM)', routerUrl, 'Public demo servers are for light use. Run your own for real driving (see README).'),
      opts.preview ? null : grp('Junction detail (Overpass API)', overpassUrls, 'Comma separated. Tried in order.'),
      opts.preview ? null : grp('Search (Photon)', photonUrl),
      h('menu', {}, opts.preview ? null : reset, h('button', { value: 'cancel', class: 'btn btn-ghost' }, 'Cancel'), h('button', { value: 'save', class: 'btn btn-primary', style: 'flex:0' }, 'Save')),
    );
    const dlg = h('dialog', { class: 'settings', 'aria-label': 'Settings' }, form) as HTMLDialogElement;
    document.body.append(dlg);
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'save';
      pack?.dispose();
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
        jvSize: jvSize.value as Settings['jvSize'],
        closeUp: closeUp.checked,
        appMode: appMode.value as Settings['appMode'],
        voice: voice.checked,
        jvSurround: surround.checked,
        jvMapGround: mapGround.checked,
        laneAlerts: laneAlerts.value as Settings['laneAlerts'],
        tunnelAlerts: tunnels.checked,
        tomtomKey: tomtomKey.value.trim(),
        trafficMap: trafficMap.checked,
        trafficAlerts: trafficAlerts.checked,
        trafficNews: trafficNews.checked,
        offlineUse: offlineUse.value as Settings['offlineUse'],
        routerUrl: routerUrl.value.trim() || DEFAULTS.routerUrl,
        overpassUrls: overpassUrls.value.split(',').map((s) => s.trim()).filter(Boolean).join('\n') || DEFAULTS.overpassUrls,
        photonUrl: photonUrl.value.trim() || DEFAULTS.photonUrl,
      });
    });
    dlg.showModal();
  });
}
