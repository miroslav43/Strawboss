import { useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import type { Parcel } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import {
  GeofenceEditorView,
  type GeofenceEditorViewHandle,
} from '@/components/map/GeofenceEditorView';
import { CreateParcelModal } from '@/components/geofence-maker/CreateParcelModal';
import { CreateDepositModal } from '@/components/geofence-maker/CreateDepositModal';
import type { GeofenceEditorEvent, ParcelMapData, DestinationMapData } from '@/map/map-bridge';
import { getDatabase } from '@/lib/storage';
import { ParcelsRepo } from '@/db/parcels-repo';
import { DeliveryDestinationsRepo } from '@/db/delivery-destinations-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { generateUuid } from '@/lib/uuid';

type DrawMode = 'parcel' | 'deposit' | null;

interface DeliveryDestination {
  id: string;
  name: string;
  code: string;
  boundary: unknown | null;
  coords: { lat: number; lon: number } | null;
}

function toLatLon(raw: unknown): { lat: number; lon: number } | null {
  if (raw == null || typeof raw !== 'object') return null;
  const obj = raw as { lat?: unknown; lon?: unknown; coordinates?: unknown };
  if (typeof obj.lat === 'number' && typeof obj.lon === 'number')
    return { lat: obj.lat, lon: obj.lon };
  if (Array.isArray(obj.coordinates) && obj.coordinates.length >= 2) {
    const [lon, lat] = obj.coordinates;
    if (typeof lon === 'number' && typeof lat === 'number') return { lat, lon };
  }
  return null;
}

export default function GeofenceMakerMapScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const mapRef = useRef<GeofenceEditorViewHandle>(null);
  const router = useRouter();
  const { focusParcelId } = useLocalSearchParams<{ focusParcelId?: string }>();

  const [mapReady, setMapReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [drawnGeojson, setDrawnGeojson] = useState<object | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // T1 — number of vertices in the in-progress center-pin polygon. Driven
  // by VERTEX_COUNT events from the WebView; controls when "Finalizează"
  // becomes enabled (>=3).
  const [vertexCount, setVertexCount] = useState(0);
  const { modalProps, showModal, hideModal } = useModal();

  const { data: parcels } = useQuery({
    queryKey: ['geofence-editor-parcels'],
    queryFn: () => mobileApiClient.get<Parcel[]>('/api/v1/parcels'),
    staleTime: 5 * 60_000,
  });

  const { data: deposits } = useQuery({
    queryKey: ['geofence-editor-deposits'],
    queryFn: () => mobileApiClient.get<DeliveryDestination[]>('/api/v1/delivery-destinations'),
    staleTime: 5 * 60_000,
  });

  // Push data to map when ready
  useEffect(() => {
    if (!mapReady) return;

    if (parcels?.length) {
      const parcelData: ParcelMapData[] = parcels.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        harvestStatus: p.harvestStatus,
        areaHectares: p.areaHectares,
        boundary: p.boundary,
      }));
      mapRef.current?.sendCommand({ type: 'SET_PARCELS', parcels: parcelData });
    }

    if (deposits?.length) {
      const destData: DestinationMapData[] = deposits.map((d) => {
        const center = toLatLon(d.coords);
        return {
          id: d.id,
          name: d.name,
          code: d.code,
          boundary: d.boundary,
          lat: center?.lat,
          lon: center?.lon,
        };
      });
      mapRef.current?.sendCommand({ type: 'SET_DESTINATIONS', destinations: destData });
    }

    mapRef.current?.sendCommand({ type: 'FIT_BOUNDS' });
  }, [mapReady, parcels, deposits]);

  // Focus + highlight a parcel when navigated with ?focusParcelId=...
  useEffect(() => {
    if (!mapReady || !focusParcelId || !parcels?.length) return;
    const parcelExists = parcels.some((p) => p.id === focusParcelId);
    if (!parcelExists) return;
    const t = setTimeout(() => {
      mapRef.current?.sendCommand({ type: 'HIGHLIGHT_PARCEL', parcelId: focusParcelId });
      router.setParams({ focusParcelId: '' });
    }, 250);
    return () => clearTimeout(t);
  }, [mapReady, focusParcelId, parcels, router]);

  const handleMapReady = useCallback(() => setMapReady(true), []);

  const handleMapEvent = useCallback((event: GeofenceEditorEvent) => {
    if (event.type === 'POLYGON_DRAWN') {
      mapRef.current?.sendCommand({ type: 'DISABLE_POINT_DRAW' });
      setVertexCount(0);
      setDrawnGeojson(event.geojson);
      // drawMode is still set — modals use it to know which form to show
    } else if (event.type === 'VERTEX_COUNT') {
      setVertexCount(event.count);
    }
  }, []);

  const startDraw = useCallback((mode: DrawMode) => {
    setDrawMode(mode);
    setDrawnGeojson(null);
    setVertexCount(0);
    // T1 — Google-Earth-style: center-pin + "Adaugă punct" instead of
    // tap-each-vertex. The WebView shows a fixed pin at screen centre; the
    // user pans the map under it and taps the side button per vertex.
    mapRef.current?.sendCommand({ type: 'ENABLE_POINT_DRAW' });
  }, []);

  const cancelDraw = useCallback(() => {
    mapRef.current?.sendCommand({ type: 'DISABLE_POINT_DRAW' });
    setDrawMode(null);
    setDrawnGeojson(null);
    setVertexCount(0);
  }, []);

  const addPoint = useCallback(() => {
    mapRef.current?.sendCommand({ type: 'ADD_VERTEX_AT_CENTER' });
  }, []);

  const removeLastPoint = useCallback(() => {
    mapRef.current?.sendCommand({ type: 'REMOVE_LAST_VERTEX' });
  }, []);

  const finishPolygon = useCallback(() => {
    if (vertexCount < 3) return;
    mapRef.current?.sendCommand({ type: 'FINISH_POLYGON' });
  }, [vertexCount]);

  const handleLocate = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showModal({
          type: 'warning',
          title: 'Locație',
          message: 'Activează permisiunea de locație.',
          onConfirm: hideModal,
        });
        return;
      }
      setLocating(true);
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      mapRef.current?.sendCommand({
        type: 'SET_USER_LOCATION',
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
      });
    } catch {
      showModal({
        type: 'error',
        title: 'Eroare',
        message: 'Nu s-a putut obține locația.',
        onConfirm: hideModal,
      });
    } finally {
      setLocating(false);
    }
  }, [showModal, hideModal]);

  const handleSaveParcel = useCallback(
    async (data: { name: string; farmId: string | null; municipality: string; notes: string }) => {
      if (!drawnGeojson) return;
      setIsSaving(true);
      try {
        // Offline-first: generate the UUID client-side, write a draft into the
        // local SQLite cache so the map can render it immediately, then enqueue
        // a `parcel_create` sync entry. The SyncManager retries the dedicated
        // REST endpoint when connectivity returns; the unique (code, org)
        // constraint server-side makes the replay idempotent.
        const id = generateUuid();
        const boundaryStr = JSON.stringify(drawnGeojson);
        const code = `P-${id.slice(0, 8).toUpperCase()}`;
        const payload = {
          id,
          name: data.name,
          code,
          municipality: data.municipality,
          notes: data.notes,
          farmId: data.farmId,
          boundary: boundaryStr,
        };

        const db = await getDatabase();
        const parcelsRepo = new ParcelsRepo(db);
        const syncQueue = new SyncQueueRepo(db);

        await parcelsRepo.upsert({
          id,
          name: data.name,
          code,
          area_hectares: null,
          municipality: data.municipality || null,
          harvest_status: null,
          crop_type: null,
          centroid_json: null,
          geometry: boundaryStr,
          cached_at: new Date().toISOString(),
        });
        await syncQueue.enqueue({
          entityType: 'parcel_create',
          entityId: id,
          action: 'insert',
          payload,
          idempotencyKey: `parcel_create_${id}`,
        });

        await queryClient.invalidateQueries({ queryKey: ['geofence-editor-parcels'] });
        await queryClient.invalidateQueries({ queryKey: ['map-parcels'] });
        setDrawMode(null);
        setDrawnGeojson(null);
        showModal({
          type: 'success',
          title: 'Succes',
          message: 'Câmpul a fost salvat și se va sincroniza la reconectare.',
          onConfirm: hideModal,
          autoDismiss: true,
        });
      } catch {
        showModal({
          type: 'error',
          title: 'Eroare',
          message: 'Nu s-a putut salva câmpul. Încearcă din nou.',
          onConfirm: hideModal,
        });
      } finally {
        setIsSaving(false);
      }
    },
    [drawnGeojson, queryClient, showModal, hideModal],
  );

  const handleSaveDeposit = useCallback(
    async (data: {
      code: string;
      name: string;
      address: string;
      contactName: string;
      contactPhone: string;
      isDefault: boolean;
    }) => {
      if (!drawnGeojson) return;
      setIsSaving(true);
      try {
        // Offline-first: same pattern as handleSaveParcel — local SQLite write
        // + sync queue entry routed through `delivery_destination_create`.
        const id = generateUuid();
        const boundaryStr = JSON.stringify(drawnGeojson);
        const payload = {
          id,
          ...data,
          boundary: boundaryStr,
        };

        const db = await getDatabase();
        const depositsRepo = new DeliveryDestinationsRepo(db);
        const syncQueue = new SyncQueueRepo(db);

        await depositsRepo.upsert({
          id,
          code: data.code,
          name: data.name,
          address: data.address || null,
          boundary: boundaryStr,
          coords_json: null,
          is_default: data.isDefault ? 1 : 0,
          cached_at: new Date().toISOString(),
        });
        await syncQueue.enqueue({
          entityType: 'delivery_destination_create',
          entityId: id,
          action: 'insert',
          payload,
          idempotencyKey: `delivery_destination_create_${id}`,
        });

        await queryClient.invalidateQueries({ queryKey: ['geofence-editor-deposits'] });
        await queryClient.invalidateQueries({ queryKey: ['map-destinations'] });
        setDrawMode(null);
        setDrawnGeojson(null);
        showModal({
          type: 'success',
          title: 'Succes',
          message: 'Depozitul a fost salvat și se va sincroniza la reconectare.',
          onConfirm: hideModal,
          autoDismiss: true,
        });
      } catch {
        showModal({
          type: 'error',
          title: 'Eroare',
          message: 'Nu s-a putut salva depozitul. Încearcă din nou.',
          onConfirm: hideModal,
        });
      } finally {
        setIsSaving(false);
      }
    },
    [drawnGeojson, queryClient, showModal, hideModal],
  );

  const handleCloseParcelModal = useCallback(() => {
    setDrawMode(null);
    setDrawnGeojson(null);
  }, []);

  const handleCloseDepositModal = useCallback(() => {
    setDrawMode(null);
    setDrawnGeojson(null);
  }, []);

  const bannerText = drawMode
    ? vertexCount === 0
      ? 'Centrează pinul pe primul punct și apasă „Adaugă punct"'
      : vertexCount < 3
        ? `Punct ${vertexCount}/3 — continuă (minim 3 puncte)`
        : `${vertexCount} puncte — apasă „Finalizează" sau adaugă mai multe`
    : 'Apasă un buton pentru a adăuga un câmp sau depozit';

  const bannerColor = drawMode ? '#FEF9C3' : '#ECFDF5';
  const bannerBorder = drawMode ? '#FDE047' : '#A7F3D0';
  const bannerTextColor = drawMode ? '#713F12' : '#065F46';

  return (
    <View style={styles.container}>
      {/* Info banner */}
      <View
        style={[
          styles.banner,
          { top: insets.top + 8, backgroundColor: bannerColor, borderColor: bannerBorder },
        ]}
      >
        <MaterialCommunityIcons
          name={drawMode ? 'draw' : 'information-outline'}
          size={16}
          color={bannerTextColor}
        />
        <Text style={[styles.bannerText, { color: bannerTextColor }]}>{bannerText}</Text>
        {drawMode ? (
          <TouchableOpacity onPress={cancelDraw} style={styles.cancelDrawBtn}>
            <Text style={styles.cancelDrawText}>Anulează</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <GeofenceEditorView ref={mapRef} onEvent={handleMapEvent} onReady={handleMapReady} />

      {/* FABs — left side, stacked vertically */}
      {!drawMode && (
        <View style={[styles.fabStack, { bottom: 16 + insets.bottom }]}>
          <TouchableOpacity
            style={[styles.fab, styles.fabParcel, isSaving && styles.fabDisabled]}
            onPress={() => startDraw('parcel')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Adaugă câmp nou"
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialCommunityIcons name="shape-polygon-plus" size={22} color="#fff" />
            )}
            <Text style={styles.fabLabel}>Câmp nou</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.fab, styles.fabDeposit, isSaving && styles.fabDisabled]}
            onPress={() => startDraw('deposit')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Adaugă depozit nou"
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialCommunityIcons name="warehouse" size={22} color="#fff" />
            )}
            <Text style={styles.fabLabel}>Depozit nou</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Locate FAB — bottom-right when idle, moves up when drawing to clear the action stack */}
      <TouchableOpacity
        style={[styles.locateFab, { bottom: 16 + insets.bottom + (drawMode ? 200 : 0) }]}
        onPress={handleLocate}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Recentrare pe locația mea"
        disabled={locating}
      >
        {locating ? (
          <ActivityIndicator color="#0A5C36" size="small" />
        ) : (
          <MaterialCommunityIcons name="crosshairs-gps" size={24} color="#0A5C36" />
        )}
      </TouchableOpacity>

      {/* T1 — Point-by-point polygon action stack, right side, only when drawing.
         "Adaugă punct" (primary), "Pas înapoi" (when ≥1), "Finalizează" (when ≥3). */}
      {drawMode ? (
        <View style={[styles.pointActionStack, { bottom: 16 + insets.bottom }]}>
          <TouchableOpacity
            style={[styles.pointFab, styles.pointFabPrimary]}
            onPress={addPoint}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Adaugă punct la centrul hărții"
          >
            <MaterialCommunityIcons name="plus" size={22} color="#fff" />
            <Text style={styles.pointFabLabel}>Adaugă punct</Text>
          </TouchableOpacity>

          {vertexCount > 0 ? (
            <TouchableOpacity
              style={[styles.pointFab, styles.pointFabUndo]}
              onPress={removeLastPoint}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Șterge ultimul punct"
            >
              <MaterialCommunityIcons name="undo" size={20} color="#713F12" />
              <Text style={styles.pointFabUndoLabel}>Pas înapoi</Text>
            </TouchableOpacity>
          ) : null}

          {vertexCount >= 3 ? (
            <TouchableOpacity
              style={[styles.pointFab, styles.pointFabFinish, isSaving && styles.fabDisabled]}
              onPress={finishPolygon}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Finalizează poligonul"
              disabled={isSaving}
            >
              <MaterialCommunityIcons name="check" size={22} color="#fff" />
              <Text style={styles.pointFabLabel}>Finalizează</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Create parcel form */}
      <CreateParcelModal
        visible={drawMode === 'parcel' && drawnGeojson !== null}
        onSave={handleSaveParcel}
        onClose={handleCloseParcelModal}
        isSaving={isSaving}
      />

      {/* Create deposit form */}
      <CreateDepositModal
        visible={drawMode === 'deposit' && drawnGeojson !== null}
        onSave={handleSaveDeposit}
        onClose={handleCloseDepositModal}
        isSaving={isSaving}
      />
      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  bannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  cancelDrawBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#FBBF24',
  },
  cancelDrawText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#713F12',
  },
  fabStack: {
    position: 'absolute',
    left: 16,
    gap: 10,
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
  fabParcel: { backgroundColor: '#0A5C36' },
  fabDeposit: { backgroundColor: '#1565C0' },
  fabDisabled: { opacity: 0.5 },
  fabLabel: { fontSize: 14, fontWeight: '700', color: '#fff' },
  locateFab: {
    position: 'absolute',
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  // T1 — point-by-point polygon action stack (right side, vertical).
  pointActionStack: {
    position: 'absolute',
    right: 16,
    gap: 10,
    alignItems: 'flex-end',
  },
  pointFab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 26,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
  pointFabPrimary: { backgroundColor: '#0A5C36' },
  pointFabFinish: { backgroundColor: '#15803D' },
  pointFabUndo: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE047',
  },
  pointFabLabel: { fontSize: 13, fontWeight: '700', color: '#fff' },
  pointFabUndoLabel: { fontSize: 13, fontWeight: '700', color: '#713F12' },
});
