import { useEffect, useState, useRef } from 'react';
import * as Location from 'expo-location';
import { useAuthStore } from '@/stores/auth-store';
import { useActiveParcels, findParcelAtLocation, type ActiveParcel } from './useActiveParcels';
import { useCachedParcels } from './useCachedParcels';
import { useCachedDepots } from './useCachedDepots';
import { useMyTasks, type MyTask } from './useMyTasks';
import {
  distanceToBoundaryMeters,
  fieldToleranceMeters,
  pickSmallestContainingParcel,
  NEARBY_FIELD_RADIUS_M,
} from '@/lib/point-in-geojson';
import { useAssignedParcelGeometry } from './useAssignedParcelGeometry';
import { haversineKm } from '@/lib/routing';
import { type LocalDeliveryDestination } from '@/db/delivery-destinations-repo';
import { isMineByOwner } from '@/lib/my-assignments';
import { mobileLogger } from '@/lib/logger';

/** A GPS fix, carrying the reported accuracy so presence checks can adapt their tolerance. */
interface GpsFix {
  lat: number;
  lon: number;
  /** Metres, per `expo-location`'s `coords.accuracy`; null when the platform doesn't report it. */
  accuracyM: number | null;
}

/**
 * Fallback confirmation-ring radius (metres) for a depot with a stored centroid
 * but no drawn boundary. Mirrors the server-side default; used to gate a depot
 * load by proximity when `confirm_radius_m` isn't set on the cached row.
 */
const DEFAULT_DEPOT_CONFIRM_RADIUS_M = 300;

export type CurrentParcelStatus =
  | 'loading'
  | 'resolved'
  | 'needs_start'
  /**
   * The operator has 2+ fields assigned but at least one of their outlines is
   * not cached on this phone, so GPS has nothing to match against. Distinct
   * from `needs_start` ("we have every outline, you are simply not on any of
   * them") because the remedy is completely different: download the outlines,
   * not walk somewhere. Never guesses a field — with several candidates and a
   * missing polygon there is no honest answer to "which one", and attributing
   * bales to the wrong field is worse than a blocked screen.
   */
  | 'awaiting_geometry'
  | 'unavailable';

/** Live "am I physically on the field" state. */
export type ParcelPresence = 'inside' | 'outside' | 'unknown';

/**
 * Why `presence` is what it is — specifically, why it's `'unknown'` (or, for
 * a resolved target, whether it was verified at all). Distinguishes two very
 * different failure modes that used to collapse into the same "unknown" and
 * the same "Nu ești în câmp" message:
 *  - `'gps'` — we have (or could have) the field's geometry, but no GPS fix.
 *    Genuinely unverifiable *and* nothing to fall back on — the gate stays
 *    blocked until a fix arrives.
 *  - `'no_geometry'` / `'no_data'` — we have a GPS fix but lack the parcel's
 *    boundary (offline, not yet synced) or the parcel row itself. The
 *    operator's position is real; we just can't check it against anything.
 *    This is the case the degraded-mode gate is built to unblock.
 *  - `'ok'` — presence was actually computed (inside or outside).
 */
export type PresenceReason = 'ok' | 'gps' | 'no_geometry' | 'no_data';

/**
 * GPS acquisition state, surfaced so callers can tell "still locating" (wait)
 * apart from "GPS unavailable" (permission denied / timed out) when `presence`
 * is `unknown`. The in-field load gate uses this to pick the right message.
 */
export type ParcelGpsState = 'locating' | 'ready' | 'unavailable';

