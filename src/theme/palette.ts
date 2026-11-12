/**
 * The app's colours in JavaScript, for each of the three looks (JunctionNav, Fighter jet, Casual): the map, the route line and the markers. The CSS side of the
 * same palette lives in src/styles/app.css (the --tokens), the junction views have theirs in
 * render3d.ts, zoom3d.ts and surroundRender.ts, all from the same set of hues:
 *
 *   Day   (light purple): light grey #F2F0F6, white, black #121016, violet #7C3AED
 *   Night (dark purple):  near-black #0B0910, plum #1A0D2E, white, lilac #B77BFF
 *   Both: amber for warnings, rose for danger, green for confirmations; orange for the route
 *   through a junction (and in the junction views), grey for the other roads at the split.
 */
export interface MapPalette {
  land: string;
  urban: string;
  industrial: string;
  park: string;
  wood: string;
  water: string;
  waterLine: string;
  building: string;
  buildingLine: string;
  minor: string;
  minorCase: string;
  major: string;
  majorCase: string;
  highway: string;
  highwayCase: string;
  link: string;
  tunnel: string;
  rail: string;
  runway: string;
  label: string;
  labelMajor: string;
  labelHalo: string;
  place: string;
  boundary: string;
}

export interface Theme {
  night: boolean;
  /** The route line, its casing and glow, the part already driven, other routes. */
  route: string;
  routeCasing: string;
  routeGlow: string;
  passed: string;
  alt: string;
  /** Text and arrow colour on top of the route colour. */
  routeInk: string;
  /** The impulses that run along the route while navigating: a bright core and its glow. */
  pulse: string;
  pulseGlow: string;
  /**
   * The route through a junction: orange from 300 m before the split (the same as the route in
   * the junction views), dark orange for the 100 m either side of the split itself, with its
   * outline and (at night) glow.
   */
  junction: string;
  junctionCore: string;
  junctionCasing: string;
  junctionGlow: string;
  /** The other roads at the split (the ones not to take): a neutral grey, and the outline that lifts them off the map. */
  fork: string;
  forkCasing: string;
  pin: string;
  map: MapPalette;
}

export const DAY: Theme = {
  night: false,
  route: '#7c3aed',
  routeCasing: '#3b1680',
  routeGlow: 'rgba(124, 58, 237, 0)',
  passed: '#b1a9bf',
  alt: '#b9aee0',
  routeInk: '#ffffff',
  pulse: '#ffffff',
  pulseGlow: '#a78bfa',
  junction: '#ea580c',
  junctionCore: '#9a3412',
  junctionCasing: '#7c2d12',
  junctionGlow: 'rgba(234, 88, 12, 0)',
  fork: '#8a8398',
  forkCasing: '#ffffff',
  pin: '#f43f5e',
  map: {
    land: '#f4f3f7',
    urban: '#efedf3',
    industrial: '#eae8ef',
    park: '#e1ede3',
    wood: '#d5e7d8',
    water: '#d7dcf4',
    waterLine: '#bcc5ee',
    building: '#e5e2eb',
    buildingLine: '#d5d0de',
    minor: '#ffffff',
    minorCase: '#dcd7e4',
    major: '#ffffff',
    majorCase: '#c7c0d4',
    highway: '#e9defc',
    highwayCase: '#b49fe0',
    link: '#f2ebfd',
    tunnel: '#eae6f0',
    rail: '#b3abc0',
    runway: '#e6e3ec',
    label: '#4a4458',
    labelMajor: '#1e1a26',
    labelHalo: '#ffffff',
    place: '#15121b',
    boundary: '#a99fbd',
  },
};

