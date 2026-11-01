/**
 * The app's colours in JavaScript: the map, the route line and the markers. The CSS side of the
 * same palette lives in src/styles/app.css (the --tokens), the junction views have theirs in
 * render3d.ts, zoom3d.ts and surroundRender.ts, all from the same set of hues:
 *
 *   Day   (light purple): light grey #F2F0F6, white, black #121016, violet #7C3AED
 *   Night (dark purple):  near-black #0B0910, plum #1A0D2E, white, lilac #B77BFF
 *   Both: amber for warnings, rose for danger, green for confirmations.
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
    minor: '#231b33',
    minorCase: '#0d0a14',
    major: '#2e2443',
    majorCase: '#0d0a14',
    highway: '#3c2b60',
    highwayCase: '#1d1235',
    link: '#35285a',
    tunnel: '#1d1729',
    rail: '#2f2640',
    runway: '#1c1628',
    label: '#a99fbf',
    labelMajor: '#d6cee4',
    labelHalo: '#0d0a14',
    place: '#f1ecf8',
    boundary: '#4a3d63',
  },
};

export function themeFor(night: boolean): Theme {
  return night ? NIGHT : DAY;
}
