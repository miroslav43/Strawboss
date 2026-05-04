import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import type { Machine } from '@strawboss/types';
import { BigButton } from '@/components/ui/BigButton';
import { NumericPad } from '@/components/ui/NumericPad';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { mobileApiClient } from '@/lib/api-client';
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
const FULL_TRUCK_FALLBACK = 24;

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
export default function LoadBalesScreen() {
  const { truckId: truckIdParam } = useLocalSearchParams<{ truckId?: string }>();
  const userId = useAuthStore((s) => s.userId);
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const { isConnected: isOnline } = useNetworkStatus();
  const queryClient = useQueryClient();
  const parcel = useCurrentLoaderParcel();

  const [baleCountStr, setBaleCountStr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const gpsRef = useRef<{ lon: number; lat: number } | null>(null);

  const baleCount = parseInt(baleCountStr, 10) || 0;

  const truckId = truckIdParam ?? null;
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
    if (parcel.status === 'needs_start' || parcel.status === 'unavailable') {
      // Surface the parcel prompt on home — this screen requires a resolved parcel.
      Alert.alert(
        'Teren neconfirmat',
        'Confirmă terenul activ în ecranul principal înainte de a încărca.',
        [{ text: 'Înapoi', onPress: () => router.back() }],
      );
    }
  }, [parcel.status]);

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

  const fullTruckCount = truck?.maxBaleCount ?? FULL_TRUCK_FALLBACK;

  const handleSave = useCallback(async () => {
    if (!userId || !assignedMachineId || !truckId) return;
    if (parcel.status !== 'resolved' || !parcel.parcelId) return;
    if (saving || baleCount <= 0) return;

    setSaving(true);
    try {
      const idempotencyKey = generateUuid();
      const gps = gpsRef.current;
      const payload = {
        truckId,
        loaderMachineId: assignedMachineId,
        parcelId: parcel.parcelId,
        baleCount,
        gpsLat: gps?.lat,
        gpsLon: gps?.lon,
        idempotencyKey,
      };

      if (isOnline) {
        const result = await mobileApiClient.post<RegisterLoadResponse>(
          '/api/v1/trips/register-load',
          payload,
        );
        // Mirror to local DBs so the loader bales tab and driver are immediate.
        await applyOptimistic({
          baleLoadId: result.baleLoadId,
          tripId: result.trip.id,
          truckId,
          parcelId: parcel.parcelId,
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
        // Offline: queue the mutation. Local trip id is unknown until sync, so
        // we tag the optimistic bale_load with a synthetic local trip id and
        // backfill it later when the queue resolves.
        const localTripId = `local:${truckId}`;
        await applyOptimistic({
          baleLoadId: idempotencyKey,
          tripId: localTripId,
          truckId,
          parcelId: parcel.parcelId,
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

      setSaved(true);
      setTimeout(() => router.back(), 1500);
    } catch (err) {
      mobileLogger.error('Loader register-load failed', {
        truckId,
        err: err instanceof Error ? { message: err.message } : err,
      });
      Alert.alert(
        'Eroare',
        err instanceof Error ? err.message : 'Nu s-a putut înregistra încărcarea.',
      );
    } finally {
      setSaving(false);
    }
  }, [userId, assignedMachineId, truckId, parcel, saving, baleCount, isOnline, queryClient]);

  const truckLabel = truck
    ? (truck.registrationPlate ?? truck.internalCode)
    : truckId
      ? '...'
      : 'Camion necunoscut';

  if (saved) {
    return (
      <View style={styles.outerContainer}>
        <ScreenHeader title="Camion plin" />
        <View style={[styles.body, styles.centered]}>
          <MaterialCommunityIcons name="check-circle" size={72} color={colors.primary} />
          <Text style={styles.successText}>Înregistrat!</Text>
          <Text style={styles.successSubtext}>Cursa a fost generată pentru șofer.</Text>
        </View>
      </View>
    );
  }

  const parcelReady = parcel.status === 'resolved';

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
            <Text style={styles.parcelName}>
              {parcelReady
                ? parcel.parcelName
                : parcel.status === 'loading'
                  ? 'Se identifică...'
                  : 'Neconfirmat — confirmă pe ecranul principal'}
            </Text>
          </View>
        </View>

        <Text style={styles.fieldLabel}>Număr baloți încărcați</Text>

        <TouchableOpacity
          style={styles.fullTruckButton}
          activeOpacity={0.85}
          onPress={() => setBaleCountStr(String(fullTruckCount))}
        >
          <MaterialCommunityIcons name="truck-fast" size={20} color={colors.primary} />
          <Text style={styles.fullTruckText}>Camion plin ({fullTruckCount} baloți)</Text>
        </TouchableOpacity>

        <NumericPad value={baleCountStr} onChange={setBaleCountStr} decimal={false} />

        <BigButton
          title="Înregistrează"
          onPress={() => void handleSave()}
          loading={saving}
          disabled={baleCount <= 0 || !parcelReady}
        />
        <BigButton title="Anulează" onPress={() => router.back()} variant="outline" />
      </ScrollView>
    </View>
  );
}

interface OptimisticInput {
  baleLoadId: string;
  tripId: string;
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
        status: 'loaded',
        source_parcel_id: input.parcelId,
        destination_id: null,
        destination_name: null,
        destination_address: null,
        truck_id: input.truckId,
        driver_id: null,
        loader_id: input.loaderMachineId,
        loader_operator_id: input.operatorId,
        bale_count: input.baleCount,
        departure_odometer_km: null,
        arrival_odometer_km: null,
        gross_weight_kg: null,
        tare_weight_kg: null,
        receiver_name: null,
        loading_started_at: now,
        loading_completed_at: now,
        departure_at: null,
        arrival_at: null,
        delivered_at: null,
        completed_at: null,
        acknowledged_at: null,
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
  parcelLabel: { fontSize: 11, fontWeight: '600', color: colors.tertiary, textTransform: 'uppercase' },
  parcelName: { fontSize: 16, fontWeight: '700', color: '#0A5C36', marginTop: 2 },
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
  fullTruckText: { fontSize: 15, fontWeight: '700', color: colors.primary },
  successText: { fontSize: 22, fontWeight: '700', color: '#0A5C36' },
  successSubtext: { fontSize: 14, color: '#5D4037', textAlign: 'center', paddingHorizontal: 24 },
});
