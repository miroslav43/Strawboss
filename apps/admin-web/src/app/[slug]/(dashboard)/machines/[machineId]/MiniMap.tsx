'use client';

/**
 * Lightweight Leaflet mini-map showing a single machine position.
 * This file is dynamically imported (ssr:false) from the machine detail page.
 */

import { useEffect, useRef } from 'react';
import { esc } from '@/lib/html-escape';

interface MiniMapProps {
  lat: number;
  lon: number;
  label: string | null;
}

export function MiniMap({ lat, lon, label }: MiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep a ref so we can remove the map on unmount without stale closure.
  const mapRef = useRef<import('leaflet').Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Leaflet must be imported dynamically — it accesses `window` at module level.
    void import('leaflet').then((L) => {
      // Avoid double-initialising if the effect runs twice (React Strict Mode).
      if (mapRef.current) {
        mapRef.current.setView([lat, lon], 15);
        return;
      }

      // Leaflet default icon path fix for bundlers.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(containerRef.current!, {
        center: [lat, lon],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      if (label) {
        // `label` is user-controlled (machine internalCode/plate) — bindTooltip
        // sets string content via innerHTML, so it must be escaped (H8).
        L.marker([lat, lon])
          .addTo(map)
          .bindTooltip(esc(label), { permanent: true, direction: 'top' });
      } else {
        L.marker([lat, lon]).addTo(map);
      }

      mapRef.current = map;
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // Re-run only when coordinates change.
  }, [lat, lon]);

  return (
    <>
      {/* Leaflet CSS — loaded once per page via a <link> injected into <head> */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        crossOrigin=""
      />
      <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 180 }} />
    </>
  );
}
