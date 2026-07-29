import { useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import type { CropType } from '@strawboss/types';
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
import { useCachedParcels, PARCELS_LOCAL_KEY } from '@/hooks/useCachedParcels';
import { useCachedDepots, DEPOTS_LOCAL_KEY } from '@/hooks/useCachedDepots';
import { useSync } from '@/hooks/useSync';
import { polygonAreaHectares } from '@/utils/geo-area';
import { generateUuid } from '@/lib/uuid';
import { useI18n } from '@/lib/i18n';
import { useIsFeatureEnabled } from '@/stores/features-store';

type DrawMode = 'parcel' | 'deposit' | null;

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

/** The local depot cache stores `coords_json` as a string; parse it lazily. */
function parseCoords(raw: string | null): { lat: number; lon: number } | null {
  if (!raw) return null;
  try {
    return toLatLon(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Boundaries are stored as JSON strings locally; Leaflet wants the object. */
function parseBoundary(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export default function GeofenceMakerMapScreen() {
  const drawEnabled = useIsFeatureEnabled('geo.draw_mobile');
  const { t } = useI18n();
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

  // Local-first: both lists come from the SQLite cache, so a field drawn a moment
  // ago is already in them — even offline. The server refresh happens in the
  // background inside these hooks and rewrites the cache when it lands.
  const { parcels } = useCachedParcels();
  const { depots } = useCachedDepots();
  const { triggerSync } = useSync();

  // Fit the camera to the data exactly once. Firing FIT_BOUNDS on every data
  // change re-framed the map under the user's finger on each background refresh.
  const didFitRef = useRef(false);

  // Push data to map when ready
  useEffect(() => {
    if (!mapReady) return;

    // Send the command even when the list is EMPTY. setParcels() is what calls
    // clearLayers() inside the WebView, so short-circuiting on an empty list left
    // the polygons of deleted parcels painted on the map forever.
    const parcelData: ParcelMapData[] = parcels.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      harvestStatus: p.harvestStatus ?? '',
      areaHectares: p.areaHectares ?? 0,
      boundary: p.boundary,
    }));
    mapRef.current?.sendCommand({ type: 'SET_PARCELS', parcels: parcelData });

    const destData: DestinationMapData[] = depots.map((d) => {
      const center = parseCoords(d.coords_json);
      return {
        id: d.id,
        name: d.name,
        code: d.code,
        boundary: parseBoundary(d.boundary),
        lat: center?.lat,
        lon: center?.lon,
      };
    });
    mapRef.current?.sendCommand({ type: 'SET_DESTINATIONS', destinations: destData });

    if (!didFitRef.current && (parcelData.length > 0 || destData.length > 0)) {
      didFitRef.current = true;
      mapRef.current?.sendCommand({ type: 'FIT_BOUNDS' });
    }
  }, [mapReady, parcels, depots]);

  // Focus + highlight a parcel when navigated with ?focusParcelId=...
  useEffect(() => {
    if (!mapReady || !focusParcelId || parcels.length === 0) return;
    const parcelExists = parcels.some((p) => p.id === focusParcelId);
    if (!parcelExists) return;
    const t = setTimeout(() => {
      mapRef.current?.sendCommand({ type: 'HIGHLIGHT_PARCEL', parcelId: focusParcelId });
      router.setParams({ focusParcelId: '' });
    }, 250);
    return () => clearTimeout(t);
  }, [mapReady, focusParcelId, parcels, router]);

  // Open the map on the user's location with a live blue dot. The WebView
  // auto-centres on the first fix (zoom 16) and skips fit-to-parcels after
  // that; the 15s refresh keeps the dot current without re-centring.
  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;

    async function pushLocation() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (cancelled) return;
        const acc = loc.coords.accuracy;
        const accuracyM = acc != null && Number.isFinite(acc) && acc > 0 ? acc : undefined;
        mapRef.current?.sendCommand({
          type: 'SET_USER_LOCATION',
          lat: loc.coords.latitude,
          lon: loc.coords.longitude,
          ...(accuracyM != null ? { accuracy: accuracyM } : {}),
        });
      } catch {
        // Silently ignore — the locate button is the manual fallback.
      }
    }

    void pushLocation();
    const interval = setInterval(pushLocation, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mapReady]);

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
    mapRef.current?.sendCommand({ type: 'CLEAR_DRAWN' });
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
          title: t('geofenceMap.locationPermissionTitle'),
          message: t('geofenceMap.locationPermissionMessage'),
          onConfirm: hideModal,
        });
        return;
      }
      setLocating(true);
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const acc = loc.coords.accuracy;
      const accuracyM = acc != null && Number.isFinite(acc) && acc > 0 ? acc : undefined;
      mapRef.current?.sendCommand({
        type: 'SET_USER_LOCATION',
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        ...(accuracyM != null ? { accuracy: accuracyM } : {}),
      });
      // The button must visibly recentre — SET_USER_LOCATION only draws the dot.
      mapRef.current?.sendCommand({
        type: 'CENTER_ON',
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        zoom: 16,
      });
    } catch {
      showModal({
        type: 'error',
        title: t('geofenceMap.locationErrorTitle'),
        message: t('geofenceMap.locationErrorMessage'),
        onConfirm: hideModal,
      });
    } finally {
      setLocating(false);
    }
  }, [showModal, hideModal]);

  const handleSaveParcel = useCallback(
    async (data: {
      name: string;
      farmId: string | null;
      municipality: string;
      notes: string;
      cropType: CropType | null;
    }) => {
      if (!drawnGeojson) return;
      setIsSaving(true);
      try {
        // Offline-first: mint the UUID client-side, write the parcel into the local
        // SQLite cache — which IS what the map renders — then enqueue a
        // `parcel_create` sync entry. The map is correct from this point on,
        // whether or not the phone has signal. The server writes onto the same id,
        // and the unique (code, org) constraint makes a replay idempotent.
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
          cropType: data.cropType,
          boundary: boundaryStr,
        };

        const db = await getDatabase();
        const parcelsRepo = new ParcelsRepo(db);
        const syncQueue = new SyncQueueRepo(db);

        await parcelsRepo.upsert({
          id,
          name: data.name,
          code,
          // PostGIS is the authority, but its answer is a sync cycle away and the
          // field card would read "— ha" until then. Compute it here; the server's
          // value overwrites ours on the next refresh (they agree to <0.1%).
          area_hectares: polygonAreaHectares(drawnGeojson),
          municipality: data.municipality || null,
          harvest_status: null,
          crop_type: data.cropType,
          // Authoritative farm_name is computed server-side (trigger 00065) from
          // farm_id and arrives on the next pull; null until then. farm_id we know
          // now, so the farm screen can group the field under its farm right away.
          farm_name: null,
          farm_id: data.farmId,
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

        // Re-read the local cache — the parcel is in it, so the polygon lands on
        // the map in the same frame as the success modal. No network involved.
        await queryClient.invalidateQueries({ queryKey: PARCELS_LOCAL_KEY });
        // Drop the temp draw layer; the real (cached) parcel now renders in its place.
        mapRef.current?.sendCommand({ type: 'CLEAR_DRAWN' });
        setDrawMode(null);
        setDrawnGeojson(null);
        showModal({
          type: 'success',
          title: t('geofenceMap.successParcelTitle'),
          message: t('geofenceMap.successParcelMessage'),
          onConfirm: hideModal,
          autoDismiss: true,
        });

        // Fire-and-forget. A geofence_maker has no assigned machine, so no GPS task
        // and no piggyback sync — without this the queue waits for the 15-minute
        // WorkManager tick. The map is already right either way, so we don't await.
        void triggerSync().catch(() => {});
      } catch {
        showModal({
          type: 'error',
          title: t('geofenceMap.errorParcelTitle'),
          message: t('geofenceMap.errorParcelMessage'),
          onConfirm: hideModal,
        });
      } finally {
        setIsSaving(false);
      }
    },
    [drawnGeojson, queryClient, showModal, hideModal, t, triggerSync],
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

        await queryClient.invalidateQueries({ queryKey: DEPOTS_LOCAL_KEY });
        // Drop the temp draw layer; the real (cached) depot now renders in its place.
        mapRef.current?.sendCommand({ type: 'CLEAR_DRAWN' });
        setDrawMode(null);
        setDrawnGeojson(null);
        showModal({
          type: 'success',
          title: t('geofenceMap.successDepotTitle'),
          message: t('geofenceMap.successDepotMessage'),
          onConfirm: hideModal,
          autoDismiss: true,
        });

        void triggerSync().catch(() => {});
      } catch {
        showModal({
          type: 'error',
          title: t('geofenceMap.errorDepotTitle'),
          message: t('geofenceMap.errorDepotMessage'),
          onConfirm: hideModal,
        });
      } finally {
        setIsSaving(false);
      }
    },
    [drawnGeojson, queryClient, showModal, hideModal, t, triggerSync],
  );

  const handleCloseParcelModal = useCallback(() => {
    // Discard the drawn polygon — a geofence must only survive an explicit Save.
    mapRef.current?.sendCommand({ type: 'CLEAR_DRAWN' });
    setDrawMode(null);
    setDrawnGeojson(null);
  }, []);

  const handleCloseDepositModal = useCallback(() => {
    mapRef.current?.sendCommand({ type: 'CLEAR_DRAWN' });
    setDrawMode(null);
    setDrawnGeojson(null);
  }, []);

  const bannerText = drawMode
    ? vertexCount === 0
      ? t('geofenceMap.bannerFirstPoint')
      : vertexCount < 3
        ? t('geofenceMap.bannerProgress', { count: vertexCount })
        : t('geofenceMap.bannerEnoughPoints', { count: vertexCount })
    : drawEnabled
      ? t('geofenceMap.bannerIdle')
      : t('geofenceMap.bannerDrawDisabled');

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
        <Text style={[styles.bannerText, { color: bannerTextColor }]} numberOfLines={2}>
          {bannerText}
        </Text>
        {drawMode ? (
          <TouchableOpacity onPress={cancelDraw} style={styles.cancelDrawBtn}>
            <Text style={styles.cancelDrawText}>{t('geofenceMap.cancelDrawButton')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <GeofenceEditorView ref={mapRef} onEvent={handleMapEvent} onReady={handleMapReady} />

      {/* FABs — left side, stacked vertically */}
      {/* Only the ENTRY point is gated. With startDraw unreachable, drawMode
          stays null, so the point-by-point controls and both create modals are
          dead by construction. The screen itself stays a valid read surface —
          it still shows existing parcels and depots — so the tab is not
          hidden. */}
      {!drawMode && drawEnabled && (
        <View style={[styles.fabStack, { bottom: 16 + insets.bottom }]}>
          <TouchableOpacity
            style={[styles.fab, styles.fabParcel, isSaving && styles.fabDisabled]}
            onPress={() => startDraw('parcel')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('geofenceMap.fabNewFieldA11y')}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialCommunityIcons name="shape-polygon-plus" size={22} color="#fff" />
            )}
            <Text style={styles.fabLabel}>{t('geofenceMap.fabNewFieldLabel')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.fab, styles.fabDeposit, isSaving && styles.fabDisabled]}
            onPress={() => startDraw('deposit')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('geofenceMap.fabNewDepotA11y')}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialCommunityIcons name="warehouse" size={22} color="#fff" />
            )}
            <Text style={styles.fabLabel}>{t('geofenceMap.fabNewDepotLabel')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Locate FAB — bottom-right when idle, moves up when drawing to clear the action stack */}
      <TouchableOpacity
        style={[styles.locateFab, { bottom: 16 + insets.bottom + (drawMode ? 200 : 0) }]}
        onPress={handleLocate}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t('geofenceMap.locateFabA11y')}
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
            accessibilityLabel={t('geofenceMap.addPointA11y')}
          >
            <MaterialCommunityIcons name="plus" size={22} color="#fff" />
            <Text style={styles.pointFabLabel}>{t('geofenceMap.addPointButton')}</Text>
          </TouchableOpacity>

          {vertexCount > 0 ? (
            <TouchableOpacity
              style={[styles.pointFab, styles.pointFabUndo]}
              onPress={removeLastPoint}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('geofenceMap.undoPointA11y')}
            >
              <MaterialCommunityIcons name="undo" size={20} color="#713F12" />
              <Text style={styles.pointFabUndoLabel}>{t('geofenceMap.undoPointButton')}</Text>
            </TouchableOpacity>
          ) : null}

          {vertexCount >= 3 ? (
            <TouchableOpacity
              style={[styles.pointFab, styles.pointFabFinish, isSaving && styles.fabDisabled]}
              onPress={finishPolygon}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('geofenceMap.finishPolygonA11y')}
              disabled={isSaving}
            >
              <MaterialCommunityIcons name="check" size={22} color="#fff" />
              <Text style={styles.pointFabLabel}>{t('geofenceMap.finishPolygonButton')}</Text>
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
