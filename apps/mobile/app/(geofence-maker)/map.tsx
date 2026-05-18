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
      mapRef.current?.sendCommand({ type: 'DISABLE_DRAW' });
      setDrawnGeojson(event.geojson);
      // drawMode is still set — modals use it to know which form to show
    }
  }, []);

  const startDraw = useCallback((mode: DrawMode) => {
    setDrawMode(mode);
    setDrawnGeojson(null);
    mapRef.current?.sendCommand({ type: 'ENABLE_DRAW' });
  }, []);

  const cancelDraw = useCallback(() => {
    mapRef.current?.sendCommand({ type: 'DISABLE_DRAW' });
    setDrawMode(null);
    setDrawnGeojson(null);
  }, []);

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
        await mobileApiClient.post('/api/v1/parcels', {
          ...data,
          boundary: JSON.stringify(drawnGeojson),
        });
        await queryClient.invalidateQueries({ queryKey: ['geofence-editor-parcels'] });
        await queryClient.invalidateQueries({ queryKey: ['map-parcels'] });
        setDrawMode(null);
        setDrawnGeojson(null);
        showModal({
          type: 'success',
          title: 'Succes',
          message: 'Câmpul a fost creat cu geofence-ul desenat.',
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
        await mobileApiClient.post('/api/v1/delivery-destinations', {
          ...data,
          boundary: JSON.stringify(drawnGeojson),
        });
        await queryClient.invalidateQueries({ queryKey: ['geofence-editor-deposits'] });
        await queryClient.invalidateQueries({ queryKey: ['map-destinations'] });
        setDrawMode(null);
        setDrawnGeojson(null);
        showModal({
          type: 'success',
          title: 'Succes',
          message: 'Depozitul a fost creat cu geofence-ul desenat.',
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

  const bannerText =
    drawMode === 'parcel'
      ? 'Trasează conturul câmpului pe hartă'
      : drawMode === 'deposit'
        ? 'Trasează conturul depozitului pe hartă'
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

      {/* Locate FAB */}
      <TouchableOpacity
        style={[styles.locateFab, { bottom: 16 + insets.bottom }]}
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
});