export interface CurrentLoaderParcel {
  status: CurrentParcelStatus;
  /**
   * Which kind of source the resolved target is. A loader can be assigned to a
   * field/parcel (default) or to a depot (`delivery_destinations`), in which
   * case the bales are sourced from the depot instead of a field.
   */
  targetType: 'parcel' | 'depot';
  /** Parcel id when `status === 'resolved'`. */
  parcelId: string | null;
  parcelName: string | null;
  /** T9.3 — code identifier; used as the display name when name is null. */
  parcelCode: string | null;
  /** Depot id when `targetType === 'depot'` and `status === 'resolved'`. */
  destinationId: string | null;
  destinationName: string | null;
  destinationCode: string | null;
  /** Locality (server `municipality`) of the resolved field, when known. */
  municipality: string | null;
  /** Crop label (grau / orz / rapita / plante_nutret / altele) when set. */
  cropType: string | null;
  /** Owning-farm name (denormalized, offline-capable) when known. */
  farmName: string | null;
  /**
   * How the parcel was resolved. `gps_nearby` means GPS named the field from
   * the wider {@link NEARBY_FIELD_RADIUS_M} pass rather than containment — the
   * field is identified, but the operator is demonstrably not standing in it.
   */
  source: 'in_progress_task' | 'gps' | 'gps_nearby' | null;
  /** Whether the operator's GPS is within tolerance of the resolved field boundary. */
  presence: ParcelPresence;
  /** Metres to the field boundary when `presence === 'outside'`. */
  distanceM: number | null;
  /** GPS acquisition state — disambiguates `presence === 'unknown'`. */
  gpsState: ParcelGpsState;
  /**
   * Why presence is unverified (or that it's genuinely verified) — see
   * {@link PresenceReason}. `null` only while the resolver itself is still
   * loading (`status === 'loading'`), before there is anything to reason about.
   */
  presenceReason: PresenceReason | null;
  /**
   * When `status === 'needs_start'`: the operator's assigned fields today,
   * rendered READ-ONLY so they know where to walk. Never a picker — see the
   * header note on GPS-only resolution.
   */
  candidates: MyTask[];
  /**
   * State of the local field-outline cache for today's assignment, so a screen
   * can explain and repair `status === 'awaiting_geometry'` in place instead of
   * presenting it as a generic GPS failure.
   */
  geometryRepair: {
    /** Assigned fields with no polygon cached on this phone. */
    missingCount: number;
    /** True while the outlines are being fetched. */
    isRepairing: boolean;
    /** Re-attempt the download. */
    retry: () => void;
  };
  /** Re-run resolution (resets GPS and task state). */
  refresh: () => void;
}

/**
 * Role-agnostic alias: the resolution logic depends only on the operator's
 * assigned machine + tasks + GPS, so the baler home reuses the same shape via
 * the shared ActiveFieldCard. Prefer this name in role-neutral code.
 */
export type CurrentFieldParcel = CurrentLoaderParcel;

/** Distance/inside check of a GPS fix against a resolved parcel's boundary. */
function computePresence(
  parcelId: string | null,
  gps: GpsFix | null,
  gpsReady: boolean,
  parcels: ActiveParcel[] | undefined,
): { presence: ParcelPresence; distanceM: number | null; reason: PresenceReason } {
  if (!parcelId) return { presence: 'unknown', distanceM: null, reason: 'no_data' };
  if (!gpsReady || !gps) return { presence: 'unknown', distanceM: null, reason: 'gps' };
  const p = parcels?.find((x) => x.id === parcelId);
  if (!p) return { presence: 'unknown', distanceM: null, reason: 'no_data' };
  if (p.boundary == null) return { presence: 'unknown', distanceM: null, reason: 'no_geometry' };
  // Adaptive tolerance: widens with the GPS fix's own reported accuracy (never
  // past the backend's 30m enter buffer), so a degraded-but-present fix at a
  // field edge doesn't read as "outside". `distanceM` always reports the real
  // distance to the boundary (0 only when truly inside the polygon) so the UI
  // can say "in field (12m from the edge)" instead of always showing 0 —
  // independent of the tolerance used to decide inside/outside.
  const d = distanceToBoundaryMeters(gps.lon, gps.lat, p.boundary);
  const roundedD = Math.round(d);
  if (d <= fieldToleranceMeters(gps.accuracyM))
    return { presence: 'inside', distanceM: roundedD, reason: 'ok' };
  return { presence: 'outside', distanceM: roundedD, reason: 'ok' };
}

/**
 * Presence of a GPS fix against a cached depot's geometry.
 *  - Boundary drawn → same adaptive-tolerance containment as fields.
 *  - No boundary but a centroid → "inside" when within `confirm_radius_m` of the
 *    point (fallback {@link DEFAULT_DEPOT_CONFIRM_RADIUS_M}); otherwise the real
 *    distance to the centroid.
 *  - No geometry at all → `unknown` (the load screen falls back to a soft
 *    confirm with no hard GPS block).
 */
