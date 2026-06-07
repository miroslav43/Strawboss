import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { getDatabase } from '@/lib/storage';
import { DeliveryDestinationsRepo } from '@/db/delivery-destinations-repo';
import { pointInBoundary, distanceToBoundaryMeters } from '@/lib/point-in-geojson';
import { haversineKm } from '@/lib/routing';
import { mobileLogger } from '@/lib/logger';

export type DestinationProximityStatus = 'inside' | 'outside' | 'unknown';

export interface DestinationProximity {
  status: DestinationProximityStatus;
  /** Metres to the depot geofence edge (0 when inside). Null when unknown. */
  distanceM: number | null;
}

const SAMPLE_INTERVAL_MS = 15_000;

/**
 * Live proximity of the driver to a delivery destination's geofence, computed
 * from the device GPS and the destination boundary cached locally
 * (`delivery_destinations`). Returns 'inside' when within the geofence,
 * otherwise the metres to its edge; falls back to the cached centroid when no
 * boundary is available, and 'unknown' when there is no geometry or GPS fix.
 *
 * Mirrors the GPS sampling pattern in `useCurrentLoaderParcel` (foreground
 * permission + periodic re-sample) so the badge follows the driver while moving.
 */
export function useDestinationProximity(destinationId: string | null): DestinationProximity {
  const [boundary, setBoundary] = useState<unknown>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(null);

  // Resolve the destination geometry from the offline cache.
  useEffect(() => {
    let mounted = true;
    if (!destinationId) {
      setBoundary(null);
      setCoords(null);
      return;
    }
    void (async () => {
      try {
        const db = await getDatabase();
        const repo = new DeliveryDestinationsRepo(db);
        const row = await repo.findById(destinationId);
        if (!mounted) return;
        setBoundary(row?.boundary ?? null);
        if (row?.coords_json) {
          try {
            const c = JSON.parse(row.coords_json) as { lat?: number; lon?: number };
            if (typeof c.lat === 'number' && typeof c.lon === 'number') {
              setCoords({ lat: c.lat, lon: c.lon });
            }
          } catch {
            // Malformed centroid — ignore; distance just stays unknown.
          }
        } else {
          setCoords(null);
        }
      } catch (err) {
        mobileLogger.flow('useDestinationProximity: destination lookup failed', {
          destinationId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      mounted = false;
    };
  }, [destinationId]);

  // Sample GPS on mount, then on an interval while the screen is mounted.
  useEffect(() => {
    if (!destinationId) return;
    let cancelled = false;

    const sample = async () => {
      try {
        let { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          status = (await Location.requestForegroundPermissionsAsync()).status;
        }
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) setGps({ lat: loc.coords.latitude, lon: loc.coords.longitude });
      } catch {
        // Keep the last known fix; proximity stays on the previous value.
      }
    };

    void sample();
    const interval = setInterval(() => void sample(), SAMPLE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [destinationId]);

  if (!gps) return { status: 'unknown', distanceM: null };

  if (boundary) {
    if (pointInBoundary(gps.lon, gps.lat, boundary)) {
      return { status: 'inside', distanceM: 0 };
    }
    return {
      status: 'outside',
      distanceM: distanceToBoundaryMeters(gps.lon, gps.lat, boundary),
    };
  }
  if (coords) {
    const km = haversineKm({ lat: gps.lat, lon: gps.lon }, { lat: coords.lat, lon: coords.lon });
    return { status: 'outside', distanceM: km * 1000 };
  }
  return { status: 'unknown', distanceM: null };
}
