/**
 * Registered places on the map: yours (a violet ring) and everyone's public ones (a teal ring),
 * each with its kind's icon and its name, above the other places so a corrected place shows.
 */
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import type { Feature, FeatureCollection, Point } from 'geojson';
import { GROUP_IDS, GROUPS, type PlaceGroup } from '../places/format';
import { placeImage } from '../ui/placeIcons';

export interface CommunityMark {
  id: string;
  lngLat: [number, number];
  name: string;
  group: PlaceGroup;
  own: boolean;
}

export interface CommunityLayerOptions {
  /** The registered places in a box (west, south, east, north). */
  list: (bbox: [number, number, number, number], zoom: number) => CommunityMark[];
  /** The map has moved: fetch the public places for the view. */
  moved: (bbox: [number, number, number, number], zoom: number) => void;
  onPick: (id: string, own: boolean) => void;
  enabled: () => boolean;
}

/** Your own places show from this zoom, everyone else's from the next. */
export const OWN_MIN_ZOOM = 8;
export const PUBLIC_MIN_ZOOM = 11;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const OWN = '#7c3aed';
const PUBLIC = '#0d9488';

export class CommunityLayer {
  private night = false;
  private timer = 0;

  constructor(
    private map: maplibregl.Map,
    private o: CommunityLayerOptions,
  ) {
    map.on('style.load', () => this.install());
    if (map.isStyleLoaded()) this.install();
    map.on('moveend', () => {
      this.refresh();
      const z = map.getZoom();
      if (z >= PUBLIC_MIN_ZOOM && this.o.enabled()) this.o.moved(this.bbox(), z);
    });
    for (const layer of ['community', 'community-ring']) {
      map.on('click', layer, (e) => {
        const f = e.features?.[0];
        const id = f?.properties?.id as string | undefined;
        if (id) this.o.onPick(id, !!f?.properties?.own);
      });
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
  }

  private bbox(): [number, number, number, number] {
    const b = this.map.getBounds();
    const padX = (b.getEast() - b.getWest()) * 0.15;
    const padY = (b.getNorth() - b.getSouth()) * 0.15;
    return [b.getWest() - padX, b.getSouth() - padY, b.getEast() + padX, b.getNorth() + padY];
  }

  private install() {
    const m = this.map;
    for (const g of GROUP_IDS) if (!m.hasImage(`place-${g}`)) m.addImage(`place-${g}`, placeImage(g), { pixelRatio: 2 });
    if (m.getSource('community')) return;
    m.addSource('community', { type: 'geojson', data: EMPTY });
    const named = !!m.getStyle()?.glyphs;
    // Under the route line, above the other places.
    const before = ['route-alt', 'traffic-lines'].find((id) => m.getLayer(id));
    m.addLayer(
      {
        id: 'community-ring',
        type: 'circle',
        source: 'community',
        minzoom: OWN_MIN_ZOOM,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 9, 15, 14, 18, 16],
          'circle-color': this.night ? '#14101c' : '#ffffff',
          'circle-stroke-width': 3,
          'circle-stroke-color': ['case', ['get', 'own'], OWN, PUBLIC],
        },
      },
      before,
    );
    const layout: maplibregl.SymbolLayerSpecification['layout'] = {
      'icon-image': ['concat', 'place-', ['get', 'g']],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 15, 0.85, 18, 1],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    };
    if (named)
      Object.assign(layout, {
        'text-field': ['step', ['zoom'], ['case', ['get', 'own'], ['get', 'n'], ''], 13, ['get', 'n']],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 18, 13],
        'text-anchor': 'top',
        'text-offset': [0, 1.15],
        'text-max-width': 9,
        'text-optional': true,
      });
    m.addLayer(
      {
        id: 'community',
        type: 'symbol',
        source: 'community',
        minzoom: OWN_MIN_ZOOM,
        layout,
        paint: named ? { 'text-color': ['case', ['get', 'own'], this.night ? '#c4b5fd' : '#5b21b6', this.night ? '#5eead4' : '#0f766e'], 'text-halo-color': this.night ? '#14101c' : '#ffffff', 'text-halo-width': 1.5 } : {},
      },
      before,
    );
    this.refresh(0);
    // The public places for where the map already is (later ones come with each move).
    if (m.getZoom() >= PUBLIC_MIN_ZOOM && this.o.enabled()) this.o.moved(this.bbox(), m.getZoom());
  }

  setNight(night: boolean) {
    if (night === this.night) return;
    this.night = night;
    const m = this.map;
    if (m.getLayer('community-ring')) m.setPaintProperty('community-ring', 'circle-color', night ? '#14101c' : '#ffffff');
    if (m.getLayer('community') && m.getPaintProperty('community', 'text-halo-color') != null) {
      m.setPaintProperty('community', 'text-halo-color', night ? '#14101c' : '#ffffff');
      m.setPaintProperty('community', 'text-color', ['case', ['get', 'own'], night ? '#c4b5fd' : '#5b21b6', night ? '#5eead4' : '#0f766e']);
    }
  }

  refresh(delay = 120) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.draw(), delay);
  }

  private draw() {
    const m = this.map;
    const src = m.getSource('community') as GeoJSONSource | undefined;
    if (!src) return;
    const z = m.getZoom();
    if (!this.o.enabled() || z < OWN_MIN_ZOOM) return src.setData(EMPTY);
    const marks = this.o.list(this.bbox(), z).filter((p) => p.own || z >= PUBLIC_MIN_ZOOM);
    const features: Feature<Point>[] = marks.map((p) => ({
      type: 'Feature',
      properties: { id: p.id, n: p.name, g: GROUPS[p.group] ? p.group : 'other', own: p.own },
      geometry: { type: 'Point', coordinates: p.lngLat },
    }));
    src.setData({ type: 'FeatureCollection', features });
  }
}
