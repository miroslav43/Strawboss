import { useMemo } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '@strawboss/ui-tokens';
import { useDeliveryDestinations } from '@strawboss/api';
import { mobileApiClient } from '@/lib/api-client';
import { boundaryCentroidLonLat } from '@/lib/point-in-geojson';
import { mobileLogger } from '@/lib/logger';
import { useI18n } from '@/lib/i18n';

interface OpenMapsToDepotButtonProps {
  tripId: string;
  destinationId?: string | null;
  destinationName?: string | null;
  destinationAddress?: string | null;
}

/**
 * Opens Google Maps with driving directions to the delivery destination (depot).
 * Depots store a boundary (no point), so we navigate to the boundary centroid
 * when the depot is resolvable by id; otherwise we fall back to the destination
 * address/name as a maps search query.
 */
export function OpenMapsToDepotButton({
  tripId,
  destinationId,
  destinationName,
  destinationAddress,
}: OpenMapsToDepotButtonProps) {
  const { t } = useI18n();
  const { data: depots } = useDeliveryDestinations(mobileApiClient);

  // Resolve the maps `destination` param: precise centroid when we can, else a
  // text query from the address/name.
  const target = useMemo<string | null>(() => {
    const depot = destinationId ? (depots ?? []).find((d) => d.id === destinationId) : null;
    if (depot?.boundary) {
      const c = boundaryCentroidLonLat(depot.boundary);
      if (c) return `${c.lat},${c.lon}`;
    }
    const query = destinationAddress || destinationName || depot?.address || null;
    return query ? encodeURIComponent(query) : null;
  }, [depots, destinationId, destinationAddress, destinationName]);

  const disabled = !target;

  const onPress = async () => {
    if (!target) return;
    try {
      await Haptics.selectionAsync();
    } catch {
      // Haptics missing on some platforms — ignore.
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${target}&travelmode=driving`;
    mobileLogger.info('OpenMapsToDepot pressed', {
      feature: 'driver.open-maps-to-depot',
      tripId,
      destinationId: destinationId ?? null,
    });
    const can = await Linking.canOpenURL(url);
    if (!can) {
      Alert.alert(
        t('map.parcelSheet.startGoogleMaps'),
        t('map.mapScreen.error.googleMaps.message'),
      );
      return;
    }
    await Linking.openURL(url);
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={[styles.btn, disabled && styles.btnDisabled]}
      accessibilityRole="button"
      accessibilityLabel={t('parcel.detail.navigate')}
    >
      <MaterialCommunityIcons
        name="map-marker-radius"
        size={20}
        color={disabled ? '#9aa0a6' : '#FFFFFF'}
      />
      <Text style={[styles.text, disabled && styles.textDisabled]}>
        {disabled ? t('map.mapScreen.error.noDestinationCoords') : t('parcel.detail.navigate')}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  btnDisabled: {
    backgroundColor: 'rgba(154, 160, 166, 0.18)',
  },
  text: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  textDisabled: {
    color: '#9aa0a6',
  },
});
