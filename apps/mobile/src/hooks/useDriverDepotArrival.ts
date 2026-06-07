import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { useDeliveryDestinations } from '@strawboss/api';
import { getDatabase } from '@/lib/storage';
import { TripsRepo } from '@/db/trips-repo';
import { mobileApiClient } from '@/lib/api-client';
import { distanceToBoundaryMeters, PARCEL_MATCH_TOLERANCE_M } from '@/lib/point-in-geojson';
import { mobileLogger } from '@/lib/logger';

export interface DriverDepotArrival {
  tripId: string;
  depotName: string;
}

const POLL_MS = 20_000;

/**
 * Client-side depot-arrival detection for the driver.
 *
 * The server's `deposit_entry` push is edge-triggered (fires once, at the
 * boundary crossing) and fire-and-forget — if the app is backgrounded or the
 * push isn't delivered, the arrival prompt is lost and never re-surfaces while
 * the truck sits inside the depot. This hook is the reliable, level-triggered
 * fallback: while the driver has an `in_transit` trip it samples GPS and reports
 * when they are inside a delivery destination's boundary, so the arrival
 * countdown can appear (or re-appear) independent of any push.
 */
export function useDriverDepotArrival(): DriverDepotArrival | null {
  const { data: depots } = useDeliveryDestinations(mobileApiClient);
  const [trip, setTrip] = useState<{ id: string; destinationId: string | null } | null>(null);
  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(null);
  const [arrival, setArrival] = useState<DriverDepotArrival | null>(null);

  // 1. Track the driver's active in_transit trip (local SQLite), refreshed periodically.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const db = await getDatabase();
        const active = await new TripsRepo(db).listActive();
        const t = active.find((x) => x.status === 'in_transit');
        if (!cancelled) {
          setTrip(t ? { id: t.id, destinationId: t.destination_id ?? null } : null);
        }
      } catch (err) {
        mobileLogger.warn('useDriverDepotArrival: trip load failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    };
    void load();
    const iv = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  // 2. Sample GPS only while there is an in_transit trip (no battery cost otherwise).
  useEffect(() => {
    if (!trip) {
      setGps(null);
      return;
    }
    let cancelled = false;
    const sample = async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) setGps({ lat: loc.coords.latitude, lon: loc.coords.longitude });
      } catch {
        // Keep the last known fix; presence stays on the previous value.
      }
    };
    void sample();
    const iv = setInterval(sample, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [trip]);

  // 3. Presence: inside the trip's destination depot (or any depot when the trip
  //    carries no destination_id). Only updates state on a real change so the
  //    countdown overlay isn't reset by every GPS sample.
  useEffect(() => {
    if (!trip || !gps || !depots?.length) {
      setArrival((prev) => (prev === null ? prev : null));
      return;
    }
    const withBoundary = depots.filter((d) => d.boundary);
    const candidates =
      trip.destinationId != null
        ? withBoundary.filter((d) => d.id === trip.destinationId)
        : withBoundary;
    const hit = candidates.find(
      (d) => distanceToBoundaryMeters(gps.lon, gps.lat, d.boundary) <= PARCEL_MATCH_TOLERANCE_M,
    );
    setArrival((prev) => {
      const next = hit ? { tripId: trip.id, depotName: hit.name } : null;
      if (prev?.tripId === next?.tripId && prev?.depotName === next?.depotName) return prev;
      return next;
    });
  }, [trip, gps, depots]);

  return arrival;
}
