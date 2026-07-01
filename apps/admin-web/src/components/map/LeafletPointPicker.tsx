'use client';

import { useEffect, useRef } from 'react';

// Default center: Deta, Timiș (matches the other maps).
const DETA_CENTER: [number, number] = [45.3883, 21.2311];

interface LeafletPointPickerProps {
  initial?: { lat: number; lon: number } | null;
  /** Fired on user click or marker drag (not for the initial placement). */
  onChange: (lat: number, lon: number) => void;
  className?: string;
}

/**
 * Minimal single-point coordinate picker on an OpenStreetMap base (no API key).
 * Click the map or drag the pin to set a point; reports {lat, lon}. Raw Leaflet
 * via dynamic import (client-only), mirroring RouteMiniMap. Uses a divIcon pin so
 * no Leaflet marker-image asset setup is needed.
 */
export function LeafletPointPicker({ initial, onChange, className }: LeafletPointPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!mapRef.current) return;
    let isMounted = true;

    const init = async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (!isMounted || mapInstanceRef.current) return;

      const center: [number, number] = initial ? [initial.lat, initial.lon] : DETA_CENTER;
      const zoom = initial ? 15 : 13;
      const map = L.map(mapRef.current!, { center, zoom, minZoom: 5, maxZoom: 19 });
      requestAnimationFrame(() => {
        map.invalidateSize();
        map.setView(center, zoom);
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      const pinIcon = L.divIcon({
        className: 'sb-point-pin',
        html: '<div style="font-size:26px;line-height:26px">📍</div>',
        iconSize: [26, 30],
        iconAnchor: [13, 28],
      });

      const setPin = (lat: number, lng: number, fire: boolean) => {
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          const m = L.marker([lat, lng], { draggable: true, icon: pinIcon }).addTo(map);
          m.on('dragend', () => {
            const p = m.getLatLng();
            onChangeRef.current(p.lat, p.lng);
          });
          markerRef.current = m;
        }
        if (fire) onChangeRef.current(lat, lng);
      };

      if (initial) setPin(initial.lat, initial.lon, false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.on('click', (e: any) => setPin(e.latlng.lat, e.latlng.lng, true));

      if (!isMounted) {
        map.remove();
        return;
      }
      mapInstanceRef.current = map;
    };

    void init();

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
    // Init once; `initial` is only the starting view.
  }, []);

  return <div ref={mapRef} className={className ?? 'h-full w-full'} />;
}