export const NIGHT: Theme = {
  night: true,
  route: '#b77bff',
  routeCasing: '#2e0f57',
  routeGlow: 'rgba(183, 123, 255, 0.36)',
  passed: '#4a3d63',
  alt: '#5d4d7d',
  routeInk: '#0b0910',
  pulse: '#faf5ff',
  pulseGlow: '#d8b4fe',
  junction: '#fb923c',
  junctionCore: '#ea580c',
  junctionCasing: '#431407',
  junctionGlow: 'rgba(251, 146, 60, 0.34)',
  fork: '#7a7190',
  forkCasing: '#0b0910',
  pin: '#fb7185',
  map: {
    land: '#0d0a14',
    urban: '#110d1a',
    industrial: '#130f1c',
    park: '#0f1a16',
    wood: '#0d1c16',
    water: '#140f2e',
    waterLine: '#221a4c',
    building: '#1a1426',
    buildingLine: '#261d36',
    // Roads in soft lavender greys, brighter for bigger roads so the tiers read at a glance, with
    // a near-black edge; low in colour, so the route (saturated lilac with a glow) stays on top.
    minor: '#5a536e',
    minorCase: '#07050b',
    major: '#8a82a3',
    majorCase: '#07050b',
    highway: '#b4abcc',
    highwayCase: '#2b2245',
    link: '#9d94b9',
    tunnel: '#3a3350',
    rail: '#5b5270',
    runway: '#2a2338',
    label: '#cbc3dd',
    labelMajor: '#f0eaf8',
    labelHalo: '#0d0a14',
    place: '#f1ecf8',
    boundary: '#4a3d63',
  },
};

/**
 * Fighter jet: the instruments of a fighter's head-up display. By night phosphor green on black
 * with the route as the magenta line of a flight plan and amber at junctions; by day a light
 * grey-green moving map with the same symbology in darker inks.
 */
export const JET_DAY: Theme = {
  night: false,
  route: '#c0189e',
  routeCasing: '#4a0640',
  routeGlow: 'rgba(192, 24, 158, 0)',
  passed: '#9aa79d',
  alt: '#c99fbf',
  routeInk: '#ffffff',
  pulse: '#ffffff',
  pulseGlow: '#f472d0',
  junction: '#d97706',
  junctionCore: '#92400e',
  junctionCasing: '#4a2a05',
  junctionGlow: 'rgba(217, 119, 6, 0)',
  fork: '#6f8276',
  forkCasing: '#f2f5f0',
  pin: '#d4202f',
  map: {
    land: '#e4e8e1',
    urban: '#dde2da',
    industrial: '#d8ddd5',
    park: '#cfdccc',
    wood: '#c4d6c1',
    water: '#c3d3dc',
    waterLine: '#a8bcc8',
    building: '#d3d9d0',
    buildingLine: '#c0c8bd',
    minor: '#f6f8f4',
    minorCase: '#b9c2b6',
    major: '#ffffff',
    majorCase: '#8fa092',
    highway: '#bfe5ca',
    highwayCase: '#3d7a52',
    link: '#d4ecd9',
    tunnel: '#dfe4dc',
    rail: '#9aa79d',
    runway: '#d2d8cf',
    label: '#3b4a40',
    labelMajor: '#0d1a12',
    labelHalo: '#f2f5f0',
    place: '#0d1a12',
    boundary: '#8c9a90',
  },
};

export const JET_NIGHT: Theme = {
  night: true,
  route: '#ff4fd8',
  routeCasing: '#3a0632',
  routeGlow: 'rgba(255, 79, 216, 0.42)',
  passed: '#24452f',
  alt: '#6a3a62',
  routeInk: '#050806',
  pulse: '#ffe9fb',
  pulseGlow: '#ff9be8',
  junction: '#ffb020',
  junctionCore: '#ff7a00',
  junctionCasing: '#3a2200',
  junctionGlow: 'rgba(255, 176, 32, 0.38)',
  fork: '#4f7a60',
  forkCasing: '#030604',
  pin: '#ff5c5c',
  map: {
    land: '#040705',
    urban: '#060b08',
    industrial: '#07100a',
    park: '#061309',
    wood: '#051408',
    water: '#031019',
    waterLine: '#0a2a3a',
    building: '#0b1710',
    buildingLine: '#123020',
    // Roads as green vector lines, brighter for bigger roads, all well under the magenta route.
    minor: '#173d26',
    minorCase: '#020403',
    major: '#22603b',
    majorCase: '#020403',
    highway: '#2c8f55',
    highwayCase: '#0b2a18',
    link: '#257a48',
    tunnel: '#163a26',
    rail: '#285a3c',
    runway: '#0e2016',
    label: '#7fdca0',
    labelMajor: '#c8ffd9',
    labelHalo: '#030604',
    place: '#d9ffe6',
    boundary: '#2a5a3c',
  },
};

