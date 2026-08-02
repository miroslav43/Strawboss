import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Animated,
  ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import type { Machine } from '@strawboss/types';
import { BigButton } from '@/components/ui/BigButton';
import { NumericPad } from '@/components/ui/NumericPad';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { AppModal } from '@/components/shared/AppModal';
import { useModal } from '@/hooks/useModal';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { mobileApiClient, resolveApiUrl } from '@/lib/api-client';
import { ApiError } from '@strawboss/api';
import { getDatabase } from '@/lib/storage';
import { BaleLoadsRepo } from '@/db/bale-loads-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { TripsRepo } from '@/db/trips-repo';
import { DeliveryDestinationsRepo } from '@/db/delivery-destinations-repo';
import { useAuthStore } from '@/stores/auth-store';
import { useCurrentLoaderParcel } from '@/hooks/useCurrentLoaderParcel';
import { mobileLogger } from '@/lib/logger';
import { generateUuid } from '@/lib/uuid';
import {
  buildCmrPdf,
  uploadCmrScan,
  deleteLocalCmrPdf,
  deleteLocalCmrImages,
  enqueueCmrScan,
} from '@/lib/cmrScanUpload';
import { scanCmrPages, captureCmrPageWithCamera, ScannerUnavailableError } from '@/lib/cmrScanner';
import { colors } from '@strawboss/ui-tokens';
import { operatorStatsQueryKey } from '@/components/features/stats/OperatorStats';
import { useI18n } from '@/lib/i18n';

const GPS_TIMEOUT_MS = 15_000;
// Mirrors DEFAULT_MAX_BALES_PER_TRUCK in @strawboss/domain. Inlined (not
// imported) to keep `xstate` and other domain-only deps out of the mobile
// bundle — same pattern as useTripTransition mirroring the trip state machine.
const DEFAULT_MAX_BALES_PER_TRUCK = 33;

type GpsStatus = 'idle' | 'loading' | 'denied' | 'unavailable' | 'ok';

/**
 * The CMR scan step, shown only for auxiliary loads. `intro` prompts the scan,
 * `preview` shows the captured pages and is the gate that enforces "at least one
 * page" before anything is written, `saving` runs the register + upload.
 */
type CmrStep = null | 'intro' | 'preview' | 'saving';

interface RegisterLoadResponse {
  trip: { id: string; status: string; bale_count: number };
  baleLoadId: string;
  created: boolean;
}

/**
 * Single-action loader screen. Once the operator confirms a bale count
 * for a truck:
 *
 *   • Online → call POST /api/v1/trips/register-load. The server finds or
 *     creates today's trip, inserts a bale_load, transitions to `loaded`,
 *     and pushes the driver. Back to home immediately.
 *   • Offline → enqueue a `register_load` mutation in the sync queue. The
 *     local trips/bale_loads tables are updated optimistically so the
 *     loader bales tab and the driver (after sync) see the change.
 *
 * Parcel selection is intentionally absent — the field comes from
 * `useCurrentLoaderParcel`. If that hook can't resolve a parcel, the user
 * is bounced back to the home screen with a prompt.
 */
function truckIdFromParams(raw: string | string[] | undefined): string | null {
  if (raw == null) return null;
  const id = Array.isArray(raw) ? raw[0] : raw;
  return id && String(id).trim().length > 0 ? String(id) : null;
}

