import { useMemo } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '@strawboss/ui-tokens';
import { useNearbyLoaders } from '@/hooks/useNearbyLoaders';
import { mobileLogger } from '@/lib/logger';
import { useI18n } from '@/lib/i18n';

interface OpenMapsToLoaderButtonProps {
  /** The trip this button is rendered on — used for log correlation. */
  tripId: string;
  /**
   * Optional pre-resolved loader machine ID (Plan C will write this on the
   * local trip record). When set, T16 prefers the matching loader from the
   * nearby list; otherwise it falls back to the closest one.
   */
  loaderMachineId?: string | null;
}

/**
 * Compact button rendered inside the driver trip card. Opens the native
 * maps app with directions from the driver's current position to the
 * loader's last known GPS.
 *
 * Self-contained — no new sync-blocking calls. Uses the existing
 * `useNearbyLoaders` hook which is already polled on the driver home.
 */
export function OpenMapsToLoaderButton({ tripId, loaderMachineId }: OpenMapsToLoaderButtonProps) {
  const { t } = useI18n();
  const { data: loaders } = useNearbyLoaders();

  const closest = useMemo(() => {
    const list = loaders ?? [];
    if (loaderMachineId) {
      const explicit = list.find((l) => l.id === loaderMachineId);
      if (explicit) return explicit;
    }
    if (list.length === 0) return null;
    return [...list].sort((a, b) => a.distanceM - b.distanceM)[0];
  }, [loaders, loaderMachineId]);

  const disabled = !closest;

  const onPress = async () => {
    if (!closest) return;
    try {
      await Haptics.selectionAsync();
    } catch {
      // Haptics module missing on some platforms — ignore.
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${closest.lat},${closest.lon}&travelmode=driving`;
    mobileLogger.info('OpenMapsToLoader pressed', {
      feature: 'driver.open-maps-to-loader',
      tripId,
      loaderId: closest.id,
      distanceM: closest.distanceM,
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
      activeOpacity={0.7}
      style={[styles.btn, disabled && styles.btnDisabled]}
      accessibilityRole="button"
      accessibilityLabel={
        disabled ? t('loader.home.noTrucksNearbyTitle') : t('map.parcelSheet.startGoogleMaps')
      }
    >
      <MaterialCommunityIcons
        name="map-marker-distance"
        size={14}
        color={disabled ? '#9aa0a6' : colors.primary}
      />
      <Text style={[styles.text, disabled && styles.textDisabled]}>
        {disabled ? t('loader.home.truckFallbackLabel') : t('map.parcelSheet.startGoogleMaps')}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(10, 92, 54, 0.08)',
  },
  btnDisabled: {
    backgroundColor: 'rgba(154, 160, 166, 0.12)',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  textDisabled: {
    color: '#9aa0a6',
  },
});
