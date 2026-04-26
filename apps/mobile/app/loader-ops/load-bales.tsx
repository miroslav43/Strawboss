import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
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
import { ParcelSelector } from '@/components/shared/ParcelSelector';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import { BaleLoadsRepo } from '@/db/bale-loads-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { useAuthStore } from '@/stores/auth-store';
import {
  useActiveParcels,
  findParcelAtLocation,
  type ActiveParcel,
} from '@/hooks/useActiveParcels';
import { mobileLogger } from '@/lib/logger';
import { generateUuid } from '@/lib/uuid';
import { colors } from '@strawboss/ui-tokens';

const GPS_TIMEOUT_MS = 20_000;
const FULL_TRUCK_FALLBACK = 24;

type GpsStatus = 'idle' | 'loading' | 'denied' | 'unavailable' | 'ok';
type ParcelSource = 'gps' | 'trip' | 'manual' | null;

interface RawTrip {
  id: string;
  trip_number: string | null;
  status: string;
  truck_id: string | null;
  source_parcel_id: string | null;
  bale_count: number | string | null;
}

interface RawParcel {
  id: string;
  name: string;
  code: string;
}

export default function LoadBalesScreen() {
  const { tripId, truckId: truckIdParam } = useLocalSearchParams<{
    tripId?: string;
    truckId?: string;
  }>();
  const userId = useAuthStore((s) => s.userId);
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const queryClient = useQueryClient();

  const [baleCountStr, setBaleCountStr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Parcel state
  const [parcelId, setParcelId] = useState<string | null>(null);
  const [parcelName, setParcelName] = useState<string | null>(null);
  const [parcelSource, setParcelSource] = useState<ParcelSource>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // GPS state
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const gpsRef = useRef<{ lon: number; lat: number } | null>(null);

  const baleCount = parseInt(baleCountStr, 10) || 0;

  // Active parcels for GPS lookup + ParcelSelector
  const parcelQuery = useActiveParcels();
  const activeParcels: ActiveParcel[] | undefined = parcelQuery.data;

  // Fetch trip if tripId is present
  const { data: trip, isLoading: tripLoading } = useQuery<RawTrip>({
    queryKey: ['trip', tripId],
    queryFn: () => mobileApiClient.get<RawTrip>(`/api/v1/trips/${tripId}`),
    enabled: !!tripId,
  });

  // Fetch truck from trip.truck_id or fallback truckId param
  const effectiveTruckId = trip?.truck_id ?? truckIdParam ?? null;
  const { data: truck } = useQuery<Machine>({
    queryKey: ['machine', effectiveTruckId],
    queryFn: () => mobileApiClient.get<Machine>(`/api/v1/machines/${effectiveTruckId}`),
    enabled: !!effectiveTruckId,
  });

  // Fetch source parcel from trip for fallback label
  const tripParcelId = trip?.source_parcel_id ?? null;
  const { data: tripParcel } = useQuery<RawParcel>({
    queryKey: ['parcel', tripParcelId],
    queryFn: () => mobileApiClient.get<RawParcel>(`/api/v1/parcels/${tripParcelId}`),
    enabled: !!tripParcelId,
  });

  // GPS + auto parcel detection on mount
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setGpsStatus('loading');
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setGpsStatus('denied');
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeInterval: GPS_TIMEOUT_MS,
        });
        if (cancelled) return;
        const lon = loc.coords.longitude;
        const lat = loc.coords.latitude;
        gpsRef.current = { lon, lat };
        setGpsStatus('ok');

        // Try to find a matching parcel if user hasn't picked one manually
        if (!parcelId && activeParcels?.length) {
          const hit = findParcelAtLocation(lon, lat, activeParcels);
          if (hit && !cancelled) {
            setParcelId(hit.id);
            setParcelName(hit.name);
            setParcelSource('gps');
          }
        }
      } catch {
        if (!cancelled) setGpsStatus('unavailable');
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When parcels finish loading, retry GPS match if GPS succeeded but we had no parcels yet
  useEffect(() => {
    if (
      gpsStatus === 'ok' &&
      gpsRef.current &&
      activeParcels?.length &&
      !parcelId &&
      parcelSource === null
    ) {
      const hit = findParcelAtLocation(
        gpsRef.current.lon,
        gpsRef.current.lat,
        activeParcels,
      );
      if (hit) {
        setParcelId(hit.id);
        setParcelName(hit.name);
        setParcelSource('gps');
      }
    }
  }, [activeParcels, gpsStatus, parcelId, parcelSource]);

  // Fallback: use trip's source parcel when GPS didn't find anything and
  // no manual pick has been made.
  useEffect(() => {
    if (!parcelId && parcelSource === null && tripParcelId && tripParcel) {
      setParcelId(tripParcelId);
      setParcelName(tripParcel.name);
      setParcelSource('trip');
    }
  }, [tripParcelId, tripParcel, parcelId, parcelSource]);

  const fullTruckCount = truck?.maxBaleCount ?? FULL_TRUCK_FALLBACK;

  const handleSave = useCallback(async () => {
    if (!userId || saving || baleCount <= 0) return;
    if (!tripId && !effectiveTruckId) {
      Alert.alert('Eroare', 'Niciun camion identificat. Revino la lista de curse.');
      return;
    }

    setSaving(true);
    try {
      const db = await getDatabase();
      const baleLoadsRepo = new BaleLoadsRepo(db);
      const syncQueue = new SyncQueueRepo(db);

      const id = generateUuid();
      const now = new Date().toISOString();
      const gps = gpsRef.current;

      // Write locally so the "Încărcări de azi" list updates without waiting for sync
      await baleLoadsRepo.create({
        id,
        trip_id: tripId ?? '',
        parcel_id: parcelId ?? '',
        loader_id: assignedMachineId,
        operator_id: userId,
        bale_count: baleCount,
        loaded_at: now,
        gps_lat: gps?.lat ?? null,
        gps_lon: gps?.lon ?? null,
        notes: null,
        created_at: now,
        updated_at: now,
        server_version: 0,
      });

      await syncQueue.enqueue({
        entityType: 'bale_loads',
        entityId: id,
        action: 'insert',
        payload: {
          id,
          trip_id: tripId ?? null,
          parcel_id: parcelId ?? null,
          loader_id: assignedMachineId,
          operator_id: userId,
          bale_count: baleCount,
          loaded_at: now,
          gps_lat: gps?.lat ?? null,
          gps_lon: gps?.lon ?? null,
          client_id: id,
          sync_version: 1,
        },
        idempotencyKey: `bale_loads_${id}`,
      });

      mobileLogger.flow('Loader load-bales: enqueued bale_load', {
        id,
        tripId,
        parcelId,
        baleCount,
      });

      // Invalidate both the load list and the trips-to-load so counts refresh
      void queryClient.invalidateQueries({ queryKey: ['bale-loads', 'my', userId] });
      void queryClient.invalidateQueries({ queryKey: ['trips-to-load', userId] });
      if (tripId) {
        void queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      }

      setSaved(true);
      setTimeout(() => router.back(), 1500);
    } catch (err) {
      mobileLogger.error('Loader load-bales: enqueue failed', {
        tripId,
        err: err instanceof Error ? { message: err.message } : err,
      });
      Alert.alert(
        'Eroare',
        err instanceof Error ? err.message : 'Nu s-a putut salva încărcarea.',
      );
    } finally {
      setSaving(false);
    }
  }, [
    userId,
    saving,
    baleCount,
    tripId,
    effectiveTruckId,
    parcelId,
    assignedMachineId,
    queryClient,
  ]);

  const truckLabel = truck
    ? (truck.registrationPlate ?? truck.internalCode)
    : effectiveTruckId
      ? '...'
      : 'Camion necunoscut';

  // Loading state while we fetch the trip details
  if (tripLoading) {
    return (
      <View style={styles.outerContainer}>
        <ScreenHeader title="Încarcă Baloți" />
        <View style={[styles.body, styles.centered]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Se verifică cursa...</Text>
        </View>
      </View>
    );
  }

  // Success state
  if (saved) {
    return (
      <View style={styles.outerContainer}>
        <ScreenHeader title="Încarcă Baloți" />
        <View style={[styles.body, styles.centered]}>
          <MaterialCommunityIcons name="check-circle" size={64} color={colors.primary} />
          <Text style={styles.successText}>Baloți înregistrați!</Text>
          <Text style={styles.successSubtext}>Se sincronizează cu serverul...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.outerContainer}>
      <ScreenHeader title="Încarcă Baloți">
        {/* Truck info */}
        <View style={styles.headerMeta}>
          <MaterialCommunityIcons name="truck" size={14} color="rgba(255,255,255,0.8)" />
          <Text style={styles.headerMetaText}>{truckLabel}</Text>
        </View>
        {/* GPS status pill */}
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
                ? 'Localizare GPS...'
                : gpsStatus === 'denied'
                  ? 'Permisiune GPS refuzată'
                  : 'GPS indisponibil'}
          </Text>
        </View>
      </ScreenHeader>

      <ScrollView style={styles.body} contentContainerStyle={styles.content}>

        {/* Parcel section */}
        <View style={styles.parcelSection}>
          <Text style={styles.fieldLabel}>Teren</Text>
          {parcelId ? (
            <View style={styles.parcelCard}>
              <View style={styles.parcelCardLeft}>
                <MaterialCommunityIcons
                  name={parcelSource === 'gps' ? 'crosshairs-gps' : parcelSource === 'trip' ? 'clipboard-list' : 'hand-pointing-right'}
                  size={16}
                  color={colors.primary}
                />
                <View>
                  <Text style={styles.parcelName}>{parcelName}</Text>
                  <Text style={styles.parcelSource}>
                    {parcelSource === 'gps'
                      ? 'Detectat din locație'
                      : parcelSource === 'trip'
                        ? 'Din planul cursei'
                        : 'Selectat manual'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setPickerOpen(true)}>
                <Text style={styles.changeLink}>Schimbă</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.parcelPickerButton}
              onPress={() => setPickerOpen(true)}
            >
              <MaterialCommunityIcons name="map-search" size={18} color={colors.primary} />
              <Text style={styles.parcelPickerText}>Selectează teren</Text>
            </TouchableOpacity>
          )}
          <ParcelSelector
            selectedId={parcelId}
            selectedName={parcelName}
            parcels={activeParcels}
            isLoading={parcelQuery.isLoading}
            isError={parcelQuery.isError}
            showTrigger={false}
            modalOpen={pickerOpen}
            onModalOpenChange={setPickerOpen}
            onSelect={(id, name) => {
              setParcelId(id);
              setParcelName(name);
              setParcelSource('manual');
              setPickerOpen(false);
            }}
          />
        </View>

        <Text style={styles.fieldLabel}>Număr baloți încărcați</Text>

        {/* Full truck shortcut — uses the truck's `maxBaleCount` if configured,
            otherwise falls back to 24 (FULL_TRUCK_FALLBACK). */}
        <TouchableOpacity
          style={styles.fullTruckButton}
          activeOpacity={0.8}
          onPress={() => setBaleCountStr(String(fullTruckCount))}
        >
          <MaterialCommunityIcons name="truck-fast" size={20} color={colors.primary} />
          <Text style={styles.fullTruckText}>Camion plin ({fullTruckCount} baloți)</Text>
        </TouchableOpacity>

        <NumericPad
          value={baleCountStr}
          onChange={setBaleCountStr}
          decimal={false}
        />
        <BigButton
          title="Înregistrează"
          onPress={() => void handleSave()}
          loading={saving}
          disabled={baleCount <= 0}
        />
        <BigButton
          title="Anulează"
          onPress={() => router.back()}
          variant="outline"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: '#0A5C36' },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerMetaText: { fontSize: 13, color: 'rgba(255, 255, 255, 0.8)' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: { justifyContent: 'center', alignItems: 'center', gap: 12, paddingTop: 40 },
  loadingText: { color: '#5D4037', fontSize: 14 },
  content: { padding: 16, gap: 12 },
  // Parcel
  parcelSection: { gap: 8 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#5D4037', marginBottom: 2 },
  parcelCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 3,
    elevation: 2,
  },
  parcelCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  parcelName: { fontSize: 15, fontWeight: '600', color: '#0A5C36' },
  parcelSource: { fontSize: 11, color: '#8D6E63' },
  changeLink: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  parcelPickerButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  parcelPickerText: { fontSize: 15, color: colors.primary, fontWeight: '500' },
  // Full truck shortcut
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
  // Summary
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  summaryTitle: { fontSize: 16, fontWeight: '600', color: '#0A5C36' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: 14, color: '#5D4037' },
  summaryValue: { fontSize: 14, fontWeight: '500', color: '#374151' },
  summaryValueLarge: { fontSize: 28, fontWeight: '700', color: '#0A5C36' },
  summaryGps: { fontSize: 13, color: '#2E7D32', fontWeight: '500' },
  // Success
  successText: { fontSize: 20, fontWeight: '700', color: '#0A5C36' },
  successSubtext: { fontSize: 14, color: '#5D4037' },
});
