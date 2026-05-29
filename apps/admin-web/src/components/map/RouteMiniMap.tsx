'use client';

import { useEffect, useRef, useState } from 'react';
import type { RoutePoint } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';

// Default map center: Deta, Timiș (matches LeafletMap).
const DETA_CENTER: [number, number] = [45.3883, 21.2311];
const DEFAULT_ZOOM = 13;

interface RouteMiniMapProps {
  /** Route points in chronological order. */
  points: RoutePoint[];
  className?: string;
}

/**
 * Read-only Leaflet map that draws a single GPS route polyline with start/end
 * markers. Self-contained: no parcels, machines, draw tools, or geoman — unlike
 * the full `LeafletMap`. Used by the Km-per-truck report to show a day's route.
 *
 * Leaflet is dynamically imported (client-only). Only `polyline` /
 * `circleMarker` are used, so the `L.Icon.Default` image setup is unnecessary.
 */
export function RouteMiniMap({ points, className }: RouteMiniMapProps) {
  const { t } = useI18n();
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const routeLayerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  // Hold the current `t` in a ref so locale changes don't re-run the draw
  // effect (which would flash the polyline and aggravate the cancel race).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  // ── 1. Initialise map (client-only dynamic import) ──────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    let isMounted = true;

    const init = async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');

      if (!isMounted || mapInstanceRef.current) return;

      const map = L.map(mapRef.current!, { zoom: DEFAULT_ZOOM, center: DETA_CENTER });

      // Recalculate container size after the dynamic import lays out the box.
      requestAnimationFrame(() => {
        map.invalidateSize();
        map.setView(DETA_CENTER, DEFAULT_ZOOM);
      });

      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, USGS, AEX, GeoEye, Getmapping, IGN',
        },
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
    const scheduleInvalidate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    };
    scheduleInvalidate();

    const ro = new ResizeObserver(() => scheduleInvalidate());
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mapReady]);

  // ── 3. Draw the route polyline whenever points change ───────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }

    if (!points || points.length < 2) return;

    let cancelled = false;
    const render = async () => {
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      const liveMap = mapInstanceRef.current;
      if (!liveMap) return;

      const latLngs = points.map((p) => [p.lat, p.lon] as [number, number]);

      const polyline = L.polyline(latLngs, {
        color: '#3b82f6',
        weight: 3,
        opacity: 0.8,
        dashArray: '8 4',
      });

      const startMarker = L.circleMarker(latLngs[0], {
        radius: 6,
        color: '#16a34a',
        fillColor: '#16a34a',
        fillOpacity: 1,
      }).bindTooltip(tRef.current('leaflet.routeStart'), { permanent: false });

      const endMarker = L.circleMarker(latLngs[latLngs.length - 1], {
        radius: 6,
        color: '#dc2626',
        fillColor: '#dc2626',
        fillOpacity: 1,
      }).bindTooltip(tRef.current('leaflet.routeEnd'), { permanent: false });

      const group = L.layerGroup([polyline, startMarker, endMarker]).addTo(liveMap);
      routeLayerRef.current = group;
      liveMap.fitBounds(polyline.getBounds(), { padding: [40, 40] });
    };

    void render();

    return () => {
      cancelled = true;
    };
  }, [points, mapReady]);

  return <div ref={mapRef} className={className ?? 'h-full w-full'} />;
}
