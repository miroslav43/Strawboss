'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoutePoint } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';

// Default map center: Deta, Timiș (matches LeafletMap / RouteMiniMap).
const DETA_CENTER: [number, number] = [45.3883, 21.2311];
const DEFAULT_ZOOM = 13;

export interface TrackRoute {
  id: string;
  points: RoutePoint[];
  color: string;
  weight: number;
  /** Optional label for the start/end tooltips. */
  label?: string;
}

interface TracksMapProps {
  routes: TrackRoute[];
  className?: string;
}

/**
 * Read-only Leaflet map that draws MANY GPS route polylines at once, each with
 * its own colour/thickness, plus per-route start/end markers, and fits the view
 * to all of them. Modelled on `RouteMiniMap` (single route) — used by the
 * Tracks page where the user overlays several machines' routes for comparison.
 *
 * Leaflet is dynamically imported (client-only). Only `polyline`/`circleMarker`
 * are used, so `L.Icon.Default` image setup is unnecessary.
 */
export function TracksMap({ routes, className }: TracksMapProps) {
  const { t } = useI18n();
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const routesLayerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  // Only redraw when the meaningful shape of the routes changes (not on every
  // parent re-render): id + style + point count per route.
  const sig = useMemo(
    () => routes.map((r) => `${r.id}:${r.color}:${r.weight}:${r.points.length}`).join('|'),
    [routes],
  );

  // ── 1. Initialise map (client-only dynamic import) ──────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    let isMounted = true;

    const init = async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (!isMounted || mapInstanceRef.current) return;

      const map = L.map(mapRef.current!, { zoom: DEFAULT_ZOOM, center: DETA_CENTER });
      requestAnimationFrame(() => {
        map.invalidateSize();
        map.setView(DETA_CENTER, DEFAULT_ZOOM);
      });

      const placeLabelsPane = map.createPane('placeLabels');
      placeLabelsPane.style.zIndex = '550';
      placeLabelsPane.style.pointerEvents = 'none';

      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, USGS, AEX, GeoEye, Getmapping, IGN',
        },
      ).addTo(map);
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { pane: 'placeLabels', maxZoom: 19 },
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

  // ── 3. Draw all route polylines whenever the routes change ──────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    if (routesLayerRef.current) {
      map.removeLayer(routesLayerRef.current);
      routesLayerRef.current = null;
    }

    const drawable = routes.filter((r) => r.points && r.points.length >= 2);
    if (drawable.length === 0) return;

    let cancelled = false;
    const render = async () => {
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      const liveMap = mapInstanceRef.current;
      if (!liveMap) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layers: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allLatLngs: any[] = [];

      for (const r of drawable) {
        const latLngs = r.points.map((p) => [p.lat, p.lon] as [number, number]);
        allLatLngs.push(...latLngs);

        layers.push(
          L.polyline(latLngs, { color: r.color, weight: r.weight, opacity: 0.85 }),
          L.circleMarker(latLngs[0], {
            radius: 5,
            color: '#16a34a',
            fillColor: '#16a34a',
            fillOpacity: 1,
          }).bindTooltip(
            r.label
              ? `${r.label} — ${tRef.current('leaflet.routeStart')}`
              : tRef.current('leaflet.routeStart'),
          ),
          L.circleMarker(latLngs[latLngs.length - 1], {
            radius: 5,
            color: '#dc2626',
            fillColor: '#dc2626',
            fillOpacity: 1,
          }).bindTooltip(
            r.label
              ? `${r.label} — ${tRef.current('leaflet.routeEnd')}`
              : tRef.current('leaflet.routeEnd'),
          ),
        );
      }

      const group = L.layerGroup(layers).addTo(liveMap);
      routesLayerRef.current = group;
      if (allLatLngs.length > 0) {
        liveMap.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40] });
      }
    };

    void render();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, mapReady]);

  return <div ref={mapRef} className={className ?? 'h-full w-full'} />;
}
