'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CloudOff, Loader2 } from 'lucide-react';
import { useMeteoFarmWeather } from '@strawboss/api';
import type { MeteoFarmCell, MeteoFarmLayer, MeteoOverviewRow, MeteoRiskLevel } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { STATUS_STYLES } from './format';
import { WeatherIcon } from './weather-icons';
import { useNowMs, useWeatherFormat } from './weather-format';
import {
  FARM_LAYERS,
  LAYER_UNIT,
  NO_DATA_COLOR,
  RISK_COLORS,
  RISK_ORDER,
  SCALES,
  scaleColor,
} from './farm-scales';

// Default map center: Deta, Timiș (matches MeteoMap / LeafletMap).
const DETA_CENTER: [number, number] = [45.3883, 21.2311];
const DEFAULT_ZOOM = 11;

interface FarmWeatherMapProps {
  /** Overview rows (parcels with a drying clock) — feed the "drying" layer. */
  rows: MeteoOverviewRow[];
  onSelect?: (parcelId: string) => void;
}

/**
 * Farm-wide weather map: every parcel painted by the selected layer, one weather
 * icon per 0.05° cell. Cloned from `MeteoMap` (no draw tools). Load with
 * `dynamic(..., { ssr: false })` inside a `relative isolate` box with a height.
 * Parcel names go through DOM text nodes, never HTML strings; the only HTML
 * handed to Leaflet is the static SVG of a lucide icon.
 */