function computeDepotPresence(
  destinationId: string | null,
  gps: GpsFix | null,
  gpsReady: boolean,
  depots: LocalDeliveryDestination[],
): { presence: ParcelPresence; distanceM: number | null; reason: PresenceReason } {
  if (!destinationId) return { presence: 'unknown', distanceM: null, reason: 'no_data' };
  if (!gpsReady || !gps) return { presence: 'unknown', distanceM: null, reason: 'gps' };
  const depot = depots.find((x) => x.id === destinationId);
  if (!depot) return { presence: 'unknown', distanceM: null, reason: 'no_data' };
  if (depot.boundary) {
    const d = distanceToBoundaryMeters(gps.lon, gps.lat, depot.boundary);
    const roundedD = Math.round(d);
    if (d <= fieldToleranceMeters(gps.accuracyM))
      return { presence: 'inside', distanceM: roundedD, reason: 'ok' };
    return { presence: 'outside', distanceM: roundedD, reason: 'ok' };
  }
  if (depot.coords_json) {
    try {
      const c = JSON.parse(depot.coords_json) as { lat?: number; lon?: number };
      if (typeof c.lat === 'number' && typeof c.lon === 'number') {
        const radius = depot.confirm_radius_m ?? DEFAULT_DEPOT_CONFIRM_RADIUS_M;
        const meters = Math.round(
          haversineKm({ lat: gps.lat, lon: gps.lon }, { lat: c.lat, lon: c.lon }) * 1000,
        );
        if (meters <= radius) return { presence: 'inside', distanceM: meters, reason: 'ok' };
        return { presence: 'outside', distanceM: meters, reason: 'ok' };
      }
    } catch {
      // Malformed centroid — fall through to unknown.
    }
  }
  return { presence: 'unknown', distanceM: null, reason: 'no_geometry' };
}

const GPS_TIMEOUT_MS = 15_000;
const GPS_RETRY_DELAY_MS = 5_000;
const GPS_MAX_RETRIES = 1;

/**
 * Resolve the loader's current parcel ("teren activ").
 *
 * Strict GPS-only when the loader has 2+ parcels assigned today: the operator
 * is never asked to pick manually. The only auto-resolve without GPS is the
 * trivial case of a single parcel assigned for the whole day.
 *
 * Which tasks count as "mine" is `isMineByOwner` — machine OR direct user
 * assignment, the same predicate the server and the offline fallback use.
 *
 * Resolution order:
 *  1. Operator has exactly **one** parcel assigned today (any status) →
 *     resolve to it without consulting GPS. Note this tier needs no boundary
 *     geometry at all, which is precisely why a phone with an empty parcel
 *     cache works fine for a one-field operator and used to dead-end for a
 *     multi-field one.
 *  2. GPS inside a parcel boundary, matched ONLY against the operator's own
 *     assigned fields — never the org-wide parcel cache.
 *  3. Neither → `needs_start` with the assigned fields as read-only context,
 *     or `unavailable` when nothing is assigned. The screen forbids manual
 *     selection in both cases; the way out is to walk onto the field.
 *
 * Task `status` is deliberately not consulted anywhere: it does not survive the
 * sync pull, so any tier keyed on `in_progress` behaved differently offline.
 *
 * GPS is attempted with a 15s timeout and one automatic retry before giving up.
 */
