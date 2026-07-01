import { useMemo } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '@strawboss/ui-tokens';
import { useMachineLastLocation } from '@/hooks/useMachineLastLocation';
import { useCachedParcels } from '@/hooks/useCachedParcels';
import { parseGeoPoint } from '@/lib/routing';
import { boundaryCentroidLonLat } from '@/lib/point-in-geojson';
import { mobileLogger } from '@/lib/logger';
import { useI18n } from '@/lib/i18n';

interface NavigateToLoaderButtonProps {
  tripId: string;
  /** Trip's loader machine (`trip.loader_id`) — its live GPS is the first target. */
  loaderMachineId?: string | null;
  /** Trip's loading parcel (`trip.source_parcel_id`) — the fallback field target. */
  sourceParcelId?: string | null;
}

type Resolved = { target: string; mode: 'live' | 'field' };

/**
 * Trip-screen button that navigates the driver to the loader, with a fallback
 * chain decided by the user:
 *   1. the loader machine's live GPS, IF it reported within the last 30 min
 *      (server-enforced window via {@link useMachineLastLocation});
 *   2. otherwise the loading field — the source parcel's centroid.
 * Disabled when neither is resolvable (no recent loader fix + parcel geometry
 * not cached offline). Opens the same Google Maps deep link as the depot button.
 */
export function NavigateToLoaderButton({
  tripId,
  loaderMachineId,
  sourceParcelId,
}: NavigateToLoaderButtonProps) {
  const { t } = useI18n();
  const { data: live } = useMachineLastLocation(loaderMachineId ?? null);
  const { parcels } = useCachedParcels();

  const resolved = useMemo<Resolved | null>(() => {
    // 1. Live loader position — the API only returns a row inside the 30-min window.
    if (live && typeof live.lat === 'number' && typeof live.lon === 'number') {
      return { target: `${live.lat},${live.lon}`, mode: 'live' };
    }
    // 2. Loading field — source parcel centroid (point first, polygon centroid otherwise).
    if (sourceParcelId) {
      const parcel = parcels.find((p) => p.id === sourceParcelId);
      if (parcel) {
        const point = parseGeoPoint(parcel.centroid) ?? boundaryCentroidLonLat(parcel.boundary);
        if (point) return { target: `${point.lat},${point.lon}`, mode: 'field' };
      }
    }
    return null;
  }, [live, parcels, sourceParcelId]);

  const disabled = !resolved;

  const onPress = async () => {
    if (!resolved) return;
    try {
      await Haptics.selectionAsync();
    } catch {
      // Haptics missing on some platforms — ignore.
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${resolved.target}&travelmode=driving`;
    mobileLogger.info('NavigateToLoader pressed', {
      feature: 'driver.navigate-to-loader',
      tripId,
      mode: resolved.mode,
      loaderMachineId: loaderMachineId ?? null,
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

  const label = disabled
    ? t('tripDetail.navigate.unavailable')
    : resolved.mode === 'live'
      ? t('tripDetail.navigate.toLoaderLive')
      : t('tripDetail.navigate.toField');

  const icon = disabled
    ? 'map-marker-off'
    : resolved.mode === 'live'
      ? 'crosshairs-gps'
      : 'tractor';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={[styles.btn, disabled && styles.btnDisabled]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons name={icon} size={20} color={disabled ? '#9aa0a6' : colors.primary} />
      <Text style={[styles.text, disabled && styles.textDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: '#FFFFFF',
  },
  btnDisabled: {
    borderColor: 'rgba(154, 160, 166, 0.4)',
    backgroundColor: 'rgba(154, 160, 166, 0.10)',
  },
  text: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  textDisabled: {
    color: '#9aa0a6',
  },
});
