import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors } from '@strawboss/ui-tokens';
import {
  GeofenceEditorView,
  type GeofenceEditorViewHandle,
} from '@/components/map/GeofenceEditorView';

interface PointPickerProps {
  visible: boolean;
  initialCoord?: { lat: number; lon: number } | null;
  onPick: (coord: { lat: number; lon: number }) => void;
  onCancel: () => void;
  /** Optional banner override (default: Deplasează harta sub punct …). */
  bannerText?: string;
}

const DETA_CENTER = { lat: 45.3883, lon: 21.2311 };

/**
 * T1 — reusable centre-pin point picker. Pans the existing 2D satellite
 * map under a fixed round pin and commits the centre coordinate on press.
 */
export function PointPicker({
  visible,
  initialCoord,
  onPick,
  onCancel,
  bannerText = 'Deplasează harta sub punct și apasă Adaugă',
}: PointPickerProps) {
  const mapRef = useRef<GeofenceEditorViewHandle | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(true);

  // Auto-fade the helper banner after 4 s.
  useEffect(() => {
    if (!visible) return;
    setBannerVisible(true);
    const id = setTimeout(() => setBannerVisible(false), 4000);
    return () => clearTimeout(id);
  }, [visible]);

  // Resolve the initial centre: prop > GPS > Deta. Race the GPS lookup
  // against a 4 s timeout so a hanging permission dialog can't block us.
  const computeInitialCoord = useCallback(async () => {
    if (initialCoord) return initialCoord;
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return DETA_CENTER;
      const loc = await Promise.race<Location.LocationObject | null>([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
      ]);
      if (!loc) return DETA_CENTER;
      return { lat: loc.coords.latitude, lon: loc.coords.longitude };
    } catch {
      return DETA_CENTER;
    }
  }, [initialCoord]);

  // Once the WebView reports MAP_READY, centre and switch on the pin.
  useEffect(() => {
    if (!visible || !mapReady) return;
    let cancelled = false;
    void (async () => {
      const coord = await computeInitialCoord();
      if (cancelled) return;
      mapRef.current?.sendCommand({ type: 'CENTER_ON', lat: coord.lat, lon: coord.lon, zoom: 17 });
      mapRef.current?.sendCommand({ type: 'ENABLE_POINT_DRAW' });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.sendCommand({ type: 'DISABLE_POINT_DRAW' });
    };
  }, [visible, mapReady, computeInitialCoord]);

  const handleEvent = useCallback(
    (evt: { type: string; lat?: number; lon?: number }) => {
      if (
        evt.type === 'POINT_DRAWN' &&
        typeof evt.lat === 'number' &&
        typeof evt.lon === 'number'
      ) {
        onPick({ lat: evt.lat, lon: evt.lon });
      }
    },
    [onPick],
  );

  const handleAddPoint = useCallback(() => {
    mapRef.current?.sendCommand({ type: 'GET_CENTER' });
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
    >
      <View style={styles.root}>
        <GeofenceEditorView ref={mapRef} onReady={() => setMapReady(true)} onEvent={handleEvent} />

        {/* Top-left cancel button */}
        <TouchableOpacity
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Anulează"
          style={styles.cancelBtn}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="close" size={22} color="#fff" />
        </TouchableOpacity>

        {/* Auto-fading helper banner */}
        {bannerVisible && (
          <View pointerEvents="none" style={styles.banner}>
            <Text style={styles.bannerText}>{bannerText}</Text>
          </View>
        )}

        {/* Right-side big "Adaugă punct" button */}
        <TouchableOpacity
          onPress={handleAddPoint}
          accessibilityRole="button"
          accessibilityLabel="Adaugă punct"
          activeOpacity={0.85}
          style={styles.addBtn}
        >
          <MaterialCommunityIcons name="map-marker-plus" size={28} color="#fff" />
          <Text style={styles.addBtnText}>Adaugă{'\n'}punct</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  cancelBtn: {
    position: 'absolute',
    top: 44,
    left: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  banner: {
    position: 'absolute',
    top: 52,
    left: 70,
    right: 84,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 999,
    alignItems: 'center',
  },
  bannerText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  addBtn: {
    position: 'absolute',
    right: 12,
    top: '50%',
    transform: [{ translateY: -70 }],
    width: 64,
    minHeight: 140,
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  addBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
  },
});
