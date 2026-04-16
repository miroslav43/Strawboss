import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import * as Linking from 'expo-linking';
import { getGeoUri } from '@/lib/routing';

interface ParcelInfo {
  id: string;
  name: string | null;
  code: string;
  areaHectares?: number;
  municipality?: string;
  harvestStatus?: string;
  centroidLat?: number;
  centroidLon?: number;
}

interface ParcelInfoSheetProps {
  parcel: ParcelInfo;
  onNavigateOnMap: () => void;
  onDismiss: () => void;
  isLoadingRoute?: boolean;
}

const HARVEST_LABELS: Record<string, string> = {
  planned: 'Planificat',
  to_harvest: 'De recoltat',
  harvesting: 'Se recoltează',
  harvested: 'Recoltat',
};

export function ParcelInfoSheet({
  parcel,
  onNavigateOnMap,
  onDismiss,
  isLoadingRoute,
}: ParcelInfoSheetProps) {
  const handleExternalNav = async () => {
    if (parcel.centroidLat == null || parcel.centroidLon == null) return;
    const url = getGeoUri(parcel.centroidLat, parcel.centroidLon);
    try {
      await Linking.openURL(url);
    } catch {
      // Fallback: try google maps web URL
      await Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${parcel.centroidLat},${parcel.centroidLon}`,
      );
    }
  };

  return (
    <Pressable style={styles.backdrop} onPress={onDismiss}>
      <Pressable style={styles.sheet} onPress={() => {}}>
        <View style={styles.handle} />

        <Text style={styles.name}>{parcel.name || parcel.code}</Text>
        {parcel.name && parcel.code ? (
          <Text style={styles.code}>{parcel.code}</Text>
        ) : null}

        <View style={styles.infoRow}>
          {parcel.areaHectares != null && (
            <View style={styles.infoPill}>
              <Text style={styles.infoLabel}>Suprafață</Text>
              <Text style={styles.infoValue}>{parcel.areaHectares} ha</Text>
            </View>
          )}
          {parcel.harvestStatus && (
            <View style={styles.infoPill}>
              <Text style={styles.infoLabel}>Status</Text>
              <Text style={styles.infoValue}>
                {HARVEST_LABELS[parcel.harvestStatus] ?? parcel.harvestStatus}
              </Text>
            </View>
          )}
          {parcel.municipality && (
            <View style={styles.infoPill}>
              <Text style={styles.infoLabel}>Localitate</Text>
              <Text style={styles.infoValue}>{parcel.municipality}</Text>
            </View>
          )}
        </View>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={styles.navButton}
            onPress={onNavigateOnMap}
            disabled={isLoadingRoute}
          >
            {isLoadingRoute ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.navButtonText}>Navighează pe hartă</Text>
            )}
          </TouchableOpacity>

          {parcel.centroidLat != null && parcel.centroidLon != null && (
            <TouchableOpacity style={styles.extButton} onPress={handleExternalNav}>
              <Text style={styles.extButtonText}>Deschide navigația</Text>
            </TouchableOpacity>
          )}
        </View>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D7CCC8',
    alignSelf: 'center',
    marginBottom: 4,
  },
  name: { fontSize: 20, fontWeight: '700', color: '#0A5C36' },
  code: { fontSize: 13, color: '#8D6E63', marginTop: -6 },
  infoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoPill: {
    backgroundColor: '#F3DED8',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  infoLabel: { fontSize: 11, color: '#8D6E63', fontWeight: '500' },
  infoValue: { fontSize: 14, color: '#374151', fontWeight: '600' },
  buttons: { gap: 8, marginTop: 4 },
  navButton: {
    backgroundColor: '#0A5C36',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  navButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  extButton: {
    borderWidth: 2,
    borderColor: '#0A5C36',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  extButtonText: { color: '#0A5C36', fontSize: 15, fontWeight: '600' },
});
