'use client';

import { useEffect, useRef, useState } from 'react';
import type { MeteoOverviewRow } from '@strawboss/types';
import { STATUS_STYLES } from './format';

// Default map center: Deta, Timiș (matches LeafletMap / RouteMiniMap).
const DETA_CENTER: [number, number] = [45.3883, 21.2311];
const DEFAULT_ZOOM = 11;

interface MeteoMapProps {
  rows: MeteoOverviewRow[];
  onSelect?: (parcelId: string) => void;
  className?: string;
}

/**
 * Read-only Leaflet map of the parcels with a drying clock, painted by status.
 * Cloned from `RouteMiniMap` (no draw tools, no geoman). Load with
 * `dynamic(..., { ssr: false })`. Tooltips are built as DOM text nodes, never
 * HTML strings, so a parcel name can never inject markup.
 */
export function MeteoMap({ rows, onSelect, className }: MeteoMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  // ── 1. Initialise map (client-only dynamic import) ──────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    let isMounted = true;

    const init = async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (!isMounted || mapInstanceRef.current) return;

      const map = L.map(mapRef.current!, {
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

      if (!isMounted) {
        map.remove();
        return;
      }
      mapInstanceRef.current = map;
      setMapReady(true);
    };
    void init();

    return () => {
      isMounted = false;
      setMapReady(false);
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

  // ── 3. Draw the polygons whenever rows change ───────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    let cancelled = false;
    const render = async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapInstanceRef.current) return;

      const group = L.featureGroup();
      for (const row of rows) {
        if (!row.boundary) continue;
        const color = STATUS_STYLES[row.status].hex;
        try {
          const layer = L.geoJSON(row.boundary as GeoJSON.GeoJsonObject, {
            style: { color, weight: 2, fillColor: color, fillOpacity: 0.4 },
          });
          const label = document.createElement('span');
          label.textContent = row.parcelName ?? row.parcelCode ?? '';
          layer.bindTooltip(label, { sticky: true });
          layer.on('click', () => onSelectRef.current?.(row.parcelId));
          layer.addTo(group);
        } catch {
          // A malformed geometry must not blank the whole map.
        }
      }
      group.addTo(mapInstanceRef.current);
      layerRef.current = group;
      const bounds = group.getBounds();
      if (bounds.isValid()) mapInstanceRef.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
    };
    void render();

    return () => {
      cancelled = true;
    };
  }, [rows, mapReady]);

  return <div ref={mapRef} className={className ?? 'h-full w-full'} />;
}
