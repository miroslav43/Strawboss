import { useRef, useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, Alert, TouchableOpacity, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import type { Parcel } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { calculateRoute, haversineKm } from '@/lib/routing';
import { MapView, type MapViewHandle } from './MapView';
import { ParcelInfoSheet } from './ParcelInfoSheet';
import type { MapEvent, ParcelMapData, DestinationMapData, MachineMarkerData } from '@/map/map-bridge';

interface DeliveryDestination {
  id: string;
  name: string;
  code: string;
  boundary: unknown | null;
  coords: { lat: number; lon: number } | null;
}

interface RelatedMachine {
  machineId: string;
  machineType: string;
  machineCode: string;
  operatorName: string | null;
  lat: number;
  lon: number;
}

interface MapScreenProps {
  /** Parcel or destination ID to focus on map load (from task list tap) */
  focusId?: string;
}

/**
 * The backend serialises centroid/coords with PostGIS `ST_AsGeoJSON(...)::json`,
 * so we receive a GeoJSON Point `{ type: 'Point', coordinates: [lon, lat] }`
 * even though some TypeScript types model it as `{ lat, lon }`. Accept both
 * shapes and return `null` for anything unusable.
 */
function toLatLon(
  raw: unknown,
): { lat: number; lon: number } | null {
  if (raw == null || typeof raw !== 'object') return null;
  const obj = raw as {
    lat?: unknown;
    lon?: unknown;
    coordinates?: unknown;
  };
  if (typeof obj.lat === 'number' && typeof obj.lon === 'number') {
    return { lat: obj.lat, lon: obj.lon };
  }
  if (Array.isArray(obj.coordinates) && obj.coordinates.length >= 2) {
    const [lon, lat] = obj.coordinates;
    if (typeof lon === 'number' && typeof lat === 'number') {
      return { lat, lon };
    }
  }
  return null;
}

export function MapScreen({ focusId }: MapScreenProps) {
  const mapRef = useRef<MapViewHandle>(null);
  const [mapReady, setMapReady] = useState(false);
  const [selectedItem, setSelectedParcel] = useState<SelectedMapItem | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distanceKm: number; durationMin: number } | null>(
    null,
  );
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch parcels
  const { data: parcels } = useQuery({
    queryKey: ['map-parcels'],
    queryFn: () => mobileApiClient.get<Parcel[]>('/api/v1/parcels'),
    staleTime: 5 * 60_000,
  });

  // Fetch delivery destinations
  const { data: destinations } = useQuery({
    queryKey: ['map-destinations'],
    queryFn: () => mobileApiClient.get<DeliveryDestination[]>('/api/v1/delivery-destinations'),
    staleTime: 5 * 60_000,
  });

  // Fetch related machine locations (trucks for loaders, etc.)
  const { data: relatedMachines } = useQuery({
    queryKey: ['map-related-machines'],
    queryFn: () => mobileApiClient.get<RelatedMachine[]>('/api/v1/location/related-machines'),
    refetchInterval: 30_000,
  });

  const handleReset = useCallback(() => {
    mapRef.current?.sendCommand({ type: 'CLEAR_ROUTE' });
    mapRef.current?.sendCommand({ type: 'HIGHLIGHT_PARCEL', parcelId: '' });
    mapRef.current?.sendCommand({ type: 'FIT_BOUNDS' });
    setSelectedParcel(null);
    setRouteInfo(null);
  }, []);

  // Track user location
  useEffect(() => {
    let cancelled = false;

    async function getLocation() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (!cancelled) {
          setUserLocation({ lat: loc.coords.latitude, lon: loc.coords.longitude });
        }
      } catch {
        // Silently ignore — location will show when available
      }
    }

    void getLocation();
    const interval = setInterval(getLocation, 15_000);
    locationIntervalRef.current = interval;

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Send data to map when ready
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

    if (destinations?.length) {
      const destData: DestinationMapData[] = destinations.map((d) => {
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
  }, [mapReady, parcels, destinations]);

  // Send machine markers to map
  useEffect(() => {
    if (!mapReady) return;
    if (relatedMachines?.length) {
      const machineData: MachineMarkerData[] = relatedMachines.map((m) => ({
        id: m.machineId,
        machineCode: m.machineCode,
        machineType: m.machineType,
        lat: m.lat,
        lon: m.lon,
        operatorName: m.operatorName,
      }));
      mapRef.current?.sendCommand({ type: 'SET_MACHINES', machines: machineData });
    }
  }, [mapReady, relatedMachines]);

  // Update user location on map
  useEffect(() => {
    if (!mapReady || !userLocation) return;
    mapRef.current?.sendCommand({
      type: 'SET_USER_LOCATION',
      lat: userLocation.lat,
      lon: userLocation.lon,
    });
  }, [mapReady, userLocation]);

  // Focus on specific parcel/destination from task list
  useEffect(() => {
    if (!mapReady || !focusId) return;
    // Try highlighting as parcel first
    mapRef.current?.sendCommand({ type: 'HIGHLIGHT_PARCEL', parcelId: focusId });
  }, [mapReady, focusId]);

  const handleMapReady = useCallback(() => {
    setMapReady(true);
  }, []);

  const handleMapEvent = useCallback(
    (event: MapEvent) => {
      if (event.type === 'PARCEL_TAPPED') {
        const parcel = parcels?.find((p) => p.id === event.parcelId);
        if (parcel) {
          mapRef.current?.sendCommand({ type: 'CLEAR_ROUTE' });
          setRouteInfo(null);
          const center = toLatLon(parcel.centroid);
          setSelectedParcel({
            id: parcel.id,
            name: parcel.name,
            code: parcel.code,
            areaHectares: parcel.areaHectares,
            municipality: parcel.municipality,
            harvestStatus: parcel.harvestStatus,
            centroidLat: center?.lat,
            centroidLon: center?.lon,
          });
          mapRef.current?.sendCommand({ type: 'HIGHLIGHT_PARCEL', parcelId: parcel.id });
        }
      } else if (event.type === 'DESTINATION_TAPPED') {
        const dest = destinations?.find((d) => d.id === event.destinationId);
        if (dest) {
          mapRef.current?.sendCommand({ type: 'CLEAR_ROUTE' });
          setRouteInfo(null);
          const center = toLatLon(dest.coords);
          setSelectedParcel({
            id: dest.id,
            name: dest.name,
            code: dest.code,
            centroidLat: center?.lat,
            centroidLon: center?.lon,
          });
        }
      }
    },
    [parcels, destinations],
  );

  const handleNavigateOnMap = useCallback(async () => {
    if (!selectedItem || !userLocation) {
      Alert.alert('Eroare', 'Locația curentă nu este disponibilă.');
      return;
    }
    if (selectedItem.centroidLat == null || selectedItem.centroidLon == null) {
      Alert.alert('Eroare', 'Coordonatele destinației nu sunt disponibile.');
      return;
    }

    setIsLoadingRoute(true);
    const result = await calculateRoute(userLocation, {
      lat: selectedItem.centroidLat,
      lon: selectedItem.centroidLon,
    });
    setIsLoadingRoute(false);

    if (result) {
      mapRef.current?.sendCommand({
        type: 'SET_ROUTE',
        points: result.points,
        distanceKm: result.distanceKm,
        durationMin: result.durationMin,
      });
      setRouteInfo({
        distanceKm: result.distanceKm,
        durationMin: result.durationMin,
      });
    } else {
      // Fallback: straight line
      mapRef.current?.sendCommand({
        type: 'SET_ROUTE',
        points: [
          userLocation,
          { lat: selectedItem.centroidLat, lon: selectedItem.centroidLon },
        ],
      });
      const approxKm = haversineKm(userLocation, {
        lat: selectedItem.centroidLat,
        lon: selectedItem.centroidLon,
      });
      setRouteInfo({
        distanceKm: approxKm,
        durationMin: 0,
      });
      Alert.alert('Info', 'Ruta detaliată necesită internet. Se afișează linie directă.');
    }
  }, [selectedItem, userLocation]);

  const handleDismiss = useCallback(() => {
    handleReset();
  }, [handleReset]);

  const showOverlayControls = selectedItem !== null || routeInfo !== null;

  return (
    <View style={styles.container}>
      <MapView ref={mapRef} onEvent={handleMapEvent} onReady={handleMapReady} />
      {showOverlayControls && (
        <TouchableOpacity
          style={styles.resetFab}
          onPress={handleReset}
          accessibilityRole="button"
          accessibilityLabel="Resetează harta"
        >
          <Text style={styles.resetFabText}>Reset</Text>
        </TouchableOpacity>
      )}
      {selectedItem && (
        <ParcelInfoSheet
          parcel={selectedItem}
          routeInfo={routeInfo}
          hasUserLocation={userLocation !== null}
          onPreviewRoute={handleNavigateOnMap}
          onDismiss={handleDismiss}
          isLoadingRoute={isLoadingRoute}
        />
      )}
    </View>
  );
}

interface SelectedMapItem {
  id: string;
  name: string | null;
  code: string;
  areaHectares?: number;
  municipality?: string;
  harvestStatus?: string;
  centroidLat?: number;
  centroidLon?: number;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  resetFab: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  resetFabText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0A5C36',
  },
});
