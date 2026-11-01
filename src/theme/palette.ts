/**
 * The app's colours in JavaScript: the map, the route line and the markers. The CSS side of the
 * same palette lives in src/styles/app.css (the --tokens), the junction views have theirs in
 * render3d.ts, zoom3d.ts and surroundRender.ts, all from the same set of hues:
 *
 *   Day   (bright cockpit): titanium #EEF2F7, carbon navy #0B1630, electric blue #0A64FF
 *   Night (dark cockpit):   cabin #070C1A, panel #0E1730, lumen cyan #2CE6FF
 *   Both: telltale amber #FFB224 for warnings, signal red #FF4D6A for danger.
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
  pin: string;
  map: MapPalette;
}

export const DAY: Theme = {
  night: false,
  route: '#0a64ff',
  routeCasing: '#0b2e7a',
  routeGlow: 'rgba(10, 100, 255, 0)',
  passed: '#9aa7b8',
  alt: '#9db0c8',
  routeInk: '#ffffff',
  pin: '#ff4d6a',
  map: {
    land: '#eef2f6',
    urban: '#e8edf3',
    industrial: '#e3e7ee',
    park: '#d3eadf',
    wood: '#c6e2d3',
    water: '#b9d8f0',
    waterLine: '#9cc6e8',
    building: '#dde3ec',
    buildingLine: '#cad3e0',
    minor: '#ffffff',
    minorCase: '#d3dbe6',
    major: '#ffffff',
    majorCase: '#b7c4d6',
    highway: '#d9e6fa',
    highwayCase: '#8fa8cf',
    link: '#e6effc',
    tunnel: '#e2e8f1',
    rail: '#a7b2c3',
    runway: '#dfe5ee',
    label: '#3b4a63',
    labelMajor: '#1e2b44',
    labelHalo: '#ffffff',
    place: '#1a2740',
    boundary: '#9aa8c0',
  },
};

export const NIGHT: Theme = {
  night: true,
  route: '#2ce6ff',
  routeCasing: '#05303f',
  routeGlow: 'rgba(44, 230, 255, 0.32)',
  passed: '#3b4a66',
  alt: '#4a5b7c',
  routeInk: '#04111f',
  pin: '#ff4d6a',
  map: {
    land: '#0a1222',
    urban: '#0c1528',
    industrial: '#0e1629',
    park: '#0b2224',
    wood: '#0a2621',
    water: '#08203e',
    waterLine: '#0e2e57',
    building: '#121c33',
    buildingLine: '#1b2847',
    minor: '#1b2742',
    minorCase: '#0a1222',
    major: '#24345a',
    majorCase: '#0a1222',
    highway: '#2d4373',
    highwayCase: '#0f2550',
    link: '#283d68',
    tunnel: '#172238',
    rail: '#2a3654',
    runway: '#18233b',
    label: '#8ea3c4',
    labelMajor: '#b9c8e2',
    labelHalo: '#0a1222',
    place: '#d2ddf0',
    boundary: '#3d4d6e',
  },
};

export function themeFor(night: boolean): Theme {
  return night ? NIGHT : DAY;
}
