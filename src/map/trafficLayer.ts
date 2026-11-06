/**
 * Live traffic on the main map (TomTom): congestion colours over the roads under the route, the
 * incidents as coloured lines with an icon each, and on the route itself a coloured edge along
 * the stretches that are slow or closed, so the route keeps its own colours (orange through
 * junctions) and the traffic shows beside it. Tapping an icon shows what it is.
 *
 * The layers live in sources named traffic-*, which the map's own tile watchdog leaves out: a
 * traffic tile that fails says nothing about the map.
 */
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import type { Route } from '../routing/types';
import type { Incident, IncidentKind, Magnitude, RouteIncident } from '../traffic/types';

export const TRAFFIC_ATTRIBUTION = '<a href="https://www.tomtom.com" target="_blank" rel="noopener">© TomTom</a>';

/** Slow (yellow), slower (red), standing (dark red): kept apart from the route's blue and junction orange. */
export const MAGNITUDE_COLOR: Record<Magnitude, string> = {
  unknown: '#a3a3a3',
  minor: '#eab308',
  moderate: '#ef4444',
  major: '#991b1b',
  undefined: '#a3a3a3',
};
const CLOSED = '#7f1d1d';

export function incidentColor(i: Pick<Incident, 'kind' | 'magnitude'>): string {
  if (i.kind === 'closure') return CLOSED;
  if (i.magnitude === 'unknown' || i.magnitude === 'undefined') return i.kind === 'accident' ? MAGNITUDE_COLOR.moderate : MAGNITUDE_COLOR.minor;
  return MAGNITUDE_COLOR[i.magnitude];
}

/** Icon colour by what happened. */
const ICON_BG: Record<IncidentKind, string> = {
  accident: '#dc2626',
  jam: '#ea580c',
  closure: '#7f1d1d',
  laneClosed: '#d97706',
  roadworks: '#d97706',
  flooding: '#2563eb',
  weather: '#475569',
  hazard: '#ca8a04',
  breakdown: '#d97706',
  other: '#64748b',
};

const KINDS = Object.keys(ICON_BG) as IncidentKind[];

