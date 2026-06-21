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
import { useAuthStore } from '@/stores/auth-store';
import { useCurrentLoaderParcel } from '@/hooks/useCurrentLoaderParcel';
import { mobileLogger } from '@/lib/logger';
import { generateUuid } from '@/lib/uuid';
import { colors } from '@strawboss/ui-tokens';
import { operatorStatsQueryKey } from '@/components/features/stats/OperatorStats';

const GPS_TIMEOUT_MS = 15_000;
// Mirrors DEFAULT_MAX_BALES_PER_TRUCK in @strawboss/domain. Inlined (not
// imported) to keep `xstate` and other domain-only deps out of the mobile
// bundle — same pattern as useTripTransition mirroring the trip state machine.
const DEFAULT_MAX_BALES_PER_TRUCK = 33;
// A loader may only register a load while physically on the field the bales are
// attributed to. Small buffer (max 5 m) for GPS jitter right at the boundary —
// effectively requires the operator to be on the field, not merely nearby.
const LOAD_FIELD_TOLERANCE_M = 5;

type GpsStatus = 'idle' | 'loading' | 'denied' | 'unavailable' | 'ok';

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
  } = useLocalSearchParams<{
    truckId?: string | string[];
    parcelId?: string | string[];
    isAuxiliary?: string | string[];
  }>();

  // Auxiliary flag: passed from the aux truck card on the loader home.
  // When true, proximity/geofence checks are bypassed — the external truck
  // arrives wherever; the loader loads it on demand at any location.
  const isAuxiliary =
    (Array.isArray(isAuxiliaryParam) ? isAuxiliaryParam[0] : isAuxiliaryParam) === '1';

  // For auxiliary trips the parcel is pre-resolved from the trip row (passed via
  // route param). For normal trips it still comes from useCurrentLoaderParcel.
  const auxParcelId = !isAuxiliary
    ? null
    : (() => {
        const raw = Array.isArray(parcelIdParam) ? parcelIdParam[0] : parcelIdParam;
        return raw && raw.length > 0 ? raw : null;
      })();
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

  useEffect(() => {
    if (snapshotParcelId) return;
    if (isAuxiliary) {
      // Prefer the parcel the trip was created with; otherwise the auxiliary load
      // is attributed to the loader's OWN current/assigned field (the external
      // truck isn't tied to a fixed parcel — it loads wherever the loader is).
      if (auxParcelId) {
        setSnapshotParcelId(auxParcelId);
        return;
      }
      if (parcel.status === 'resolved' && parcel.parcelId) {
        setSnapshotParcelId(parcel.parcelId);
        setSnapshotParcelName(parcel.parcelName);
      }
      return;
    }
    if (parcel.status === 'resolved' && parcel.parcelId) {
      setSnapshotParcelId(parcel.parcelId);
      setSnapshotParcelName(parcel.parcelName);
    }
    // Only run when parcel resolves; snapshot is intentionally frozen after first capture.
  }, [
    isAuxiliary,
    auxParcelId,
    parcel.status,
    parcel.parcelId,
    parcel.parcelName,
    snapshotParcelId,
  ]);

  const [baleCountStr, setBaleCountStr] = useState('');
  const [saving, setSaving] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [saved, setSaved] = useState(false);
  const successScale = useRef(new Animated.Value(0.5)).current;

  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const gpsRef = useRef<{ lon: number; lat: number } | null>(null);
  // Stable across retries — sync_idempotency on the server dedupes only when
  // the same key is replayed. Regenerated only after a confirmed success.
  const idempotencyKeyRef = useRef<string | null>(null);

  const baleCount = parseInt(baleCountStr, 10) || 0;

  // In-field gate (hard). A load may only be registered when GPS *proves* the
  // loader is inside the field (or within tolerance of its boundary), so bales
  // are never attributed to a field the operator isn't standing on. Unknown
  // position (no boundary / GPS not ready / GPS denied) blocks the load — the
  // operator must get a fix first. `presence`/`distanceM`/`gpsState` come from
  // useCurrentLoaderParcel.
  const inField =
    parcel.presence === 'inside' ||
    (parcel.presence === 'outside' &&
      parcel.distanceM != null &&
      parcel.distanceM <= LOAD_FIELD_TOLERANCE_M);
  // GPS proves the loader is past the tolerance — used for the precise distance
  // copy. `unknown` is handled separately (locating vs unavailable).
  const awayFromField =
    parcel.presence === 'outside' &&
    parcel.distanceM != null &&
    parcel.distanceM > LOAD_FIELD_TOLERANCE_M;

  const truckId = truckIdFromParams(truckIdParam);
  const { data: truck } = useQuery<Machine>({
    queryKey: ['machine', truckId],
    queryFn: () => mobileApiClient.get<Machine>(`/api/v1/machines/${truckId}`),
    enabled: !!truckId,
  });

  // Bounce back if we don't have what we need (truck or resolved parcel).
  useEffect(() => {
    if (!truckId) {
      Alert.alert('Eroare', 'Niciun camion identificat.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    }
  }, [truckId]);

  useEffect(() => {
    // Auxiliary trips have their parcel pre-resolved from the route param — the
    // GPS-based parcel resolution is irrelevant and must not block or redirect.
    if (isAuxiliary) return;
    if (
      parcel.status === 'needs_start' ||
      parcel.status === 'unavailable' ||
      parcel.status === 'multiple_active'
    ) {
      // Surface the parcel prompt on home — this screen requires a resolved parcel.
      Alert.alert(
        'Teren neconfirmat',
        'Confirmă terenul activ în ecranul principal înainte de a încărca.',
        [{ text: 'Înapoi', onPress: () => router.back() }],
      );
    }
  }, [isAuxiliary, parcel.status]);

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
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
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

  // FM-5: duplicate detection — check for a recent bale_load on same (truckId, parcelId).
  // Uses snapshotParcelId directly (parcelReady = snapshotParcelId !== null, declared later).
  const handleRegisterPress = useCallback(async () => {
    // Hard gate: must be provably on the field the bales are attributed to.
    // Auxiliary loads bypass this entirely — the external truck arrives wherever;
    // proximity is irrelevant and must never block the operator.
    if (!isAuxiliary && !inField) {
      if (awayFromField) {
        // GPS proves the loader is too far from the field.
        showModal({
          type: 'warning',
          title: 'Nu ești în câmp',
          message: `Trebuie să fii pe terenul ${snapshotParcelName ?? 'selectat'} ca să încarci. Ești la ${parcel.distanceM} m de câmp — apropie-te și încearcă din nou.`,
          confirmText: 'Am înțeles',
          onConfirm: hideModal,
        });
      } else if (parcel.gpsState === 'unavailable') {
        // GPS denied / timed out / field has no boundary — can't confirm position.
        showModal({
          type: 'warning',
          title: 'Poziție neconfirmată',
          message:
            'Nu putem confirma că ești pe teren (GPS indisponibil sau locația oprită). Activează locația și încearcă din nou.',
          confirmText: 'Reîncearcă GPS',
          cancelText: 'Anulează',
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
          title: 'Se determină poziția',
          message: 'Așteaptă semnalul GPS ca să confirmăm că ești pe teren, apoi încearcă din nou.',
          confirmText: 'Am înțeles',
          onConfirm: hideModal,
        });
      }
      return;
    }
    if (baleCount <= 0 || !snapshotParcelId || !truckId) {
      setShowSignature(true);
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
          title: 'Încărcare recentă detectată',
          message: `Ai înregistrat deja ${totalBales} baloți pe acest camion și teren acum ${minutesAgo} min. Continui cu o nouă înregistrare?`,
          confirmText: 'Da, continuă',
          cancelText: 'Anulează',
          onConfirm: () => {
            hideModal();
            setShowSignature(true);
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
            title: 'Parcelă încărcată complet',
            message:
              'Pe acest teren toți baloții au fost deja încărcați. Alege alt teren sau anunță dispecerul.',
            confirmText: 'Am înțeles',
            onConfirm: hideModal,
          });
          return;
        }
        if (baleCount > remaining) {
          showModal({
            type: 'warning',
            title: 'Cantitate prea mare pentru parcelă',
            message: `Pe parcelă au mai rămas doar ${remaining} baloți disponibili. Reduceți cantitatea sau alegeți alt teren.`,
            confirmText: 'Am înțeles',
            onConfirm: hideModal,
          });
          return;
        }
        if (baleCount > fullTruckCount) {
          showModal({
            type: 'warning',
            title: 'Capacitate camion depășită',
            message: `Camionul poate transporta maxim ${fullTruckCount} baloți.`,
            confirmText: 'Am înțeles',
            onConfirm: hideModal,
          });
          return;
        }
      } catch {
        // Network/auth glitch — let the server-side validation reject if needed.
      }
    }

    setShowSignature(true);
  }, [
    isAuxiliary,
    inField,
    awayFromField,
    baleCount,
    truckId,
    snapshotParcelId,
    snapshotParcelName,
    isOnline,
    fullTruckCount,
    parcel.distanceM,
    parcel.gpsState,
    parcel.refresh,
    showModal,
    hideModal,
  ]);

  const handleSignatureConfirm = useCallback(
    async (loaderSignature: string) => {
      if (!userId || !assignedMachineId || !truckId) return;
      // Use the snapshot parcelId — immune to background refresh changing the active parcel.
      if (!snapshotParcelId) return;

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
          parcelId: snapshotParcelId,
          baleCount,
          gpsLat: gps?.lat,
          gpsLon: gps?.lon,
          idempotencyKey,
          loaderSignature,
        };

        if (isOnline) {
          const result = await mobileApiClient.post<RegisterLoadResponse>(
            '/api/v1/trips/register-load',
            payload,
          );
          await applyOptimistic({
            baleLoadId: result.baleLoadId,
            tripId: result.trip.id,
            // Server collapses auxiliary trips straight to `completed`; normal → `loaded`.
            tripStatus: (result.trip.status as string) ?? (isAuxiliary ? 'completed' : 'loaded'),
            truckId,
            parcelId: snapshotParcelId,
            loaderMachineId: assignedMachineId,
            operatorId: userId,
            baleCount,
            gps,
          });
          mobileLogger.flow('Loader register-load: online success', {
            tripId: result.trip.id,
            baleLoadId: result.baleLoadId,
            created: result.created,
          });
        } else {
          const localTripId = `local:${truckId}`;
          await applyOptimistic({
            baleLoadId: idempotencyKey,
            tripId: localTripId,
            tripStatus: isAuxiliary ? 'completed' : 'loaded',
            truckId,
            parcelId: snapshotParcelId,
            loaderMachineId: assignedMachineId,
            operatorId: userId,
            baleCount,
            gps,
          });
          const db = await getDatabase();
          const queue = new SyncQueueRepo(db);
          await queue.enqueue({
            entityType: 'register_load',
            entityId: idempotencyKey,
            action: 'register',
            payload,
            idempotencyKey: `register_load_${idempotencyKey}`,
          });
          mobileLogger.flow('Loader register-load: offline queued', { idempotencyKey });
        }

        void queryClient.invalidateQueries({ queryKey: ['bale-loads', 'my', userId] });
        void queryClient.invalidateQueries({ queryKey: ['trips-to-load', userId] });
        void queryClient.invalidateQueries({ queryKey: ['trips', 'active'] });
        void queryClient.invalidateQueries({ queryKey: operatorStatsQueryKey(userId) });

        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        idempotencyKeyRef.current = null;
        setSaved(true);
        setTimeout(() => router.back(), 2500);
      } catch (err) {
        mobileLogger.error('Loader register-load failed', {
          truckId,
          err: err instanceof Error ? { message: err.message } : err,
        });
        setShowSignature(false);

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
              'Cantitate prea mare pentru parcelă',
              body.message ?? `Pe parcelă au mai rămas ${body.remaining ?? 0} baloți disponibili.`,
            );
            return;
          }
          if (body.error === 'parcel_fully_loaded') {
            Alert.alert(
              'Parcelă încărcată complet',
              body.message ?? 'Pe acest teren toți baloții au fost deja încărcați.',
            );
            return;
          }
          if (body.error === 'bale_count_exceeds_truck_capacity') {
            Alert.alert(
              'Capacitate camion depășită',
              body.message ??
                `Camionul are capacitatea maximă ${body.truckCap ?? fullTruckCount} baloți.`,
            );
            return;
          }
        }

        Alert.alert(
          'Eroare',
          err instanceof Error ? err.message : 'Nu s-a putut înregistra încărcarea.',
        );
      } finally {
        setSaving(false);
      }
    },
    [
      userId,
      assignedMachineId,
      truckId,
      snapshotParcelId,
      baleCount,
      isOnline,
      queryClient,
      inField,
      awayFromField,
      snapshotParcelName,
      parcel.distanceM,
      parcel.gpsState,
      parcel.refresh,
      showModal,
      hideModal,
    ],
  );

  const truckLabel = truck
    ? (truck.registrationPlate ?? truck.internalCode)
    : truckId
      ? '...'
      : 'Camion necunoscut';

  if (saved) {
    Animated.spring(successScale, {
      toValue: 1,
      friction: 6,
      tension: 120,
      useNativeDriver: true,
    }).start();
    return (
      <View style={styles.outerContainer}>
        <ScreenHeader title="Camion plin" />
        <View style={[styles.body, styles.centered]}>
          <Animated.View style={{ transform: [{ scale: successScale }] }}>
            <MaterialCommunityIcons name="check-circle" size={72} color={colors.primary} />
          </Animated.View>
          <Text style={styles.successText}>Înregistrat!</Text>
          <Text style={styles.successSubtext}>Cursa a fost generată pentru șofer.</Text>
        </View>
      </View>
    );
  }

  if (showSignature) {
    return (
      <View style={styles.outerContainer}>
        <ScreenHeader title="Semnătură operator" />
        <ScrollView style={[styles.body, { flex: 1 }]} contentContainerStyle={styles.sigContent}>
          <View style={styles.sigHeader}>
            <MaterialCommunityIcons name="pen" size={20} color={colors.primary} />
            <Text style={styles.sigTitle}>Semnează încărcarea</Text>
          </View>
          <Text style={styles.sigHint}>
            Confirmă că ai încărcat {baleCount} baloți în camionul {truckLabel}.
          </Text>
          <View style={styles.specimenCard}>
            <Text style={styles.specimenLabel}>Specimen semnătură</Text>
            {signatureSpecimenUrl ? (
              <Image
                source={{ uri: resolveApiUrl(signatureSpecimenUrl) }}
                style={styles.specimenImage}
                resizeMode="contain"
              />
            ) : (
              <Text style={styles.specimenMissing}>Nu ai încă un specimen.</Text>
            )}
          </View>
          <BigButton
            title="Semnează cu specimen"
            onPress={() => {
              if (!signatureSpecimenUrl) {
                Alert.alert(
                  'Specimen lipsă',
                  'Nu ai încă un specimen de semnătură. Creează unul din profil.',
                  [
                    {
                      text: 'Creează specimen',
                      onPress: () => router.replace('/specimen-capture?mode=redo'),
                    },
                  ],
                );
                return;
              }
              void handleSignatureConfirm(signatureSpecimenUrl);
            }}
            disabled={saving}
          />
          {saving ? null : (
            <BigButton title="Renunță" onPress={() => setShowSignature(false)} variant="outline" />
          )}
        </ScrollView>
      </View>
    );
  }

  // parcelReady is based on the snapshot so it stays stable once set.
  const parcelReady = snapshotParcelId !== null;

  return (
    <View style={styles.outerContainer}>
      <ScreenHeader title="Camion plin">
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
              ? 'GPS activ'
              : gpsStatus === 'loading'
                ? 'Localizare...'
                : 'Fără GPS'}
          </Text>
        </View>
      </ScreenHeader>

      <ScrollView style={styles.body} contentContainerStyle={styles.content}>
        <View style={styles.parcelCard}>
          <MaterialCommunityIcons
            name="map-marker-radius"
            size={20}
            color={parcelReady ? colors.primary : '#B7791F'}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.parcelLabel}>Teren</Text>
            <Text style={styles.parcelName} numberOfLines={1} ellipsizeMode="tail">
              {snapshotParcelName
                ? snapshotParcelName
                : parcel.status === 'loading'
                  ? 'Se identifică...'
                  : 'Neconfirmat — confirmă pe ecranul principal'}
            </Text>
            {parcelReady ? (
              parcel.presence === 'inside' ? (
                <Text style={styles.presenceInside}>● Ești în câmp</Text>
              ) : awayFromField ? (
                <Text style={styles.presenceOutside}>
                  ● La {parcel.distanceM} m de câmp — apropie-te ca să încarci
                </Text>
              ) : parcel.presence === 'outside' ? (
                <Text style={styles.presenceNear}>● Aproape de câmp ({parcel.distanceM} m)</Text>
              ) : parcel.gpsState === 'unavailable' ? (
                <Text style={styles.presenceOutside}>● GPS indisponibil — activează locația</Text>
              ) : (
                <Text style={styles.presenceUnknown}>Se verifică poziția…</Text>
              )
            ) : null}
          </View>
        </View>

        <Text style={styles.fieldLabel}>Număr baloți încărcați</Text>

        <TouchableOpacity
          style={styles.fullTruckButton}
          activeOpacity={0.85}
          onPress={() => setBaleCountStr(String(fullTruckCount))}
        >
          <MaterialCommunityIcons name="truck-fast" size={20} color={colors.primary} />
          <Text style={styles.fullTruckText} numberOfLines={1} ellipsizeMode="tail">
            Camion plin ({fullTruckCount} baloți)
          </Text>
        </TouchableOpacity>

        <NumericPad value={baleCountStr} onChange={setBaleCountStr} decimal={false} />

        <BigButton
          title="Înregistrează"
          onPress={() => void handleRegisterPress()}
          // Auxiliary loads bypass the in-field geofence gate (the external truck
          // arrives wherever) — but still require a known parcel.
          disabled={baleCount <= 0 || !parcelReady || (!isAuxiliary && !inField)}
        />
        {!isAuxiliary && parcelReady && !inField ? (
          <Text style={styles.gateHint}>
            {awayFromField
              ? `Trebuie să fii în câmp ca să încarci (${parcel.distanceM} m de teren).`
              : parcel.gpsState === 'unavailable'
                ? 'Nu putem confirma poziția — activează GPS-ul ca să încarci.'
                : 'Se așteaptă semnalul GPS ca să confirmăm că ești pe teren…'}
          </Text>
        ) : null}
        {isAuxiliary && !parcelReady ? (
          <Text style={styles.gateHint}>
            {parcel.gpsState === 'unavailable'
              ? 'Activează GPS-ul sau confirmă terenul în ecranul principal ca să încarci.'
              : 'Se determină terenul din locația ta…'}
          </Text>
        ) : null}
        <BigButton title="Anulează" onPress={() => router.back()} variant="outline" />
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
        scale_broken: null,
        destination_has_operator: null,
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
});
