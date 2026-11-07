/**
 * The app's colours in JavaScript: the map, the route line and the markers. The CSS side of the
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

export function themeFor(night: boolean): Theme {
  return night ? NIGHT : DAY;
}