/**
 * Casual: warm and friendly. By day a cream map with mint parks, sky-blue water and peach
 * expressways, coral for the app's accents and a teal route; by night a cosy navy with warm
 * roads and the route in bright aqua.
 */
export const CASUAL_DAY: Theme = {
  night: false,
  route: '#0d9488',
  routeCasing: '#0b4f4a',
  routeGlow: 'rgba(13, 148, 136, 0)',
  passed: '#c9b8a6',
  alt: '#9fd8d0',
  routeInk: '#ffffff',
  pulse: '#ffffff',
  pulseGlow: '#5eead4',
  junction: '#f97316',
  junctionCore: '#c2410c',
  junctionCasing: '#7c2d12',
  junctionGlow: 'rgba(249, 115, 22, 0)',
  fork: '#a8958a',
  forkCasing: '#ffffff',
  pin: '#e11d48',
  map: {
    land: '#fbf4ea',
    urban: '#f6ede2',
    industrial: '#f1e8dc',
    park: '#d9f0d0',
    wood: '#c9e8bd',
    water: '#bfe3f5',
    waterLine: '#9fd2ec',
    building: '#efe4d6',
    buildingLine: '#e2d4c2',
    minor: '#ffffff',
    minorCase: '#ead9c6',
    major: '#ffffff',
    majorCase: '#e6c9a8',
    highway: '#ffd9a8',
    highwayCase: '#f0a35e',
    link: '#ffe7c7',
    tunnel: '#f1e6d8',
    rail: '#c9b8a6',
    runway: '#ece2d6',
    label: '#6b5a50',
    labelMajor: '#2b2320',
    labelHalo: '#ffffff',
    place: '#2b2320',
    boundary: '#d4b8a0',
  },
};

export const CASUAL_NIGHT: Theme = {
  night: true,
  route: '#4fe3d2',
  routeCasing: '#0b2e2b',
  routeGlow: 'rgba(79, 227, 210, 0.34)',
  passed: '#3a4566',
  alt: '#3b6f75',
  routeInk: '#0d1424',
  pulse: '#f0fffd',
  pulseGlow: '#99f6e4',
  junction: '#fb923c',
  junctionCore: '#ea580c',
  junctionCasing: '#3b1a08',
  junctionGlow: 'rgba(251, 146, 60, 0.32)',
  fork: '#6b7699',
  forkCasing: '#121829',
  pin: '#fb7185',
  map: {
    land: '#121829',
    urban: '#161d31',
    industrial: '#182036',
    park: '#13261f',
    wood: '#11281f',
    water: '#0e2340',
    waterLine: '#183660',
    building: '#1d2540',
    buildingLine: '#273152',
    minor: '#3a4566',
    minorCase: '#0b0f1c',
    major: '#5a6690',
    majorCase: '#0b0f1c',
    highway: '#d9a37a',
    highwayCase: '#3a2a24',
    link: '#b48a6c',
    tunnel: '#2a3354',
    rail: '#46507a',
    runway: '#232b48',
    label: '#c9c3d9',
    labelMajor: '#fdf3ea',
    labelHalo: '#121829',
    place: '#fff6ee',
    boundary: '#46507a',
  },
};

/** The three looks of the app, each by day and night. */
export type ThemeId = 'junction' | 'jet' | 'casual';

export const THEMES: Record<ThemeId, { label: string; day: Theme; night: Theme; bar: { day: string; night: string } }> = {
  junction: { label: 'JunctionNav', day: DAY, night: NIGHT, bar: { day: '#7c3aed', night: '#1a0d2e' } },
  jet: { label: 'Fighter jet', day: JET_DAY, night: JET_NIGHT, bar: { day: '#18241c', night: '#04100a' } },
  casual: { label: 'Casual', day: CASUAL_DAY, night: CASUAL_NIGHT, bar: { day: '#ff6b4a', night: '#232b4a' } },
};

let current: ThemeId = 'junction';

/** The look the map, the route and the rest of the app draw with from now on. */
export function setThemeId(id: ThemeId) {
  current = THEMES[id] ? id : 'junction';
}

export function themeId(): ThemeId {
  return current;
}

export function themeFor(night: boolean, id: ThemeId = current): Theme {
  const t = THEMES[id] ?? THEMES.junction;
  return night ? t.night : t.day;
}
