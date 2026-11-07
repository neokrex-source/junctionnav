/**
 * The places around you on the map: an icon for each (the kind's pictogram on its colour), named
 * from street level, the most prominent ones first and from further out. Only what is in view is
 * handed to the map, so the map stays light however many places are on the device.
 *
 * Where the downloaded places cover the view, the base map's own points of interest are hidden
 * (they are the OpenStreetMap subset of the same places); elsewhere they stay.
 */
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import type { Feature, FeatureCollection, Point } from 'geojson';
import { GROUP_IDS, GROUPS, metres, PLACES_ATTRIBUTION, type PlaceGroup } from '../places/format';
import type { MapPlace } from '../places/placesIndex';
import { placeImage } from '../ui/placeIcons';

export interface PlacesLayerOptions {
  /** Places in view (from the places worker). */
  query: (bbox: [number, number, number, number], zoom: number, driving: boolean) => Promise<MapPlace[]>;
  /** A place's icon was tapped. */
  onPick: (id: string, lngLat: [number, number]) => void;
  /** The area the downloaded places cover, if any. */
  coverage: () => { center: [number, number]; radiusKm: number } | null;
  enabled: () => boolean;
  driving: () => boolean;
}

/** Below this zoom no places are drawn (towns and roads say enough). */
export const PLACES_MIN_ZOOM = 12;
/** At most this many places on the map at once. */
export const PLACES_LIMIT = 450;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Base-map layers that show points of interest (OpenMapTiles "poi", Protomaps "pois"). */
function basePoiLayers(m: maplibregl.Map): string[] {
  return (m.getStyle()?.layers ?? [])
    .filter((l) => l.type === 'symbol' && l.id !== 'places' && ['poi', 'pois'].includes((l as { 'source-layer'?: string })['source-layer'] ?? ''))
    .map((l) => l.id);
}

export class PlacesLayer {
  private night = false;
  private seq = 0;
  private timer = 0;
  private hidden = new Set<string>();
  private lastKey = '';

  constructor(
    private map: maplibregl.Map,
    private o: PlacesLayerOptions,
  ) {
    map.on('style.load', () => this.install());
    if (map.isStyleLoaded()) this.install();
    // The JunctionNav style's own points of interest use the same icons.
    map.on('styleimagemissing', (e: { id: string }) => {
      const g = e.id.startsWith('place-') ? (e.id.slice(6) as PlaceGroup) : null;
      if (g && GROUPS[g] && !map.hasImage(e.id)) map.addImage(e.id, placeImage(g), { pixelRatio: 2 });
    });
    map.on('moveend', () => this.refresh());
    map.on('click', 'places', (e) => {
      const f = e.features?.[0];
      const id = f?.properties?.id as string | undefined;
      if (!id || f?.geometry.type !== 'Point') return;
      this.o.onPick(id, (f.geometry as Point).coordinates as [number, number]);
    });
    map.on('mouseenter', 'places', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'places', () => (map.getCanvas().style.cursor = ''));
  }