/** A round badge with a white sign for each kind of incident, drawn once per map. */
function iconImage(kind: IncidentKind): ImageData {
  const S = 56;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  const m = S / 2;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(m, m, 26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ICON_BG[kind];
  g.beginPath();
  g.arc(m, m, 22, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 4;
  const bang = () => {
    g.beginPath();
    g.moveTo(m, m - 11);
    g.lineTo(m, m + 3);
    g.stroke();
    g.beginPath();
    g.arc(m, m + 10, 2.6, 0, Math.PI * 2);
    g.fill();
  };
  switch (kind) {
    case 'accident': {
      // Two cars meeting.
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(m - 13, m + 7);
      g.lineTo(m - 3, m - 5);
      g.moveTo(m + 13, m + 7);
      g.lineTo(m + 3, m - 5);
      g.stroke();
      g.beginPath();
      g.moveTo(m, m - 12);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
        const r = k % 2 ? 3 : 7;
        g.lineTo(m + Math.cos(a) * r, m - 6 + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      break;
    }
    case 'jam':
      // Cars queuing.
      for (const dy of [-8, 0, 8]) {
        g.beginPath();
        g.moveTo(m - 11, m + dy);
        g.lineTo(m + 11, m + dy);
        g.stroke();
      }
      break;
    case 'closure':
      g.fillRect(m - 13, m - 3.5, 26, 7);
      break;
    case 'laneClosed':
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(m - 6, m - 12);
      g.lineTo(m - 6, m + 12);
      g.moveTo(m + 6, m - 12);
      g.lineTo(m + 6, m + 12);
      g.stroke();
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(m + 1, m - 5);
      g.lineTo(m + 11, m + 5);
      g.moveTo(m + 11, m - 5);
      g.lineTo(m + 1, m + 5);
      g.stroke();
      break;
    case 'roadworks':
      // A cone.
      g.beginPath();
      g.moveTo(m, m - 13);
      g.lineTo(m + 9, m + 9);
      g.lineTo(m - 9, m + 9);
      g.closePath();
      g.fill();
      g.fillRect(m - 13, m + 9, 26, 4);
      g.fillStyle = ICON_BG.roadworks;
      g.fillRect(m - 6, m - 1, 12, 3.5);
      break;
    case 'flooding':
      g.lineWidth = 3.5;
      for (const dy of [-6, 4]) {
        g.beginPath();
        for (let x = -12; x <= 12; x += 1) {
          const y = m + dy + Math.sin((x / 12) * Math.PI * 2) * 3;
          if (x === -12) g.moveTo(m + x, y);
          else g.lineTo(m + x, y);
        }
        g.stroke();
      }
      break;
    case 'weather':
      g.beginPath();
      g.arc(m - 5, m + 1, 7, 0, Math.PI * 2);
      g.arc(m + 4, m - 3, 9, 0, Math.PI * 2);
      g.arc(m + 9, m + 4, 6, 0, Math.PI * 2);
      g.fill();
      g.fillRect(m - 10, m + 2, 21, 8);
      break;
    case 'other':
      g.beginPath();
      g.arc(m, m - 10, 2.8, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(m, m - 3);
      g.lineTo(m, m + 12);
      g.stroke();
      break;
    default:
      bang();
  }
  return g.getImageData(0, 0, S, S);
}

export interface TrafficLayerOptions {
  /** What an incident is, for the popup when its icon is tapped. */
  describe: (i: Incident) => HTMLElement;
}

export class TrafficLayer {
  private flowUrl: string | null = null;
  private all: Incident[] = [];
  private onRoute: RouteIncident[] = [];
  private route: Route | null = null;
  private popup: maplibregl.Popup | null = null;
  /** Flow tiles that arrived and failed since the address last changed. */
  private flowOk = 0;
  private flowErr = 0;
  /** The flow tiles keep failing for this address. */
  onFlowFailing: (() => void) | null = null;

  constructor(
    private map: maplibregl.Map,
    private o: TrafficLayerOptions,
  ) {
    map.on('style.load', () => this.install());
    if (map.isStyleLoaded()) this.install();
    map.on('error', (e) => {
      const ev = e as { sourceId?: string; error?: { status?: number } };
      if (ev.sourceId !== 'traffic-flow') return;
      this.flowErr++;
      if (this.flowOk === 0 && this.flowErr >= 3) {
        this.flowErr = -1000;
        this.onFlowFailing?.();
      }
    });
    map.on('data', (e) => {
      const d = e as { sourceId?: string; tile?: { state?: string } };
      if (d.sourceId === 'traffic-flow' && d.tile?.state === 'loaded') this.flowOk++;
    });
    map.on('click', 'traffic-icons', (e) => {
      const id = e.features?.[0]?.properties?.id;
      const inc = this.all.find((i) => i.id === id) ?? this.onRoute.find((i) => i.id === id);
      if (!inc) return;
      this.popup?.remove();
      this.popup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px', className: 'traffic-pop' }).setLngLat(e.lngLat).setDOMContent(this.o.describe(inc)).addTo(map);
    });
    map.on('mouseenter', 'traffic-icons', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'traffic-icons', () => (map.getCanvas().style.cursor = ''));
  }

  /** Congestion tiles (a TomTom tile address), or null for none. */
  setFlow(url: string | null) {
    if (url === this.flowUrl) return;
    this.flowUrl = url;
    this.flowOk = 0;
    this.flowErr = 0;
    const m = this.map;
    if (!m.getStyle()) return;
    try {
      if (m.getLayer('traffic-flow')) m.removeLayer('traffic-flow');
      if (m.getSource('traffic-flow')) m.removeSource('traffic-flow');
      if (url) this.addFlow();
    } catch {
      /* the style is still loading: it gets the layer when it is done */
    }
  }

  /** All incidents in view, those on the route being driven (with where they are along it), and that route. */
  setIncidents(all: Incident[], onRoute: RouteIncident[], route: Route | null) {
    this.all = all;
    this.onRoute = onRoute;
    this.route = route;
    if (!all.length && !onRoute.length) this.popup?.remove();
    (this.map.getSource('traffic-inc') as GeoJSONSource | undefined)?.setData(this.linesFC());
    (this.map.getSource('traffic-route') as GeoJSONSource | undefined)?.setData(this.routeFC());
    (this.map.getSource('traffic-pts') as GeoJSONSource | undefined)?.setData(this.iconsFC());
  }

  private before(...ids: string[]): string | undefined {
    for (const id of ids) if (this.map.getLayer(id)) return id;
    return this.map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id;
  }

  private addFlow() {
    const m = this.map;
    if (!this.flowUrl || m.getSource('traffic-flow')) return;
    m.addSource('traffic-flow', { type: 'raster', tiles: [this.flowUrl], tileSize: 256, minzoom: 6, maxzoom: 18, attribution: TRAFFIC_ATTRIBUTION });
    m.addLayer({ id: 'traffic-flow', type: 'raster', source: 'traffic-flow', paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0 } }, this.before('traffic-lines', 'route-alt'));
  }

  private install() {
    const m = this.map;
    if (m.getSource('traffic-inc')) return;
    for (const k of KINDS) if (!m.hasImage(`tr-${k}`)) m.addImage(`tr-${k}`, iconImage(k), { pixelRatio: 2 });
    m.addSource('traffic-inc', { type: 'geojson', data: this.linesFC(), attribution: TRAFFIC_ATTRIBUTION });
    m.addSource('traffic-route', { type: 'geojson', data: this.routeFC() });
    m.addSource('traffic-pts', { type: 'geojson', data: this.iconsFC() });
    // Incidents off the route: a coloured line along the road, under the route.
    const lineWidth: maplibregl.ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 5, 18, 9];
    m.addLayer(
      {
        id: 'traffic-lines',
        type: 'line',
        source: 'traffic-inc',
        filter: ['!', ['get', 'closed']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': lineWidth, 'line-opacity': 0.9 },
      },
      this.before('route-alt'),
    );
    // Closed roads: dashed.
    m.addLayer(
      {
        id: 'traffic-closed',
        type: 'line',
        source: 'traffic-inc',
        filter: ['get', 'closed'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': lineWidth, 'line-dasharray': [1.2, 0.8] },
      },
      this.before('route-alt'),
    );
    // On the route: a wide coloured edge under the route's own line, so it frames the stretch.
    m.addLayer(
      {
        id: 'traffic-route',
        type: 'line',
        source: 'traffic-route',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 12, 14, 18, 18, 30],
          'line-opacity': 0.95,
        },
      },
      this.before('route-glow', 'route-casing'),
    );
    m.addLayer({
      id: 'traffic-icons',
      type: 'symbol',
      source: 'traffic-pts',
      minzoom: 8,
      layout: {
        'icon-image': ['concat', 'tr-', ['get', 'kind']],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 13, 0.85, 17, 1],
        'icon-allow-overlap': true,
        'icon-padding': 2,
        'symbol-sort-key': ['get', 'rank'],
      },
    });
    this.addFlow();
  }

  private linesFC(): FeatureCollection {
    const on = new Set(this.onRoute.map((i) => i.id));
    const features: Feature[] = [];
    for (const i of this.all) {
      if (on.has(i.id) || i.geometry.length < 2) continue;
      features.push({ type: 'Feature', properties: { id: i.id, color: incidentColor(i), closed: i.kind === 'closure' }, geometry: { type: 'LineString', coordinates: i.geometry } });
    }
    return { type: 'FeatureCollection', features };
  }

  private routeFC(): FeatureCollection {
    const r = this.route;
    if (!r) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: this.onRoute.map((i) => ({
        type: 'Feature' as const,
        properties: { id: i.id, color: incidentColor(i) },
        geometry: { type: 'LineString' as const, coordinates: r.line.slice(i.s, Math.max(i.endS, i.s + 30)) },
      })),
    };
  }

  private iconsFC(): FeatureCollection {
    const on = new Map(this.onRoute.map((i) => [i.id, i]));
    const features: Feature[] = [];
    const seen = new Set<string>();
    const add = (i: Incident, at: [number, number], rank: number) => {
      if (seen.has(i.id)) return;
      seen.add(i.id);
      features.push({ type: 'Feature', properties: { id: i.id, kind: i.kind, rank }, geometry: { type: 'Point', coordinates: at } });
    };
    // Icons on the route are drawn on top (higher sort key), at where the trouble starts.
    for (const i of this.onRoute) if (this.route) add(i, this.route.line.pointAt(i.s), 3);
    for (const i of this.all) if (!on.has(i.id)) add(i, i.geometry[0], i.kind === 'closure' || i.kind === 'accident' ? 2 : 1);
    return { type: 'FeatureCollection', features };
  }
}
