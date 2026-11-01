/**
 * Binary layout of the offline road graph (graph.bin). Shared by the pack builder (Node, run
 * on GitHub Actions) and the app, so it must not import anything.
 *
 * File: magic u32 | version u32 | header length u32 | header JSON | sections, each 4-byte aligned.
 * Coordinates are microdegrees (int32). A "segment" is a stretch of one OSM way between two
 * routing vertices (junctions or way ends); its shape points lie in between.
 */

export const GRAPH_MAGIC = 0x31474e4a; // "JNG1"
export const GRAPH_VERSION = 1;
export const PLACES_MAGIC = 0x31504e4a; // "JNP1"

export interface GraphHeader {
  nV: number;
  nS: number;
  nAdj: number;
  nShape: number;
  nWays: number;
  nRestr: number;
  nJunc: number;
  nStr: number;
  strBytes: number;
  cell: { size: number; lonMin: number; latMin: number; nx: number; ny: number; nCells: number; nCellSegs: number };
  bbox: [number, number, number, number];
  drivingSide: 'left' | 'right';
  built: string;
  source: string;
}

export type SectionKind = 'i32' | 'u32' | 'f32' | 'u16' | 'u8';

/** Sections in file order: name, element type, element count. */
export function graphSections(h: GraphHeader): [string, SectionKind, number][] {
  return [
    ['vLat', 'i32', h.nV],
    ['vLon', 'i32', h.nV],
    ['segA', 'u32', h.nS],
    ['segB', 'u32', h.nS],
    ['segLen', 'f32', h.nS],
    ['segWay', 'u32', h.nS],
    ['segShape', 'u32', h.nS + 1],
    ['segDir', 'u8', h.nS],
    ['adjStart', 'u32', h.nV + 1],
    ['adj', 'u32', h.nAdj],
    ['shapeLat', 'i32', h.nShape],
    ['shapeLon', 'i32', h.nShape],
    ['wayClass', 'u8', h.nWays],
    ['waySpeed', 'u8', h.nWays],
    ['wayFlags', 'u16', h.nWays],
    ['wayTags', 'u32', h.nWays],
    ['rVia', 'u32', h.nRestr],
    ['rFrom', 'u32', h.nRestr],
    ['rTo', 'u32', h.nRestr],
    ['rType', 'u8', h.nRestr],
    ['jV', 'u32', h.nJunc],
    ['jRef', 'u32', h.nJunc],
    ['jName', 'u32', h.nJunc],
    ['cellKey', 'u32', h.cell.nCells],
    ['cellStart', 'u32', h.cell.nCells + 1],
    ['cellSegs', 'u32', h.cell.nCellSegs],
    ['strOff', 'u32', h.nStr + 1],
    ['strBytes', 'u8', h.strBytes],
  ];
}

export const KIND_BYTES: Record<SectionKind, number> = { i32: 4, u32: 4, f32: 4, u16: 2, u8: 1 };

/** Byte offset of each section, given where the sections start. */
export function sectionOffsets(h: GraphHeader, start: number): Record<string, { offset: number; kind: SectionKind; length: number }> {
  const out: Record<string, { offset: number; kind: SectionKind; length: number }> = {};
  let off = align4(start);
  for (const [name, kind, length] of graphSections(h)) {
    out[name] = { offset: off, kind, length };
    off = align4(off + length * KIND_BYTES[kind]);
  }
  out.__end = { offset: off, kind: 'u8', length: 0 };
  return out;
}

export function align4(n: number): number {
  return (n + 3) & ~3;
}

/** Road classes (wayClass). */
export const CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'road'] as const;

/** wayFlags bits. */
export const F_ONEWAY = 1;
export const F_ONEWAY_REV = 2;
export const F_ROUNDABOUT = 4;
export const F_LINK = 8;
export const F_TOLL = 16;
export const F_TUNNEL = 32;
export const F_BRIDGE = 64;

/** segDir bits. */
export const D_FWD = 1;
export const D_BWD = 2;

/** rType values. */
export const R_NO = 0;
export const R_ONLY = 1;

/** Tag string separator inside wayTags strings ("highway=primary\x1fname=Jalan Ampang"). */
export const TAG_SEP = '\x1f';

/** OSM tags kept for maneuvers, signs and junction views. */
export const KEPT_TAGS = [
  'highway',
  'name',
  'name:en',
  'ref',
  'oneway',
  'junction',
  'lanes',
  'lanes:forward',
  'lanes:backward',
  'turn:lanes',
  'turn:lanes:forward',
  'turn:lanes:backward',
  'destination',
  'destination:forward',
  'destination:backward',
  'destination:ref',
  'destination:ref:forward',
  'destination:ref:backward',
  'layer',
  'bridge',
  'tunnel',
  'tunnel:name',
  'tunnel:name:en',
  'covered',
  'toll',
  'maxspeed',
  // Headroom under bridges, for the junction view's deck heights.
  'maxheight',
  'maxheight:physical',
];

export function parseTags(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  for (const kv of s.split(TAG_SEP)) {
    const i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
}

export interface PackManifest {
  id: string;
  name: string;
  version: string;
  built: string;
  bbox: [number, number, number, number];
  drivingSide: 'left' | 'right';
  /** Map data credits shown in the app. */
  attribution: string;
  files: { name: string; size: number; parts: { path: string; size: number }[]; gzip?: boolean }[];
}
