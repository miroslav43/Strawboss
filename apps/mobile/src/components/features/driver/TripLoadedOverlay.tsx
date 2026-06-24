import { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { TripLoadedAlert } from '@/hooks/useTripLoadedAlert';
import { useI18n } from '@/lib/i18n';

interface Props {
  alert: TripLoadedAlert | null;
  onDismiss: () => void;
  /** @deprecated No longer called — departure now goes through departure-flow screen. */
  onDeparted?: () => void;
}

export function TripLoadedOverlay({ alert, onDismiss }: Props) {
  const { t } = useI18n();
  const slideAnim = useRef(new Animated.Value(400)).current;

  const visible = alert !== null;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 70,
        friction: 12,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 400,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  if (!alert) return null;

  const hasDestination = Boolean(alert.destinationId ?? alert.destinationName);

  const handleDepart = () => {
    onDismiss();
    router.push({
      pathname: '/driver-ops/departure-flow',
      params: { tripId: alert.tripId },
    });
  };

  const handleChooseDestination = () => {
    onDismiss();
    router.push(`/trip/${alert.tripId}`);
  };

  return (
    <View style={styles.backdrop} pointerEvents="box-none">
      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.headerRow}>
          <MaterialCommunityIcons name="truck-check" size={36} color="#0A5C36" />
          <View style={styles.headerText}>
            <Text style={styles.title}>{t('driver.tripLoadedOverlay.title')}</Text>
            {alert.tripNumber ? (
              <Text style={styles.subtitle}>
                {t('driver.tripLoadedOverlay.subtitle').replace('{tripNumber}', alert.tripNumber)}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Bale count */}
        {alert.baleCount > 0 && (
          <View style={styles.infoRow}>
            <MaterialCommunityIcons name="grain" size={18} color="#8D6E63" />
            <Text style={styles.infoText}>
              {t('driver.tripLoadedOverlay.balesLoaded').replace(
                '{count}',
                String(alert.baleCount),
              )}
            </Text>
          </View>
        )}

        {/* Destination */}
        {alert.destinationName ? (
          <View style={styles.infoRow}>
            <MaterialCommunityIcons name="map-marker" size={18} color="#0A5C36" />
            <Text style={[styles.infoText, styles.destText]} numberOfLines={1}>
              {alert.destinationName}
            </Text>
          </View>
        ) : (
          <View style={styles.infoRow}>
            <MaterialCommunityIcons name="alert" size={18} color="#B7791F" />
            <Text style={[styles.infoText, styles.warnText]}>
              {t('driver.tripLoadedOverlay.noDestination')}
            </Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={hasDestination ? handleDepart : handleChooseDestination}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name={hasDestination ? 'arrow-right-bold' : 'warehouse'}
              size={18}
              color="#FFF"
            />
            <Text style={styles.primaryBtnText}>
              {hasDestination
                ? t('driver.tripLoadedOverlay.action.startTrip')
                : t('driver.tripLoadedOverlay.action.chooseDestination')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={onDismiss} activeOpacity={0.8}>
            <Text style={styles.secondaryBtnText}>
              {t('driver.tripLoadedOverlay.action.later')}
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 9998,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D7CCC8',
    alignSelf: 'center',
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0A5C36',
  },
  subtitle: {
    fontSize: 13,
    color: '#8D6E63',
    marginTop: 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoText: {
    fontSize: 15,
    color: '#374151',
    flex: 1,
  },
  destText: {
    color: '#0A5C36',
    fontWeight: '600',
  },
  warnText: {
    color: '#B7791F',
  },
  actions: {
    gap: 10,
    marginTop: 4,
  },
  primaryBtn: {
    backgroundColor: '#0A5C36',
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  secondaryBtnText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '600',
  },
});