  private install() {
    const m = this.map;
    this.hidden.clear();
    this.lastKey = '';
    for (const g of GROUP_IDS) if (!m.hasImage(`place-${g}`)) m.addImage(`place-${g}`, placeImage(g), { pixelRatio: 2 });
    if (m.getSource('places')) return;
    m.addSource('places', { type: 'geojson', data: EMPTY, attribution: PLACES_ATTRIBUTION });
    // Names need the style's fonts: a style without them (the simple raster map) gets icons only.
    const named = !!m.getStyle()?.glyphs;
    const layout: maplibregl.SymbolLayerSpecification['layout'] = {
      'icon-image': ['concat', 'place-', ['get', 'g']],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 15, 0.85, 18, 1],
      'icon-allow-overlap': false,
      'symbol-sort-key': ['-', 100, ['get', 'r']],
    };
    if (named) {
      Object.assign(layout, {
        // Prominent places named a little further out, all of them at street level.
        'text-field': ['step', ['zoom'], ['case', ['>=', ['get', 'r'], 70], ['get', 'n'], ''], 15.5, ['case', ['>=', ['get', 'r'], 40], ['get', 'n'], ''], 16.5, ['get', 'n']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10.5, 18, 12.5],
        'text-anchor': 'top',
        'text-offset': [0, 0.85],
        'text-max-width': 8,
        'text-optional': true,
        'text-padding': 2,
      });
    }
    // Under the route line, so the way stays clear.
    const before = ['route-alt', 'traffic-lines'].find((id) => m.getLayer(id));
    m.addLayer(
      {
        id: 'places',
        type: 'symbol',
        source: 'places',
        minzoom: PLACES_MIN_ZOOM,
        layout,
        paint: named ? { 'text-color': ['get', 'tc'], 'text-halo-color': this.night ? '#14101c' : '#ffffff', 'text-halo-width': 1.4, 'text-halo-blur': 0.3 } : {},
      },
      before,
    );
    this.refresh(0);
  }

  /** Day or night text colours. */
  setNight(night: boolean) {
    if (night === this.night) return;
    this.night = night;
    if (this.map.getLayer('places')) this.map.setPaintProperty('places', 'text-halo-color', night ? '#14101c' : '#ffffff');
    this.lastKey = '';
    this.refresh(0);
  }

  /** Redraws what is in view (after a move, an update of the places, or a setting change). */
  refresh(delay = 180) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.draw(), delay);
  }

  private async draw() {
    const m = this.map;
    const src = m.getSource('places') as GeoJSONSource | undefined;
    if (!src) return;
    const on = this.o.enabled();
    const z = m.getZoom();
    const c = m.getCenter();
    const cov = on ? this.o.coverage() : null;
    this.syncBase(!!cov && metres(cov.center, [c.lng, c.lat]) < cov.radiusKm * 1000 - 2000);
    if (!on || !cov || z < PLACES_MIN_ZOOM) {
      if (this.lastKey !== 'empty') src.setData(EMPTY);
      this.lastKey = 'empty';
      return;
    }
    const b = m.getBounds();
    // A little beyond the edges, so icons do not pop in at the sides while panning.
    const padX = (b.getEast() - b.getWest()) * 0.15;
    const padY = (b.getNorth() - b.getSouth()) * 0.15;
    const bbox: [number, number, number, number] = [b.getWest() - padX, b.getSouth() - padY, b.getEast() + padX, b.getNorth() + padY];
    const driving = this.o.driving();
    const seq = ++this.seq;
    let list: MapPlace[];
    try {
      list = await this.o.query(bbox, z, driving);
    } catch {
      return;
    }
    if (seq !== this.seq || !m.getSource('places')) return;
    const key = `${list.length}|${list[0]?.[0] ?? ''}|${list[list.length - 1]?.[0] ?? ''}|${this.night}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const features: Feature<Point>[] = list.map(([id, lon, lat, n, g, r]) => ({
      type: 'Feature',
      properties: { id, n, g, r, tc: this.textColor(g) },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    }));
    (m.getSource('places') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }

  /** Names in a darker shade of the kind's colour by day, a lighter one by night. */
  private textColor(g: PlaceGroup): string {
    const hex = GROUPS[g]?.color ?? '#555555';
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const mix = this.night ? ch.map((v) => Math.round(v + (255 - v) * 0.55)) : ch.map((v) => Math.round(v * 0.72));
    return `rgb(${mix.join(',')})`;
  }

  /** Hides the base map's own points of interest where the downloaded places take over. */
  private syncBase(covered: boolean) {
    const m = this.map;
    for (const id of basePoiLayers(m)) {
      const want = covered ? 'none' : 'visible';
      const now = m.getLayoutProperty(id, 'visibility') ?? 'visible';
      if (covered && now !== 'none') {
        m.setLayoutProperty(id, 'visibility', 'none');
        this.hidden.add(id);
      } else if (!covered && this.hidden.has(id) && now !== want) {
        m.setLayoutProperty(id, 'visibility', 'visible');
        this.hidden.delete(id);
      }
    }
  }
}