export function useCurrentLoaderParcel(): CurrentLoaderParcel {
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  // Needed alongside the machine: an operator with no `assigned_machine_id`
  // reaches their tasks only through `assigned_user_id`. See `isMineByOwner`.
  const userId = useAuthStore((s) => s.userId);
  const { tasks, isLoading: tasksLoading } = useMyTasks();
  const { data: activeParcels, isLoading: parcelsLoading } = useActiveParcels();
  // Metadata source for the card (farm / locality / crop). Offline-first: tries
  // the API, falls back to the local SQLite cache — so the field card keeps its
  // context even with no signal. Kept separate from the GPS source above.
  const { parcels: cachedParcels } = useCachedParcels();

  // Depot geometry — API when online (persisted to SQLite for offline), local
  // cache otherwise. Used to compute presence for a depot target (a loader
  // assigned to a delivery destination).
  const { depots: cachedDepots } = useCachedDepots();

  const [gps, setGps] = useState<GpsFix | null>(null);
  const [gpsStatus, setGpsStatus] = useState<
    'idle' | 'loading' | 'retrying' | 'unavailable' | 'ready'
  >('idle');
  const [refreshKey, setRefreshKey] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;

    const attemptGps = async () => {
      try {
        setGpsStatus(retryCount === 0 ? 'loading' : 'retrying');
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          if (!cancelled) setGpsStatus('unavailable');
          return;
        }
        const loc = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('GPS timeout')), GPS_TIMEOUT_MS),
          ),
        ]);
        if (cancelled) return;
        setGps({
          lat: loc.coords.latitude,
          lon: loc.coords.longitude,
          accuracyM: Number.isFinite(loc.coords.accuracy) ? (loc.coords.accuracy ?? null) : null,
        });
        setGpsStatus('ready');
      } catch (err) {
        if (cancelled) return;
        if (retryCount < GPS_MAX_RETRIES) {
          retryCount++;
          mobileLogger.flow('useCurrentLoaderParcel: GPS timeout, scheduling retry', {
            attempt: retryCount,
          });
          retryTimerRef.current = setTimeout(() => {
            if (!cancelled) void attemptGps();
          }, GPS_RETRY_DELAY_MS);
        } else {
          setGpsStatus('unavailable');
          mobileLogger.flow('useCurrentLoaderParcel: GPS unavailable after retry', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };

    void attemptGps();

    // Live presence: silently re-sample GPS every 30 s so the inside/outside
    // badge follows the operator without flickering the card back to "loading".
    const presenceInterval = setInterval(() => {
      void (async () => {
        try {
          const perm = await Location.getForegroundPermissionsAsync();
          if (perm.status !== 'granted') return;
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!cancelled)
            setGps({
              lat: loc.coords.latitude,
              lon: loc.coords.longitude,
              accuracyM: Number.isFinite(loc.coords.accuracy)
                ? (loc.coords.accuracy ?? null)
                : null,
            });
        } catch {
          // Keep the last known fix; presence stays on the previous value.
        }
      })();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(presenceInterval);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [refreshKey]);

  const refresh = () => {
    setGps(null);
    setGpsStatus('idle');
    setRefreshKey((k) => k + 1);
  };

  // Collapse the internal GPS lifecycle into the 3-state public signal: a fresh
  // fix is `ready`, a hard failure is `unavailable`, everything in between
  // (idle/loading/retrying) is still `locating`.
  const gpsState: ParcelGpsState =
    gpsStatus === 'ready' ? 'ready' : gpsStatus === 'unavailable' ? 'unavailable' : 'locating';

  // Ownership via machine OR direct user assignment — the same predicate the
  // server's `getMyTasks` and the offline `readTasksFromSqlite` fallback use.
  // Filtering on the machine alone (as this did) silently emptied the list for
  // every operator with no `assigned_machine_id`, which ends as `unavailable`
  // and a screen telling them they have no field today.
  //
  // Computed above the loading early-return because the geometry repair below
  // is a hook and so cannot sit behind a conditional return.
  const myTasks = tasks.filter((t) =>
    isMineByOwner(
      { assignedUserId: t.assignedUserId, machineId: t.machineId },
      { userId, machineId: assignedMachineId },
    ),
  );
  // Distinct parcel ids across all today's tasks (any status) — the "single
  // parcel assigned" shortcut, and the bound on GPS matching. Deliberately
  // status-blind: see the note on Tier 3 below.
  const distinctTaskParcelIds = new Set(myTasks.map((t) => t.parcelId).filter(Boolean) as string[]);
  const assignedParcelIds = [...distinctTaskParcelIds];

  // Make sure today's fields actually have outlines on this phone. GPS matching
  // is impossible without them, and the sync pull never carries them.
  const { isRepairing, retry: retryGeometry } = useAssignedParcelGeometry(assignedParcelIds);
  const assignedMissingGeometry = assignedParcelIds.filter((id) => {
    const p = activeParcels?.find((x) => x.id === id);
    return !p || p.boundary == null;
  });
  const geometryRepair = {
    missingCount: assignedMissingGeometry.length,
    isRepairing,
    retry: retryGeometry,
  };

  // The exact fingerprint of an ownership-predicate mismatch — the server sent
  // tasks and none of them looked like ours. There is no way to reproduce that
  // on a fleet phone without a log line. In an effect, and keyed on the counts,
  // so it records a transition rather than firing on every GPS-driven re-render.
  const ownerMismatch = tasks.length > 0 && myTasks.length === 0;
  useEffect(() => {
    if (!ownerMismatch) return;
    mobileLogger.flow('useCurrentLoaderParcel: tasks returned but none matched owner predicate', {
      tasksLen: tasks.length,
      userId,
      assignedMachineId,
    });
  }, [ownerMismatch, tasks.length, userId, assignedMachineId]);

  // Pull farm / locality / crop for a resolved parcel from the cached-parcels
  // list (offline-capable). Returns nulls until the cache is populated.
  const enrich = (
    parcelId: string | null,
  ): { municipality: string | null; cropType: string | null; farmName: string | null } => {
    const p = parcelId ? cachedParcels.find((x) => x.id === parcelId) : undefined;
    return {
      municipality: p?.municipality ?? null,
      cropType: p?.cropType ?? null,
      farmName: p?.farmName ?? null,
    };
  };

  if (tasksLoading || parcelsLoading) {
    return {
      status: 'loading',
      targetType: 'parcel',
      parcelId: null,
      parcelName: null,
      parcelCode: null,
      destinationId: null,
      destinationName: null,
      destinationCode: null,
      municipality: null,
      cropType: null,
      farmName: null,
      source: null,
      presence: 'unknown',
      distanceM: null,
      gpsState,
      presenceReason: null,
      candidates: [],
      geometryRepair,
      refresh,
    };
  }

  // Depot target: a loader assigned to a depot (destinationId set, no parcel).
  // Resolves like the single-parcel shortcut — presence is computed against the
  // cached depot geometry rather than a field boundary. Only when the loader has
  // no parcel tasks at all (field XOR depot per the board convention).
  const depotTasks = myTasks.filter((t) => !!t.destinationId && !t.parcelId);
  if (distinctTaskParcelIds.size === 0 && depotTasks.length > 0) {
    const dt = depotTasks[0]!;
    const {
      presence,
      distanceM,
      reason: presenceReason,
    } = computeDepotPresence(dt.destinationId, gps, gpsStatus === 'ready', cachedDepots);
    return {
      status: 'resolved',
      targetType: 'depot',
      parcelId: null,
      parcelName: dt.destinationName ?? dt.destinationCode,
      parcelCode: dt.destinationCode,
      destinationId: dt.destinationId,
      destinationName: dt.destinationName,
      destinationCode: dt.destinationCode,
      municipality: null,
      cropType: null,
      farmName: null,
      source: 'in_progress_task',
      presence,
      distanceM,
      gpsState,
      presenceReason,
      candidates: [],
      geometryRepair,
      refresh,
    };
  }

  // Tier 1: exactly one parcel assigned for the whole day → resolve without
  // GPS. The trivial case where there's nothing to pick between.
  if (distinctTaskParcelIds.size === 1) {
    const t = myTasks.find((mt) => !!mt.parcelId)!;
    const {
      presence,
      distanceM,
      reason: presenceReason,
    } = computePresence(t.parcelId, gps, gpsStatus === 'ready', activeParcels);
    return {
      status: 'resolved',
      targetType: 'parcel',
      parcelId: t.parcelId,
      // Unnamed terrains fall back to the code so the card is never blank.
      parcelName: t.parcelName ?? t.parcelCode,
      parcelCode: t.parcelCode,
      destinationId: null,
      destinationName: null,
      destinationCode: null,
      ...enrich(t.parcelId),
      source: 'in_progress_task',
      presence,
      distanceM,
      gpsState,
      presenceReason,
      candidates: [],
      geometryRepair,
      refresh,
    };
  }

  // Tier 2: GPS inside a parcel boundary — always bounded by the operator's OWN
  // assigned fields.
  //
  // This pool previously fell back to EVERY cached parcel in the organisation
  // whenever the assigned set came out empty, so an operator standing in any of
  // the org's fields resolved to it with `source: 'gps'`. The server does not
  // catch that either — `trips.service.ts` only checks the parcel belongs to the
  // organisation, not that it was assigned — so the wrong-field load was
  // accepted and written. No fallback: with nothing assigned there is nothing
  // GPS is allowed to match.
  if (gpsStatus === 'ready' && gps && distinctTaskParcelIds.size > 0) {
    const gpsPool: ActiveParcel[] = (activeParcels ?? []).filter((p) =>
      distinctTaskParcelIds.has(p.id),
    );
    // Two passes over the same pool. First containment (+ the standard 30m
    // drift buffer). Failing that, the widest radius at which naming the field
    // is still unambiguous — an operator on the access track or at a headland
    // gets told which field they are next to and how far, instead of a dead end.
    // A `gps_nearby` match still reports `presence: 'outside'`, so it names the
    // field without ever asserting the operator is standing in it.
    const contained = findParcelAtLocation(gps.lon, gps.lat, gpsPool);
    const hit =
      contained ?? pickSmallestContainingParcel(gps.lon, gps.lat, gpsPool, NEARBY_FIELD_RADIUS_M);
    if (hit) {
      // GPS resolves WHICH field (tolerance helps disambiguate between parcels),
      // and presence re-checks the same point against the adaptive tolerance
      // (see computePresence) to decide inside/outside and report the reason.
      const {
        presence,
        distanceM,
        reason: presenceReason,
      } = computePresence(hit.id, gps, true, activeParcels);
      return {
        status: 'resolved',
        targetType: 'parcel',
        parcelId: hit.id,
        parcelName: hit.name,
        parcelCode: hit.code,
        destinationId: null,
        destinationName: null,
        destinationCode: null,
        ...enrich(hit.id),
        source: contained ? 'gps' : 'gps_nearby',
        presence,
        distanceM,
        gpsState,
        presenceReason,
        candidates: [],
        geometryRepair,
        refresh,
      };
    }
  }

  // Tier 2b: GPS found nothing, but that verdict is not trustworthy — at least
  // one of the operator's fields has no outline cached, so it could not have
  // been matched even if they were standing in the middle of it. Say so, and
  // offer the download, rather than reporting a GPS failure that isn't one.
  //
  // Only for 2+ fields: a single assigned field never reaches here (Tier 1
  // resolves it without geometry, and `computePresence` already reports
  // `no_geometry` there for the degraded-mode gate to pick up).
  if (assignedMissingGeometry.length > 0 && distinctTaskParcelIds.size > 1) {
    return {
      status: 'awaiting_geometry',
      targetType: 'parcel',
      parcelId: null,
      parcelName: null,
      parcelCode: null,
      destinationId: null,
      destinationName: null,
      destinationCode: null,
      municipality: null,
      cropType: null,
      farmName: null,
      source: null,
      presence: 'unknown',
      distanceM: null,
      gpsState,
      presenceReason: 'no_geometry',
      candidates: myTasks.filter((t) => !!t.parcelId),
      geometryRepair,
      refresh,
    };
  }

  // Tier 3: GPS didn't match any assigned parcel. Surface ALL tasks (any
  // status) as informational candidates so the operator knows where to walk;
  // the screen renders them read-only with a "Reîncearcă GPS" button.
  //
  // There used to be a tier above this one for "2+ in_progress but GPS couldn't
  // pick one" (`multiple_active`). Under the GPS-only rule that was the same
  // state as this one — the operator can do nothing differently about either —
  // and it was the ONLY thing that made this resolver behave differently online
  // and offline: `readTasksFromSqlite` synthesizes `status: 'available'` for
  // every row (the pull payload carries no status), so offline `in_progress`
  // was always empty and that tier could never fire. One state, one message.
  const assignedAny = myTasks.filter((t) => !!t.parcelId);
  return {
    status: assignedAny.length ? 'needs_start' : 'unavailable',
    targetType: 'parcel',
    parcelId: null,
    parcelName: null,
    parcelCode: null,
    destinationId: null,
    destinationName: null,
    destinationCode: null,
    municipality: null,
    cropType: null,
    farmName: null,
    source: null,
    presence: 'unknown',
    distanceM: null,
    gpsState,
    presenceReason: 'no_data',
    candidates: assignedAny,
    geometryRepair,
    refresh,
  };
}