export function FarmWeatherMap({ rows, onSelect }: FarmWeatherMapProps) {
  const { t } = useI18n();
  const f = useWeatherFormat();
  const now = useNowMs();
  const farm = useMeteoFarmWeather(apiClient);
  const [layer, setLayer] = useState<MeteoFarmLayer>('rain24h');

  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerRef = useRef<any>(null);
  const fittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  const data = farm.data;
  const cellsByKey = useMemo(() => new Map((data?.cells ?? []).map((c) => [c.key, c])), [data]);
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.parcelId, r])), [rows]);

  // Value + colour + label for one parcel under the current layer.
  const paint = useRef<(parcelId: string, cellKey: string) => { color: string; text: string }>(() => ({
    color: NO_DATA_COLOR,
    text: '—',
  }));
  useEffect(() => {
    const riskText = (r: MeteoRiskLevel) => t(`meteo.agro.risk.${r}`);
    paint.current = (parcelId, cellKey) => {
      if (layer === 'drying') {
        const row = rowsById.get(parcelId);
        return row
          ? { color: STATUS_STYLES[row.status].hex, text: t(`meteo.status.${row.status}`) }
          : { color: NO_DATA_COLOR, text: t('meteo.wx.farm.noClock') };
      }
      const cell = cellsByKey.get(cellKey);
      if (!cell) return { color: NO_DATA_COLOR, text: '—' };
      if (layer === 'frost') return { color: RISK_COLORS[cell.frost], text: riskText(cell.frost) };
      if (layer === 'storm') return { color: RISK_COLORS[cell.storm], text: riskText(cell.storm) };
      const v = layer === 'rain24h' ? cell.rain24hMm : layer === 'tempNow' ? cell.tempNowC : cell.gustMax24hMs;
      return {
        color: scaleColor(layer, v),
        text: v === null ? '—' : `${f.n1.format(v)} ${LAYER_UNIT[layer]}`,
      };
    };
  }, [layer, rowsById, cellsByKey, f, t]);

  // ── 1. Initialise map (client-only dynamic import) ──────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    let isMounted = true;

    const init = async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (!isMounted || mapInstanceRef.current || !mapRef.current) return;

      const map = L.map(mapRef.current, {
        zoom: DEFAULT_ZOOM,
        center: DETA_CENTER,
        minZoom: 5,
        maxZoom: 20,
        zoomSnap: 0.5,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 120,
      });
      requestAnimationFrame(() => map.invalidateSize());

      const placeLabelsPane = map.createPane('placeLabels');
      placeLabelsPane.style.zIndex = '550';
      placeLabelsPane.style.pointerEvents = 'none';

      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxNativeZoom: 18,
          maxZoom: 20,
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, USGS, AEX, GeoEye, Getmapping, IGN',
        },
      ).addTo(map);
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { pane: 'placeLabels', maxNativeZoom: 18, maxZoom: 20 },
      ).addTo(map);

      mapInstanceRef.current = map;
      setMapReady(true);
    };
    void init();

    return () => {
      isMounted = false;
      setMapReady(false);
      fittedRef.current = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // ── 2. Re-measure when the container box changes ────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    const el = mapRef.current;
    if (!map || !mapReady || !el) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mapReady]);

  // ── 3. Draw parcels + cell icons whenever data or the layer change ──────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !data) return;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    let cancelled = false;
    const render = async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapInstanceRef.current) return;

      const group = L.featureGroup();

      for (const p of data.parcels) {
        const { color, text } = paint.current(p.parcelId, p.cellKey);
        const label = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = p.name ?? p.code ?? '';
        const val = document.createElement('div');
        val.textContent = text;
        label.append(name, val);
        try {
          const shape = p.boundary
            ? L.geoJSON(p.boundary as GeoJSON.GeoJsonObject, {
                style: { color, weight: 2, fillColor: color, fillOpacity: 0.5 },
              })
            : L.circleMarker([p.lat, p.lon], { radius: 7, color, fillColor: color, fillOpacity: 0.7, weight: 2 });
          shape.bindTooltip(label, { sticky: true });
          shape.on('click', () => onSelectRef.current?.(p.parcelId));
          shape.addTo(group);
        } catch {
          // A malformed geometry must not blank the whole map.
        }
      }

      for (const c of data.cells) {
        group.addLayer(L.marker([c.lat, c.lon], { icon: cellIcon(L, c, layer, f.n0), interactive: false, keyboard: false }));
      }

      group.addTo(mapInstanceRef.current);
      layerRef.current = group;
      if (!fittedRef.current) {
        const bounds = group.getBounds();
        if (bounds.isValid()) {
          mapInstanceRef.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
          fittedRef.current = true;
        }
      }
    };
    void render();

    return () => {
      cancelled = true;
    };
  }, [data, layer, mapReady, cellsByKey, rowsById, f, t]);

  // ── Legend ───────────────────────────────────────────────────────────────
  const legend: { color: string; label: string }[] =
    layer === 'rain24h' || layer === 'tempNow' || layer === 'gust24h'
      ? SCALES[layer].map((b) => ({ color: b.color, label: b.label }))
      : layer === 'drying'
        ? (['green', 'yellow', 'red', 'grey'] as const).map((s) => ({
            color: STATUS_STYLES[s].hex,
            label: t(`meteo.status.${s}`),
          }))
        : RISK_ORDER.map((r) => ({ color: RISK_COLORS[r], label: t(`meteo.agro.risk.${r}`) }));

  return (
    <div className="relative h-full w-full">
      <div ref={mapRef} className="h-full w-full" />

      {/* Layer switcher — overlays stay inside the isolated wrapper (z-[1000]). */}
      <div className="absolute right-3 top-3 z-[1000] flex max-w-[calc(100%-5rem)] flex-wrap justify-end gap-1 rounded-2xl bg-white/90 p-1.5 shadow-lg backdrop-blur">
        {FARM_LAYERS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLayer(l)}
            aria-pressed={layer === l}
            className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
              layer === l ? 'bg-primary text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            {t(`meteo.wx.farm.layer.${l}`)}
          </button>
        ))}
      </div>

      <div className="absolute bottom-6 left-3 z-[1000] rounded-2xl bg-white/90 p-3 shadow-lg backdrop-blur">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          {t(`meteo.wx.farm.layer.${layer}`)}
          {layer in LAYER_UNIT && (
            <span className="ml-1 font-normal normal-case text-neutral-400">
              ({LAYER_UNIT[layer as keyof typeof LAYER_UNIT]})
            </span>
          )}
        </p>
        <ul className="space-y-0.5">
          {legend.map((e) => (
            <li key={e.label} className="flex items-center gap-2 text-[11px] text-neutral-600">
              <span className="h-3 w-5 rounded-sm border border-black/10" style={{ backgroundColor: e.color }} />
              {e.label}
            </li>
          ))}
        </ul>
        {data && layer !== 'drying' && (
          <p className="mt-2 border-t border-neutral-200 pt-1.5 text-[10px] text-neutral-400">
            {t('meteo.wx.updated')}: {f.ago(data.fetchedAt, now)}
            {data.stale && <span className="ml-1 font-medium text-amber-600">· {t('meteo.wx.stale')}</span>}
          </p>
        )}
      </div>

      {data && (data.dropped.cells > 0 || data.dropped.parcels > 0) && (
        <div className="absolute bottom-6 right-3 z-[1000] max-w-xs rounded-xl bg-amber-50/95 px-3 py-2 text-[11px] text-amber-800 shadow-lg">
          {t('meteo.wx.farm.dropped', { cells: data.dropped.cells, parcels: data.dropped.parcels })}
        </div>
      )}

      {(farm.isLoading || farm.isError || (data && data.parcels.length === 0)) && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm text-neutral-600 shadow-lg">
            {farm.isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('common.loading')}
              </>
            ) : farm.isError ? (
              <>
                <CloudOff className="h-4 w-4 text-red-500" />
                {t('meteo.wx.farm.loadError')}
              </>
            ) : (
              t('meteo.wx.farm.empty')
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Round weather badge for one cell: static SVG icon + the layer's headline number. */
function cellIcon(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  L: any,
  c: MeteoFarmCell,
  layer: MeteoFarmLayer,
  n0: Intl.NumberFormat,
) {
  const el = document.createElement('div');
  el.className =
    'flex -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-xl bg-white/90 px-1.5 py-0.5 shadow-md';
  el.style.width = 'max-content';
  const icon = document.createElement('div');
  icon.innerHTML = renderToStaticMarkup(<WeatherIcon icon={c.icon} className="h-5 w-5" />);
  const value = document.createElement('span');
  value.className = 'text-[11px] font-semibold leading-none text-neutral-800';
  const v =
    layer === 'rain24h' ? c.rain24hMm : layer === 'gust24h' ? c.gustMax24hMs : c.tempNowC;
  value.textContent = v === null ? '' : `${n0.format(v)}${layer === 'rain24h' ? ' mm' : layer === 'gust24h' ? ' m/s' : '°'}`;
  el.append(icon, value);
  return L.divIcon({ html: el, className: 'bg-transparent border-0', iconSize: [0, 0] });
}