export default function LoadBalesScreen() {
  const {
    truckId: truckIdParam,
    parcelId: parcelIdParam,
    isAuxiliary: isAuxiliaryParam,
    auxTripId: auxTripIdParam,
  } = useLocalSearchParams<{
    truckId?: string | string[];
    parcelId?: string | string[];
    isAuxiliary?: string | string[];
    auxTripId?: string | string[];
  }>();

  // Auxiliary flag: passed from the aux truck card on the loader home.
  // When true, proximity/geofence checks are bypassed — the external truck
  // arrives wherever; the loader loads it on demand at any location.
  const isAuxiliary =
    (Array.isArray(isAuxiliaryParam) ? isAuxiliaryParam[0] : isAuxiliaryParam) === '1';

  // The aux trip's id. Only used to address the CMR scan: online we could read it
  // off the register-load response, but offline there is no response, so the id
  // has to come in with the route.
  const auxTripId = (() => {
    const raw = Array.isArray(auxTripIdParam) ? auxTripIdParam[0] : auxTripIdParam;
    return raw && raw.length > 0 ? raw : null;
  })();

  // For auxiliary trips the parcel is pre-resolved from the trip row (passed via
  // route param). For normal trips it still comes from useCurrentLoaderParcel.
  const auxParcelId = !isAuxiliary
    ? null
    : (() => {
        const raw = Array.isArray(parcelIdParam) ? parcelIdParam[0] : parcelIdParam;
        return raw && raw.length > 0 ? raw : null;
      })();
  const { t } = useI18n();
  const userId = useAuthStore((s) => s.userId);
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const signatureSpecimenUrl = useAuthStore((s) => s.signatureSpecimenUrl);
  const { isConnected: isOnline } = useNetworkStatus();
  const queryClient = useQueryClient();
  const parcel = useCurrentLoaderParcel();
  const { modalProps, showModal, hideModal } = useModal();

  // Snapshot the resolved parcel at mount so a background refresh mid-load
  // doesn't silently change which parcel the bales get registered against.
  const [snapshotParcelId, setSnapshotParcelId] = useState<string | null>(null);
  const [snapshotParcelName, setSnapshotParcelName] = useState<string | null>(null);
  // Depot mode: a loader assigned to a depot loads a truck sourced from the
  // depot instead of a field. Snapshotted the same way as the parcel above.
  const [snapshotDepotId, setSnapshotDepotId] = useState<string | null>(null);
  const [snapshotDepotName, setSnapshotDepotName] = useState<string | null>(null);
  // Whether the snapshotted depot has any cached geometry (boundary or centroid).
  // null = still loading; false = no geometry → soft confirm (no hard GPS gate).
  const [depotHasGeometry, setDepotHasGeometry] = useState<boolean | null>(null);

  // Live target kind. Once a depot is snapshotted it stays a depot; before the
  // snapshot we trust the hook's resolution.
  const targetIsDepot = snapshotDepotId != null || parcel.targetType === 'depot';

  useEffect(() => {
    if (snapshotParcelId || snapshotDepotId) return;
    if (isAuxiliary) {
      // Prefer the parcel the trip was created with; otherwise the auxiliary load
      // is attributed to the loader's OWN current/assigned target (the external
      // truck isn't tied to a fixed parcel — it loads wherever the loader is).
      if (auxParcelId) {
        setSnapshotParcelId(auxParcelId);
        return;
      }
      if (parcel.status === 'resolved') {
        // A depot-assigned loader has no parcel — snapshot the depot so the aux
        // load can proceed (aux loads bypass the GPS gate; they just need a
        // target). Without this the Register button stays disabled and the card
        // is stuck on "Determining the field from your location…".
        if (parcel.targetType === 'depot' && parcel.destinationId) {
          setSnapshotDepotId(parcel.destinationId);
          setSnapshotDepotName(parcel.destinationName ?? parcel.destinationCode);
          return;
        }
        if (parcel.parcelId) {
          setSnapshotParcelId(parcel.parcelId);
          setSnapshotParcelName(parcel.parcelName);
        }
      }
      return;
    }
    if (parcel.status === 'resolved') {
      // Depot target takes precedence — no parcel is attached.
      if (parcel.targetType === 'depot' && parcel.destinationId) {
        setSnapshotDepotId(parcel.destinationId);
        setSnapshotDepotName(parcel.destinationName ?? parcel.destinationCode);
        return;
      }
      if (parcel.parcelId) {
        setSnapshotParcelId(parcel.parcelId);
        setSnapshotParcelName(parcel.parcelName);
      }
    }
    // Only run when the target resolves; snapshot is intentionally frozen after first capture.
  }, [
    isAuxiliary,
    auxParcelId,
    parcel.status,
    parcel.parcelId,
    parcel.parcelName,
    parcel.targetType,
    parcel.destinationId,
    parcel.destinationName,
    parcel.destinationCode,
    snapshotParcelId,
    snapshotDepotId,
  ]);

  // Load the snapshotted depot's geometry presence — used to decide whether the
  // hard GPS gate applies (geometry present) or a soft confirm is allowed (none).
  useEffect(() => {
    if (!snapshotDepotId) return;
    let cancelled = false;
    void (async () => {
      try {
        const db = await getDatabase();
        const repo = new DeliveryDestinationsRepo(db);
        const row = await repo.findById(snapshotDepotId);
        if (cancelled) return;
        setDepotHasGeometry(!!(row?.boundary || row?.coords_json));
      } catch {
        // Treat a lookup failure as "no geometry" → soft confirm, never a hard block.
        if (!cancelled) setDepotHasGeometry(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshotDepotId]);

  const [baleCountStr, setBaleCountStr] = useState('');
  const [saving, setSaving] = useState(false);
  // Own-fleet loads still end on the specimen signature. Auxiliary loads end on a
  // CMR scan instead — the external transporter's paper document, which only exists
  // for aux. The two finish paths are mutually exclusive; see handleRegisterPress.
  const [showSignature, setShowSignature] = useState(false);
  const [cmrStep, setCmrStep] = useState<CmrStep>(null);
  const [cmrPages, setCmrPages] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saved, setSaved] = useState(false);
  const successScale = useRef(new Animated.Value(0.5)).current;

  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const gpsRef = useRef<{ lon: number; lat: number } | null>(null);
  // Stable across retries — sync_idempotency on the server dedupes only when
  // the same key is replayed. Regenerated only after a confirmed success.
  const idempotencyKeyRef = useRef<string | null>(null);
  // Set when the operator explicitly confirmed registering a load whose
  // position could not be verified (offline / no cached geometry) — see the
  // `bypassIsUnverifiable` branch in handleRegisterPress. Carried into the
  // submit payload as `locationUnverified` so the row surfaces for review.
  const [locationUnverified, setLocationUnverified] = useState(false);

  const baleCount = parseInt(baleCountStr, 10) || 0;

  // In-field gate (hard). A load may only be registered when GPS *proves* the
  // loader is inside the field, within an accuracy-adaptive tolerance of its
  // boundary (see `fieldToleranceMeters` — computed inside `computePresence`
  // in useCurrentLoaderParcel), so bales are never attributed to a field the
  // operator isn't standing on. `presence`/`distanceM`/`gpsState` come from
  // useCurrentLoaderParcel; the tolerance itself is NOT re-applied here —
  // doing it in two places is how the old 0m/5m double-count happened.
  const inField = parcel.presence === 'inside';
  // GPS proves the loader is outside the (already-tolerant) boundary — used
  // for the precise distance copy. `unknown` is handled separately below
  // (locating vs unverifiable vs unavailable).
  const awayFromField = parcel.presence === 'outside';

  // Presence is `unknown` because we have a GPS fix but can't check it against
  // anything (the resolved parcel's geometry isn't cached, or the parcel row
  // itself isn't) — as opposed to `unknown` because there's genuinely no GPS
  // fix yet. Only the former is safe to unblock: the operator's position is
  // real, we just can't verify it offline. See useCurrentLoaderParcel's
  // `PresenceReason` doc for the full reasoning.
  const positionUnverifiable =
    parcel.presence === 'unknown' &&
    (parcel.presenceReason === 'no_geometry' || parcel.presenceReason === 'no_data');

  // The gate is bypassed specifically because of the unverifiable-position
  // case (not because this is an auxiliary load, or a depot with no cached
  // geometry — both of those are already-legitimate silent bypasses that
  // predate this change and need no confirmation or flag).
  const unverifiedBypass =
    positionUnverifiable && !isAuxiliary && !(targetIsDepot && depotHasGeometry === false);

  // Whether the hard in-target GPS gate is bypassed.
  //  - Auxiliary loads always bypass (external truck arrives wherever).
  //  - A depot with NO cached geometry also bypasses to a soft confirm — but a
  //    depot WITH geometry is gated on presence exactly like a field. While
  //    the geometry is still loading (depotHasGeometry === null) the gate stays on.
  //  - A genuinely unverifiable position (see above) degrades to "allowed with
  //    a confirm + the load flagged unverified" — never a silent bypass, and
  //    never applied to a *verified* outside/too-far position.
  const bypassFieldGate =
    isAuxiliary || (targetIsDepot && depotHasGeometry === false) || positionUnverifiable;

  // The active target (parcel or depot) has been snapshotted and is ready to load.
  const targetReady = targetIsDepot ? snapshotDepotId !== null : snapshotParcelId !== null;
  // Display name for the active target, used in gate/duplicate copy.
  const targetName = targetIsDepot ? snapshotDepotName : snapshotParcelName;

  const truckId = truckIdFromParams(truckIdParam);
  const { data: truck } = useQuery<Machine>({
    queryKey: ['machine', truckId],
    queryFn: () => mobileApiClient.get<Machine>(`/api/v1/machines/${truckId}`),
    enabled: !!truckId,
  });

  // Bounce back if we don't have what we need (truck or resolved parcel).
  useEffect(() => {
    if (!truckId) {
      Alert.alert(t('loader.loadBales.errorNoTruck'), t('loader.loadBales.errorNoTruckMessage'), [
        { text: t('loader.loadBales.errorNoTruckOk'), onPress: () => router.back() },
      ]);
    }
  }, [truckId, t]);

  // NOTE: there is deliberately no effect here that bounces the operator off
  // this screen when the parcel can't be resolved.
  //
  // There used to be one: `unavailable` / `multiple_active` / online
  // `needs_start` fired an alert reading "confirm the active field on the home
  // screen", whose single button called `router.back()`. The home screen offers
  // no such confirmation — by design, since field resolution is GPS-only
  // (ActiveFieldCard renders candidates read-only). So the message named an
  // action that does not exist, and the bounce removed the operator before the
  // resolver's own 30s GPS re-sample could resolve the field for them. An
  // operator with several fields assigned had no way through at all.
  //
  // The unresolved states are now rendered in place, with a live GPS retry —
  // see the parcel card below. Register stays disabled until a target snapshots
  // (`parcelReady`), so removing the bounce cannot admit a bad write.
  // Best-effort GPS for audit trail.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setGpsStatus('loading');
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          if (!cancelled) setGpsStatus('denied');
          return;
        }
        // High accuracy (not Balanced): this fix both proves in-field presence
        // and is stored on the bale_load as the audit trail, so it's worth the
        // extra second or two — a phone standing still in a field has GPS FGS
        // access already, this isn't a fresh cold start.
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
          timeInterval: GPS_TIMEOUT_MS,
        });
        if (cancelled) return;
        gpsRef.current = { lon: loc.coords.longitude, lat: loc.coords.latitude };
        setGpsStatus('ok');
      } catch {
        if (!cancelled) setGpsStatus('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fullTruckCount = truck?.maxBaleCount ?? DEFAULT_MAX_BALES_PER_TRUCK;

  /**
   * Every gate in handleRegisterPress ends here. Auxiliary loads finish by scanning
   * the transporter's paper CMR; own-fleet loads finish on the specimen signature,
   * unchanged — there is no paper CMR for a truck that never leaves the company.
   */
  const proceedToFinish = useCallback(() => {
    if (isAuxiliary) {
      setCmrStep('intro');
    } else {
      setShowSignature(true);
    }
  }, [isAuxiliary]);

  // FM-5: duplicate detection — check for a recent bale_load on same (truckId, parcelId).
  // Uses snapshotParcelId directly (parcelReady = snapshotParcelId !== null, declared later).
  //
  // Split from handleRegisterPress so the "position unverified" confirmation
  // (below) can defer straight into it once the operator explicitly agrees —
  // everything past the gate is identical either way.
  const runPreflightAndProceed = useCallback(async () => {
    if (baleCount <= 0 || !truckId || (!targetIsDepot && !snapshotParcelId)) {
      proceedToFinish();
      return;
    }
    // Depot loads have no per-parcel duplicate/availability checks yet
    // (depot-inventory reconciliation is a future enhancement) — sign directly.
    // The `!snapshotParcelId` re-check also narrows the type for the checks below.
    if (targetIsDepot || !snapshotParcelId) {
      proceedToFinish();
      return;
    }
    try {
      const db = await getDatabase();
      const baleLoadsRepo = new BaleLoadsRepo(db);
      const recent = await baleLoadsRepo.findRecentByTruckParcel(truckId, snapshotParcelId, 10);
      if (recent.length > 0) {
        const totalBales = recent.reduce((acc, l) => acc + l.bale_count, 0);
        const minutesAgo = Math.round(
          (Date.now() - new Date(recent[0]!.loaded_at ?? recent[0]!.created_at).getTime()) / 60_000,
        );
        showModal({
          type: 'warning',
          title: t('loader.loadBales.modalDuplicateLoadTitle'),
          message: t('loader.loadBales.modalDuplicateLoadMessage', {
            totalBales,
            minutesAgo,
          }),
          confirmText: t('loader.loadBales.modalContinue'),
          cancelText: t('loader.loadBales.modalCancel'),
          onConfirm: () => {
            hideModal();
            proceedToFinish();
          },
          onCancel: hideModal,
        });
        return;
      }
    } catch {
      // Non-fatal — proceed if duplicate check fails
    }

    // Pre-check vs server's bale availability so we surface a clear UI message
    // BEFORE the operator signs. Best-effort: skipped offline and on fetch
    // errors — the backend is still the source of truth and will reject.
    if (isOnline) {
      try {
        const availability = await mobileApiClient.get<{
          produced: number;
          loaded: number;
          remaining: number;
        }>(`/api/v1/parcels/${snapshotParcelId}/bale-availability`);
        const remaining = Number(availability.remaining ?? 0);

        if (remaining <= 0) {
          showModal({
            type: 'warning',
            title: t('loader.loadBales.modalParcelFullyLoadedTitle'),
            message: t('loader.loadBales.modalParcelFullyLoadedMessage'),
            confirmText: t('loader.loadBales.modalUnderstood'),
            onConfirm: hideModal,
          });
          return;
        }
        if (baleCount > remaining) {
          showModal({
            type: 'warning',
            title: t('loader.loadBales.modalParcelCountExceedsTitle'),
            message: t('loader.loadBales.modalParcelCountExceedsMessage', { remaining }),
            confirmText: t('loader.loadBales.modalUnderstood'),
            onConfirm: hideModal,
          });
          return;
        }
        if (baleCount > fullTruckCount) {
          showModal({
            type: 'warning',
            title: t('loader.loadBales.modalTruckCapacityTitle'),
            message: t('loader.loadBales.modalTruckCapacityMessage', {
              maxBales: fullTruckCount,
            }),
            confirmText: t('loader.loadBales.modalUnderstood'),
            onConfirm: hideModal,
          });
          return;
        }
      } catch {
        // Network/auth glitch — let the server-side validation reject if needed.
      }
    }

    proceedToFinish();
  }, [
    proceedToFinish,
    targetIsDepot,
    baleCount,
    truckId,
    snapshotParcelId,
    isOnline,
    fullTruckCount,
    showModal,
    hideModal,
    t,
  ]);

  const handleRegisterPress = useCallback(async () => {
    // Hard gate: must be provably on the field the bales are attributed to.
    // Auxiliary loads bypass this entirely — the external truck arrives wherever;
    // proximity is irrelevant and must never block the operator.
    if (!bypassFieldGate && !inField) {
      if (awayFromField) {
        // GPS proves the loader is too far from the field/depot (already past
        // the accuracy-adaptive tolerance computed in useCurrentLoaderParcel).
        showModal({
          type: 'warning',
          title: t('loader.loadBales.modalNotInFieldTitle'),
          message: t('loader.loadBales.modalNotInFieldMessage', {
            parcelName: targetName ?? 'selectat',
            distance: parcel.distanceM ?? 0,
          }),
          confirmText: t('loader.loadBales.modalUnderstood'),
          onConfirm: hideModal,
        });
      } else if (parcel.gpsState === 'unavailable') {
        // Genuinely no GPS fix (denied / timed out) — nothing to verify
        // against, online or offline. This is the one case that stays hard-
        // blocked per product decision: unverifiable-but-we-have-a-fix
        // degrades below; unverifiable-with-no-fix-at-all does not.
        showModal({
          type: 'warning',
          title: t('loader.loadBales.modalPositionUnconfirmedTitle'),
          message: t('loader.loadBales.modalPositionUnconfirmedMessage'),
          confirmText: t('loader.loadBales.modalRetryGps'),
          cancelText: t('loader.loadBales.modalCancel'),
          onConfirm: () => {
            hideModal();
            parcel.refresh();
          },
          onCancel: hideModal,
        });
      } else {
        // Still acquiring a fix — ask the operator to wait.
        showModal({
          type: 'warning',
          title: t('loader.loadBales.modalDeterminingPositionTitle'),
          message: t('loader.loadBales.modalDeterminingPositionMessage'),
          confirmText: t('loader.loadBales.modalUnderstood'),
          onConfirm: hideModal,
        });
      }
      return;
    }

    // The gate passed because the position is genuinely unverifiable (a GPS
    // fix exists, but the field's geometry isn't cached — offline, or not
    // yet synced) rather than because this is an auxiliary load or a
    // no-geometry depot (both already-legitimate silent bypasses). Ask once,
    // explicitly, before writing anything — never a silent bypass — and flag
    // the eventual bale_load as unverified so it surfaces for review.
    if (unverifiedBypass) {
      showModal({
        type: 'warning',
        title: t('loader.loadBales.modalUnverifiableTitle'),
        message: t('loader.loadBales.modalUnverifiableMessage', {
          parcelName: targetName ?? 'selectat',
        }),
        confirmText: t('loader.loadBales.modalUnverifiableConfirm'),
        cancelText: t('loader.loadBales.modalUnverifiableCancel'),
        onConfirm: () => {
          hideModal();
          setLocationUnverified(true);
          void runPreflightAndProceed();
        },
        onCancel: hideModal,
      });
      return;
    }

    setLocationUnverified(false);
    await runPreflightAndProceed();
  }, [
    bypassFieldGate,
    inField,
    awayFromField,
    unverifiedBypass,
    targetName,
    parcel.distanceM,
    parcel.gpsState,
    parcel.refresh,
    runPreflightAndProceed,
    showModal,
    hideModal,
    t,
  ]);

  /**
   * Register the load, then attach the CMR scan if this is an auxiliary load.
   *
   * Both finish paths land here: own-fleet passes `loaderSignature` (the specimen
   * URL), aux passes `cmr` (a PDF already built on-device). Exactly one is set.
   *
   * `loaderSignature` is optional in the server's Zod schema, so an aux load simply
   * omits it and `trips.loader_signature_url` stays null.
   *
   * Returns false if a guard refused the submit before anything was written, so the
   * caller can put its own screen back into an interactive state.
   */
  const submitLoad = useCallback(
    async (opts: {
      loaderSignature?: string;
      cmr?: { uri: string; pageCount: number; scanId: string };
    }): Promise<boolean> => {
      const { loaderSignature, cmr } = opts;
      if (!userId || !assignedMachineId || !truckId) return false;
      // Use the snapshotted target — immune to background refresh changing it.
      if (targetIsDepot ? !snapshotDepotId : !snapshotParcelId) return false;

      // Depot loads are ONLINE ONLY this iteration — the offline depot sync path
      // (SQLite parity + queue) is out of scope. Block with a clear message
      // rather than silently enqueuing a mutation that can't be replayed.
      if (targetIsDepot && !isOnline) {
        Alert.alert(
          t('loader.loadBales.depotRequiresConnectionTitle'),
          t('loader.loadBales.depotRequiresConnectionMessage'),
        );
        return false;
      }

      setSaving(true);
      try {
        if (!idempotencyKeyRef.current) {
          idempotencyKeyRef.current = generateUuid();
        }
        const idempotencyKey = idempotencyKeyRef.current;
        const gps = gpsRef.current;
        const payload = {
          truckId,
          loaderMachineId: assignedMachineId,
          // Exactly one source: a depot load sends sourceDepotId, a field load parcelId.
          ...(targetIsDepot ? { sourceDepotId: snapshotDepotId } : { parcelId: snapshotParcelId }),
          baleCount,
          gpsLat: gps?.lat,
          gpsLon: gps?.lon,
          idempotencyKey,
          ...(loaderSignature ? { loaderSignature } : {}),
          // Server-side field is additive (Zod strips unknown keys on an older
          // backend, so this is safe to send unconditionally ahead of that
          // deploy — see migration 00094). Only ever true when the operator
          // explicitly confirmed the unverified-position modal.
          ...(locationUnverified ? { locationUnverified: true } : {}),
        };
        if (locationUnverified) {
          mobileLogger.warn('register-load: geofence unverified, operator confirmed', {
            truckId,
            parcelId: targetIsDepot ? null : snapshotParcelId,
            depotId: targetIsDepot ? snapshotDepotId : null,
          });
        }

        if (isOnline) {
          const result = await mobileApiClient.post<RegisterLoadResponse>(
            '/api/v1/trips/register-load',
            payload,
          );
          // Depot loads skip the local optimistic mirror — the local bale_loads /
          // trips tables require a parcel_id (NOT NULL) that a depot load lacks.
          // The query invalidations below refetch the authoritative server state.
          if (!targetIsDepot && snapshotParcelId) {
            await applyOptimistic({
              baleLoadId: result.baleLoadId,
              tripId: result.trip.id,
              // Register-load lands every trip on `loaded` (aux trips then
              // auto-complete server-side a few minutes later).
              tripStatus: (result.trip.status as string) ?? 'loaded',
              truckId,
              parcelId: snapshotParcelId,
              loaderMachineId: assignedMachineId,
              operatorId: userId,
              baleCount,
              gps,
              locationUnverified,
            });
          }
          mobileLogger.flow('Loader register-load: online success', {
            tripId: result.trip.id,
            baleLoadId: result.baleLoadId,
            created: result.created,
            source: targetIsDepot ? 'depot' : 'parcel',
          });

          if (cmr) {
            // The load is already registered at this point, so a failed upload must
            // never fail the whole operation — queue it and let the sync loop retry.
            try {
              await uploadCmrScan(result.trip.id, cmr.uri, cmr.pageCount, cmr.scanId);
              await deleteLocalCmrPdf(cmr.uri);
            } catch {
              await enqueueCmrScan(result.trip.id, cmr, `register_load_${idempotencyKey}`);
              mobileLogger.flow('CMR scan upload failed online, queued for retry', {
                tripId: result.trip.id,
              });
            }
          }
        } else if (snapshotParcelId) {
          // Offline path is parcel-only — depot loads are blocked above when
          // offline, so a snapshotParcelId is always present here.
          const localTripId = `local:${truckId}`;
          await applyOptimistic({
            baleLoadId: idempotencyKey,
            tripId: localTripId,
            tripStatus: 'loaded',
            truckId,
            parcelId: snapshotParcelId,
            loaderMachineId: assignedMachineId,
            operatorId: userId,
            baleCount,
            gps,
            locationUnverified,
          });
          const db = await getDatabase();
          const queue = new SyncQueueRepo(db);
          await queue.enqueue({
            entityType: 'register_load',
            entityId: idempotencyKey,
            // 'insert', not 'register': sync_queue has CHECK (action IN
            // ('insert','update','delete')), and SQLite enforces it — an invalid
            // action makes enqueue() throw, so the load was never actually queued.
            action: 'insert',
            payload,
            idempotencyKey: `register_load_${idempotencyKey}`,
          });
          mobileLogger.flow('Loader register-load: offline queued', { idempotencyKey });

          // Enqueued AFTER the register_load so the FIFO dequeue sends them in that
          // order. The aux trip already exists server-side (the dispatcher's loader
          // assignment created it), so the scan can never be orphaned by a
          // register-load that hasn't landed yet — auxTripId addresses it directly.
          if (cmr && auxTripId) {
            await enqueueCmrScan(auxTripId, cmr, `register_load_${idempotencyKey}`);
          }
        }

        void queryClient.invalidateQueries({ queryKey: ['bale-loads', 'my', userId] });
        void queryClient.invalidateQueries({ queryKey: ['trips-to-load', userId] });
        void queryClient.invalidateQueries({ queryKey: ['trips', 'active'] });
        void queryClient.invalidateQueries({ queryKey: operatorStatsQueryKey(userId) });

        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        idempotencyKeyRef.current = null;
        setSaved(true);
        setTimeout(() => router.back(), 2500);
        return true;
      } catch (err) {
        mobileLogger.error('Loader register-load failed', {
          truckId,
          err: err instanceof Error ? { message: err.message } : err,
        });
        // Back to whichever finish screen this came from, with the work intact:
        // the scanned pages survive so the operator can just retry the submit.
        setShowSignature(false);
        setCmrStep(cmr ? 'preview' : null);

        // Surface structured business-rule errors with the exact numbers the
        // server reported, so the operator sees how many bales actually remain
        // or what the truck capacity is — not just a generic "Eroare".
        if (err instanceof ApiError && err.data && typeof err.data === 'object') {
          const body = err.data as {
            error?: string;
            message?: string;
            remaining?: number;
            truckCap?: number;
          };
          if (body.error === 'bale_count_exceeds_remaining') {
            Alert.alert(
              t('loader.loadBales.alertParcelCountExceedsTitle'),
              body.message ??
                t('loader.loadBales.alertParcelCountExceedsFallback', {
                  remaining: body.remaining ?? 0,
                }),
            );
            return false;
          }
          if (body.error === 'parcel_fully_loaded') {
            Alert.alert(
              t('loader.loadBales.alertParcelFullyLoadedTitle'),
              body.message ?? t('loader.loadBales.alertParcelFullyLoadedFallback'),
            );
            return false;
          }
          if (body.error === 'bale_count_exceeds_truck_capacity') {
            Alert.alert(
              t('loader.loadBales.alertTruckCapacityTitle'),
              body.message ??
                t('loader.loadBales.alertTruckCapacityFallback', {
                  truckCap: body.truckCap ?? fullTruckCount,
                }),
            );
            return false;
          }
        }

        Alert.alert(
          t('loader.loadBales.alertErrorTitle'),
          err instanceof Error ? err.message : t('loader.loadBales.alertErrorFallbackMessage'),
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [
      userId,
      assignedMachineId,
      truckId,
      targetIsDepot,
      snapshotDepotId,
      snapshotParcelId,
      baleCount,
      isAuxiliary,
      auxTripId,
      isOnline,
      locationUnverified,
      queryClient,
      t,
    ],
  );

  /**
   * Open the document scanner and append whatever pages come back.
   *
   * If the ML Kit module isn't there (Play Services hasn't fetched it and the phone
   * is offline — the exact situation a loader in a field is in), fall back to a
   * plain camera shot. No auto-crop, but the operator is never trapped: the scan is
   * mandatory, so a hard failure here would mean an un-registerable load.
   */
  const handleScanPages = useCallback(async () => {
    setScanning(true);
    try {
      const pages = await scanCmrPages();
      if (pages.length > 0) {
        setCmrPages((prev) => [...prev, ...pages]);
        setCmrStep('preview');
      }
    } catch (err) {
      if (!(err instanceof ScannerUnavailableError)) throw err;
      Alert.alert(
        t('loader.loadBales.cmrScanUnavailableTitle'),
        t('loader.loadBales.cmrScanUnavailableMessage'),
        [
          { text: t('loader.loadBales.modalCancel'), style: 'cancel' },
          {
            text: t('loader.loadBales.cmrScanFallbackPhotoButton'),
            onPress: () => {
              void (async () => {
                const uri = await captureCmrPageWithCamera();
                if (uri) {
                  setCmrPages((prev) => [...prev, uri]);
                  setCmrStep('preview');
                }
              })();
            },
          },
        ],
      );
    } finally {
      setScanning(false);
    }
  }, [t]);

  const handleRemoveCmrPage = useCallback((index: number) => {
    setCmrPages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /**
   * Build the PDF, then submit. The PDF is built BEFORE anything is written, so a
   * scanner or render failure leaves no registered load without a CMR — the
   * operator stays on the preview with their pages and can just retry.
   */
  const handleCmrConfirm = useCallback(async () => {
    if (cmrPages.length === 0) return;

    // Offline we can only address the scan by the trip id carried in on the route.
    // Without it the PDF would have nowhere to go, so refuse rather than register a
    // load whose CMR can never be delivered.
    if (!isOnline && !auxTripId) {
      Alert.alert(
        t('loader.loadBales.cmrScanNoTripTitle'),
        t('loader.loadBales.cmrScanNoTripMessage'),
      );
      return;
    }

    setCmrStep('saving');
    setSaving(true);
    let pdf: { uri: string; pageCount: number; scanId: string };
    try {
      pdf = await buildCmrPdf(cmrPages, auxTripId ?? truckId ?? 'unknown');
    } catch (err) {
      mobileLogger.error('CMR scan PDF build failed', {
        err: err instanceof Error ? { message: err.message } : err,
      });
      setSaving(false);
      setCmrStep('preview');
      Alert.alert(
        t('loader.loadBales.cmrScanPdfFailedTitle'),
        t('loader.loadBales.cmrScanPdfFailedMessage'),
      );
      return;
    }

    // A guard inside submitLoad can refuse before writing anything (an aux truck
    // loaded from a depot while offline, say). It alerts and returns false — put the
    // screen back into an interactive state instead of stranding it on 'saving'.
    const submitted = await submitLoad({ cmr: pdf });
    if (submitted) {
      // The pages are now captured in the PDF (uploaded, or queued for retry), so
      // drop the source photos — otherwise each load leaves a stack of
      // transport-document images (driver name, plates, signatures) in app
      // storage for good. The PDF itself is cleaned up by its own upload path.
      await deleteLocalCmrImages(cmrPages);
      setCmrPages([]);
    } else {
      setSaving(false);
      setCmrStep('preview');
    }
  }, [cmrPages, isOnline, auxTripId, truckId, submitLoad, t]);

  const truckLabel = truck
    ? (truck.registrationPlate ?? truck.internalCode)
    : truckId
      ? t('loader.loadBales.truckFallbackLoading')
      : t('loader.loadBales.truckFallbackUnknown');

  if (saved) {
    Animated.spring(successScale, {
      toValue: 1,
      friction: 6,
      tension: 120,
      useNativeDriver: true,
    }).start();
    return (
      <View style={styles.outerContainer}>
        <ScreenHeader title={t('loader.loadBales.successScreenTitle')} />
        <View style={[styles.body, styles.centered]}>
          <Animated.View style={{ transform: [{ scale: successScale }] }}>
            <MaterialCommunityIcons name="check-circle" size={72} color={colors.primary} />
          </Animated.View>
          <Text style={styles.successText}>{t('loader.loadBales.successText')}</Text>
          <Text style={styles.successSubtext}>{t('loader.loadBales.successSubtext')}</Text>
        </View>
      </View>
    );
  }

  // ── CMR scan (auxiliary loads only) ───────────────────────────────────────
  // Replaces the specimen signature for aux: what matters for an external
  // transporter is the paper CMR they carry, not a rubber-stamped signature.
  if (cmrStep) {
    const busy = saving || cmrStep === 'saving';
    return (
      <View style={styles.outerContainer}>
        <ScreenHeader title={t('loader.loadBales.cmrScanScreenTitle')} />
        <ScrollView style={[styles.body, { flex: 1 }]} contentContainerStyle={styles.sigContent}>
          <View style={styles.sigHeader}>
            <MaterialCommunityIcons name="file-document-outline" size={20} color={colors.primary} />
            <Text style={styles.sigTitle}>{t('loader.loadBales.cmrScanTitle')}</Text>
          </View>
          <Text style={styles.sigHint}>
            {t('loader.loadBales.cmrScanHint', { baleCount, truckLabel: truckLabel ?? '' })}
          </Text>

          {cmrPages.length > 0 && (
            <>
              <Text style={styles.cmrPagesLabel}>
                {t('loader.loadBales.cmrScanPagesLabel', { count: cmrPages.length })}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {cmrPages.map((uri, index) => (
                  <View key={`${uri}-${index}`} style={styles.cmrThumbWrap}>
                    <Image source={{ uri }} style={styles.cmrThumb} resizeMode="cover" />
                    {!busy && (
                      <TouchableOpacity
                        style={styles.cmrThumbRemove}
                        onPress={() => handleRemoveCmrPage(index)}
                        accessibilityLabel={t('loader.loadBales.cmrScanDeletePage')}
                      >
                        <MaterialCommunityIcons name="close" size={16} color="#fff" />
                      </TouchableOpacity>
                    )}
                    <Text style={styles.cmrThumbIndex}>{index + 1}</Text>
                  </View>
                ))}
              </ScrollView>
            </>
          )}

          {busy ? (
            <Text style={styles.cmrBusy}>{t('loader.loadBales.cmrScanBuildingPdf')}</Text>
          ) : (
            <>
              <BigButton
                title={
                  cmrPages.length === 0
                    ? t('loader.loadBales.cmrScanButton')
                    : t('loader.loadBales.cmrScanAddPage')
                }
                onPress={() => void handleScanPages()}
                disabled={scanning}
                variant={cmrPages.length === 0 ? 'primary' : 'outline'}
              />
              {/* The mandatory gate: no path out of here with zero pages. */}
              {cmrPages.length > 0 && (
                <BigButton
                  title={t('loader.loadBales.cmrScanConfirmButton')}
                  onPress={() => void handleCmrConfirm()}
                />
              )}
              <BigButton
                title={t('loader.loadBales.giveUpButton')}
                onPress={() => {
                  setCmrStep(null);
                  setCmrPages([]);
                }}
                variant="outline"
              />
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  if (showSignature) {
    return (
      <View style={styles.outerContainer}>
        <ScreenHeader title={t('loader.loadBales.signatureScreenTitle')} />
        <ScrollView style={[styles.body, { flex: 1 }]} contentContainerStyle={styles.sigContent}>
          <View style={styles.sigHeader}>
            <MaterialCommunityIcons name="pen" size={20} color={colors.primary} />
            <Text style={styles.sigTitle}>{t('loader.loadBales.signatureTitle')}</Text>
          </View>
          <Text style={styles.sigHint}>
            {t('loader.loadBales.signatureHint', { baleCount, truckLabel: truckLabel ?? '' })}
          </Text>
          <View style={styles.specimenCard}>
            <Text style={styles.specimenLabel}>{t('loader.loadBales.specimenLabel')}</Text>
            {signatureSpecimenUrl ? (
              <Image
                source={{ uri: resolveApiUrl(signatureSpecimenUrl) }}
                style={styles.specimenImage}
                resizeMode="contain"
              />
            ) : (
              <Text style={styles.specimenMissing}>{t('loader.loadBales.specimenMissing')}</Text>
            )}
          </View>
          <BigButton
            title={t('loader.loadBales.signWithSpecimenButton')}
            onPress={() => {
              if (!signatureSpecimenUrl) {
                Alert.alert(
                  t('loader.loadBales.specimenMissingAlertTitle'),
                  t('loader.loadBales.specimenMissingAlertMessage'),
                  [
                    {
                      text: t('loader.loadBales.specimenMissingAlertAction'),
                      onPress: () => router.replace('/specimen-capture?mode=redo'),
                    },
                  ],
                );
                return;
              }
              void submitLoad({ loaderSignature: signatureSpecimenUrl });
            }}
            disabled={saving}
          />
          {saving ? null : (
            <BigButton
              title={t('loader.loadBales.giveUpButton')}
              onPress={() => setShowSignature(false)}
              variant="outline"
            />
          )}
        </ScrollView>
      </View>
    );
  }

  // parcelReady is based on the snapshot so it stays stable once set. Covers
  // both a field parcel and a depot target (targetReady).
  const parcelReady = targetReady;

  return (
    <View style={styles.outerContainer}>
      <ScreenHeader title={t('loader.loadBales.screenTitle')}>
        <View style={styles.headerMeta}>
          <MaterialCommunityIcons name="truck" size={14} color="rgba(255,255,255,0.85)" />
          <Text style={styles.headerMetaText}>{truckLabel}</Text>
        </View>
        <View style={styles.headerMeta}>
          <MaterialCommunityIcons
            name={
              gpsStatus === 'ok'
                ? 'crosshairs-gps'
                : gpsStatus === 'loading'
                  ? 'loading'
                  : 'crosshairs'
            }
            size={14}
            color="rgba(255,255,255,0.7)"
          />
          <Text style={styles.headerMetaText}>
            {gpsStatus === 'ok'
              ? t('loader.loadBales.gpsActive')
              : gpsStatus === 'loading'
                ? t('loader.loadBales.gpsLocating')
                : t('loader.loadBales.gpsNone')}
          </Text>
        </View>
      </ScreenHeader>

      <ScrollView style={styles.body} contentContainerStyle={styles.content}>
        {!isOnline ? (
          <View style={styles.offlineBanner}>
            <MaterialCommunityIcons name="cloud-off-outline" size={16} color="#8D6E63" />
            <View style={{ flex: 1 }}>
              <Text style={styles.offlineBannerTitle}>
                {t('loader.loadBales.offlineBannerTitle')}
              </Text>
              <Text style={styles.offlineBannerBody}>
                {t('loader.loadBales.offlineBannerBody')}
              </Text>
            </View>
          </View>
        ) : null}
        <View style={styles.parcelCard}>
          <MaterialCommunityIcons
            name={targetIsDepot ? 'warehouse' : 'map-marker-radius'}
            size={20}
            color={parcelReady ? colors.primary : '#B7791F'}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.parcelLabel}>
              {targetIsDepot
                ? t('loader.loadBales.depotCardLabel')
                : t('loader.loadBales.parcelCardLabel')}
            </Text>
            <Text style={styles.parcelName} numberOfLines={1} ellipsizeMode="tail">
              {targetIsDepot
                ? (snapshotDepotName ??
                  (parcel.status === 'loading'
                    ? t('loader.loadBales.parcelIdentifying')
                    : t('loader.loadBales.parcelUnconfirmedFallback')))
                : snapshotParcelName
                  ? snapshotParcelName
                  : parcel.status === 'loading'
                    ? t('loader.loadBales.parcelIdentifying')
                    : t('loader.loadBales.parcelUnconfirmedFallback')}
            </Text>
            {parcelReady ? (
              parcel.presence === 'inside' ? (
                <Text style={styles.presenceInside}>{t('loader.loadBales.presenceInside')}</Text>
              ) : awayFromField ? (
                <Text style={styles.presenceOutside}>
                  {t('loader.loadBales.presenceAwayFromField', {
                    distance: parcel.distanceM ?? 0,
                  })}
                </Text>
              ) : parcel.presence === 'outside' ? (
                <Text style={styles.presenceNear}>
                  {t('loader.loadBales.presenceNear', { distance: parcel.distanceM ?? 0 })}
                </Text>
              ) : parcel.gpsState === 'unavailable' ? (
                <Text style={styles.presenceOutside}>
                  {t('loader.loadBales.presenceGpsUnavailable')}
                </Text>
              ) : parcel.presenceReason === 'no_geometry' ? (
                // We have a GPS fix, but this field's boundary isn't cached
                // (offline, not yet synced) — distinct from "still locating".
                <Text style={styles.presenceUnknown}>
                  {t('loader.loadBales.presenceUnverifiableNoGeometry')}
                </Text>
              ) : parcel.presenceReason === 'no_data' ? (
                <Text style={styles.presenceUnknown}>
                  {t('loader.loadBales.presenceUnverifiableOffline')}
                </Text>
              ) : (
                <Text style={styles.presenceUnknown}>
                  {t('loader.loadBales.presenceVerifying')}
                </Text>
              )
            ) : null}
          </View>
        </View>

        {/*
          The field couldn't be resolved. This used to be an alert whose only
          button called router.back(), telling the operator to "confirm the
          field on the home screen" — an action that screen does not offer,
          because resolution is GPS-only. Rendered in place instead: the
          resolver keeps re-sampling GPS every 30s, so walking onto the field
          heals this with no interaction at all.
        */}
        {!isAuxiliary && !parcelReady && parcel.status !== 'loading' ? (
          <View style={styles.unresolvedCard}>
            <View style={styles.unresolvedHeader}>
              {parcel.status === 'needs_start' && parcel.gpsState === 'locating' ? (
                <ActivityIndicator size="small" color="#B7791F" />
              ) : (
                <MaterialCommunityIcons
                  name={
                    parcel.status === 'unavailable'
                      ? 'map-marker-off'
                      : parcel.status === 'awaiting_geometry'
                        ? 'cloud-download-outline'
                        : 'map-marker-alert'
                  }
                  size={20}
                  color="#B7791F"
                />
              )}
              <Text style={styles.unresolvedTitle}>
                {parcel.status === 'unavailable'
                  ? t('loader.loadBales.fieldStateNoAssignmentTitle')
                  : parcel.status === 'awaiting_geometry'
                    ? t('loader.loadBales.fieldStateMissingGeometryTitle')
                    : parcel.gpsState === 'locating'
                      ? t('loader.loadBales.fieldStateLocatingTitle')
                      : parcel.gpsState === 'unavailable'
                        ? t('loader.loadBales.fieldStateGpsOffTitle')
                        : t('loader.loadBales.fieldStateOutsideTitle')}
              </Text>
            </View>

            <Text style={styles.unresolvedBody}>
              {parcel.status === 'unavailable'
                ? t('loader.loadBales.fieldStateNoAssignmentBody')
                : parcel.status === 'awaiting_geometry'
                  ? isOnline
                    ? t('loader.loadBales.fieldStateMissingGeometryBody')
                    : t('loader.loadBales.fieldStateMissingGeometryOfflineBody')
                  : parcel.gpsState === 'locating'
                    ? t('loader.loadBales.fieldStateLocatingBody')
                    : parcel.gpsState === 'unavailable'
                      ? t('loader.loadBales.fieldStateGpsOffBody')
                      : t('loader.loadBales.fieldStateOutsideBody')}
            </Text>

            {/*
              Read-only, deliberately. Field attribution is decided by GPS and
              nothing else — making these tappable is what let bales be logged
              against the wrong field in the first place.
            */}
            {parcel.candidates.length > 0 ? (
              <View style={styles.assignedList}>
                <Text style={styles.assignedListTitle}>
                  {t('loader.loadBales.fieldStateAssignedListTitle')}
                </Text>
                {parcel.candidates.map((task) => (
                  <Text key={task.id} style={styles.assignedListItem} numberOfLines={1}>
                    {'•  '}
                    {task.parcelName ?? task.parcelCode ?? ''}
                  </Text>
                ))}
              </View>
            ) : null}

            {parcel.status === 'awaiting_geometry' && isOnline ? (
              <TouchableOpacity
                style={styles.unresolvedAction}
                activeOpacity={0.85}
                disabled={parcel.geometryRepair.isRepairing}
                onPress={() => parcel.geometryRepair.retry()}
              >
                <MaterialCommunityIcons name="cloud-download-outline" size={18} color="#fff" />
                <Text style={styles.unresolvedActionText}>
                  {parcel.geometryRepair.isRepairing
                    ? t('loader.loadBales.fieldStateDownloadingOutlines')
                    : t('loader.loadBales.fieldStateDownloadOutlines')}
                </Text>
              </TouchableOpacity>
            ) : parcel.status !== 'awaiting_geometry' ? (
              <TouchableOpacity
                style={styles.unresolvedAction}
                activeOpacity={0.85}
                onPress={() => parcel.refresh()}
              >
                <MaterialCommunityIcons name="crosshairs-gps" size={18} color="#fff" />
                <Text style={styles.unresolvedActionText}>
                  {t('loader.loadBales.fieldStateRetryGps')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.fieldLabel}>{t('loader.loadBales.baleCountFieldLabel')}</Text>

        <TouchableOpacity
          style={styles.fullTruckButton}
          activeOpacity={0.85}
          onPress={() => setBaleCountStr(String(fullTruckCount))}
        >
          <MaterialCommunityIcons name="truck-fast" size={20} color={colors.primary} />
          <Text style={styles.fullTruckText} numberOfLines={1} ellipsizeMode="tail">
            {t('loader.loadBales.fullTruckButton', { count: fullTruckCount })}
          </Text>
        </TouchableOpacity>

        <NumericPad value={baleCountStr} onChange={setBaleCountStr} decimal={false} />

        <BigButton
          title={t('loader.loadBales.registerButton')}
          onPress={() => void handleRegisterPress()}
          // Auxiliary loads (and depots with no geometry) bypass the in-target
          // geofence gate — but still require a resolved target.
          disabled={baleCount <= 0 || !parcelReady || (!bypassFieldGate && !inField)}
        />
        {!bypassFieldGate && parcelReady && !inField ? (
          <Text style={styles.gateHint}>
            {awayFromField
              ? t('loader.loadBales.gateHintAwayFromField', { distance: parcel.distanceM ?? 0 })
              : parcel.gpsState === 'unavailable'
                ? t('loader.loadBales.gateHintGpsUnavailable')
                : t('loader.loadBales.gateHintWaitingGps')}
          </Text>
        ) : null}
        {unverifiedBypass && parcelReady ? (
          // The button above is enabled — explain why, so the confirm modal
          // that follows a tap isn't a surprise.
          <Text style={styles.gateHint}>{t('loader.loadBales.gateHintUnverifiable')}</Text>
        ) : null}
        {isAuxiliary && !parcelReady ? (
          <Text style={styles.gateHint}>
            {parcel.gpsState === 'unavailable'
              ? t('loader.loadBales.gateHintAuxGpsUnavailable')
              : t('loader.loadBales.gateHintAuxDeterminingField')}
          </Text>
        ) : null}
        <BigButton
          title={t('loader.loadBales.cancelButton')}
          onPress={() => router.back()}
          variant="outline"
        />
      </ScrollView>
      <AppModal {...modalProps} />
    </View>
  );
}

interface OptimisticInput {
  baleLoadId: string;
  tripId: string;
  tripStatus: string;
  truckId: string;
  parcelId: string;
  loaderMachineId: string;
  operatorId: string;
  baleCount: number;
  gps: { lat: number; lon: number } | null;
  /** See migration 00094 — bale_loads.location_unverified. */
  locationUnverified: boolean;
}

/**
 * Mirror the register-load result locally. Bale_load goes into the local
 * bale_loads table; the trip is upserted in the local trips table so the
 * driver's "Cursele Mele" list can show the new trip immediately if this
 * device happens to be both loader and driver, and so the loader's own
 * "Camioane de încărcat" list can subtract the already-loaded count.
 */
async function applyOptimistic(input: OptimisticInput): Promise<void> {
  const db = await getDatabase();
  const baleLoadsRepo = new BaleLoadsRepo(db);
  const tripsRepo = new TripsRepo(db);
  const now = new Date().toISOString();

  await baleLoadsRepo.upsert({
    id: input.baleLoadId,
    trip_id: input.tripId,
    parcel_id: input.parcelId,
    loader_id: input.loaderMachineId,
    operator_id: input.operatorId,
    bale_count: input.baleCount,
    loaded_at: now,
    gps_lat: input.gps?.lat ?? null,
    gps_lon: input.gps?.lon ?? null,
    notes: null,
    location_unverified: input.locationUnverified ? 1 : 0,
    created_at: now,
    updated_at: now,
    server_version: 0,
  });

  // Best-effort optimistic trip — only relevant for online success path
  // because in offline mode we don't yet know the real trip id.
  if (!input.tripId.startsWith('local:')) {
    try {
      await tripsRepo.upsert({
        id: input.tripId,
        trip_number: null,
        status: input.tripStatus,
        source_parcel_id: input.parcelId,
        destination_id: null,
        destination_name: null,
        destination_address: null,
        truck_id: input.truckId,
        driver_id: null,
        loader_id: input.loaderMachineId,
        loader_operator_id: input.operatorId,
        bale_count: input.baleCount,
        gross_weight_kg: null,
        tare_weight_kg: null,
        receiver_name: null,
        loading_started_at: now,
        loading_completed_at: now,
        departure_at: null,
        arrival_at: null,
        delivered_at: null,
        completed_at: null,
        depot_operator_id: null,
        depot_confirmed_at: null,
        depot_operator_signature_url: null,
        depot_unload_started_at: null,
        scale_broken: null,
        destination_has_operator: null,
        destination_operator_name: null,
        destination_operator_phone: null,
        acknowledged_at: null,
        has_pending_transition: 0,
        delivery_step_progress: null,
        delivery_draft_json: null,
        parent_trip_id: null,
        iteration_index: 1,
        created_at: now,
        updated_at: now,
        server_version: 0,
      });
    } catch (err) {
      mobileLogger.warn('applyOptimistic: trips upsert failed (non-fatal)', {
        tripId: input.tripId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: '#0A5C36' },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerMetaText: { fontSize: 13, color: 'rgba(255, 255, 255, 0.85)' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: { justifyContent: 'center', alignItems: 'center', gap: 12, paddingTop: 60 },
  content: { padding: 16, gap: 12 },
  offlineBanner: {
    backgroundColor: 'rgba(141,110,99,0.12)',
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  offlineBannerTitle: { fontSize: 12, fontWeight: '700', color: '#5D4037' },
  offlineBannerBody: { fontSize: 11, color: '#8D6E63', marginTop: 1 },
  parcelCard: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  parcelLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.tertiary,
    textTransform: 'uppercase',
  },
  parcelName: { fontSize: 16, fontWeight: '700', color: '#0A5C36', marginTop: 2 },
  presenceInside: { fontSize: 12, fontWeight: '700', color: '#0A5C36', marginTop: 3 },
  presenceNear: { fontSize: 12, fontWeight: '600', color: '#B7791F', marginTop: 3 },
  presenceOutside: { fontSize: 12, fontWeight: '700', color: '#991B1B', marginTop: 3 },
  presenceUnknown: { fontSize: 12, color: '#8D6E63', fontStyle: 'italic', marginTop: 3 },
  gateHint: { fontSize: 12, color: '#991B1B', textAlign: 'center', marginTop: -4 },
  unresolvedCard: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  unresolvedHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unresolvedTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: '#92400E' },
  unresolvedBody: { fontSize: 13, lineHeight: 19, color: '#78350F' },
  assignedList: { gap: 2 },
  assignedListTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
    textTransform: 'uppercase',
  },
  assignedListItem: { fontSize: 13, color: '#78350F' },
  unresolvedAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#B7791F',
    borderRadius: 10,
    paddingVertical: 12,
  },
  unresolvedActionText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#5D4037', marginTop: 4 },
  fullTruckButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  fullTruckText: { fontSize: 15, fontWeight: '700', color: colors.primary, flexShrink: 1 },
  successText: { fontSize: 22, fontWeight: '700', color: '#0A5C36' },
  successSubtext: { fontSize: 14, color: '#5D4037', textAlign: 'center', paddingHorizontal: 24 },
  sigHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, paddingBottom: 4 },
  sigTitle: { fontSize: 18, fontWeight: '700', color: colors.primary },
  sigHint: { fontSize: 14, color: '#5D4037', paddingHorizontal: 16, paddingBottom: 12 },
  sigContent: { padding: 16, gap: 12 },
  specimenCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  specimenLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5D4037',
    textTransform: 'uppercase',
  },
  specimenImage: {
    width: '100%',
    height: 140,
    backgroundColor: '#F9F5F2',
    borderRadius: 8,
  },
  specimenMissing: {
    fontSize: 14,
    color: '#C62828',
    paddingVertical: 24,
    textAlign: 'center',
  },
  cmrPagesLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5D4037',
    textTransform: 'uppercase',
    paddingHorizontal: 4,
  },
  cmrThumbWrap: {
    width: 110,
    height: 150,
    marginRight: 10,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F9F5F2',
    borderWidth: 1,
    borderColor: '#E0D6D0',
  },
  cmrThumb: { width: '100%', height: '100%' },
  cmrThumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cmrThumbIndex: {
    position: 'absolute',
    bottom: 4,
    left: 6,
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 3,
  },
  cmrBusy: {
    fontSize: 15,
    color: '#5D4037',
    textAlign: 'center',
    paddingVertical: 28,
  },
});
