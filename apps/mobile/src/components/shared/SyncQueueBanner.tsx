import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@strawboss/ui-tokens';
import { useSyncQueueStatus } from '@/hooks/useSyncQueueStatus';

/**
 * Unobtrusive sync status banner mounted at the bottom of every role layout.
 *
 * States:
 * - Queue empty + last sync OK → shows „Tot sincronizat" briefly, then hides.
 * - Pending entries → „N înregistrări în așteptare · sincronizez…" with spinner.
 * - Failed entries → amber warning with „N nesincronizate — atinge pentru detalii".
 * - Tapping navigates to the /sync-details screen.
 */
export function SyncQueueBanner() {
  const router = useRouter();
  const { pendingCount, failedCount, syncing, lastSyncAt } = useSyncQueueStatus();

  // Spinner animation
  const spinValue = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef<Animated.CompositeAnimation | null>(null);

  // Auto-hide the "all synced" banner after a delay
  const [showAllSynced, setShowAllSynced] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Determine banner state
  const hasFailures = failedCount > 0;
  const hasPending = pendingCount > 0;
  const isActive = hasFailures || hasPending || syncing;

  // Track when everything clears to show the "all synced" confirmation
  const prevActive = useRef(false);
  useEffect(() => {
    if (prevActive.current && !isActive && lastSyncAt !== null) {
      setShowAllSynced(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        setShowAllSynced(false);
      }, 4000);
    }
    prevActive.current = isActive;
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [isActive, lastSyncAt]);

  // Spinner: start when syncing, stop otherwise
  useEffect(() => {
    if (syncing) {
      spinValue.setValue(0);
      spinAnim.current = Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 900,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      spinAnim.current.start();
    } else {
      spinAnim.current?.stop();
      spinValue.setValue(0);
    }
    return () => {
      spinAnim.current?.stop();
    };
  }, [syncing, spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const handlePress = () => {
    router.push('/sync-details');
  };

  // Nothing to show
  if (!isActive && !showAllSynced) return null;

  // "All synced" confirmation
  if (!isActive && showAllSynced) {
    return (
      <View
        style={[styles.banner, styles.successBanner]}
        accessibilityRole="text"
        accessibilityLabel="Tot sincronizat"
      >
        <MaterialCommunityIcons name="check-circle-outline" size={16} color={colors.white} />
        <Text style={styles.bannerText}>Tot sincronizat</Text>
      </View>
    );
  }

  // Failed entries take priority in styling
  if (hasFailures) {
    const label =
      failedCount === 1
        ? '1 înregistrare nesincronizată — atinge pentru detalii'
        : `${failedCount} înregistrări nesincronizate — atinge pentru detalii`;
    return (
      <TouchableOpacity
        style={[styles.banner, styles.failedBanner]}
        onPress={handlePress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.white} />
        <Text style={[styles.bannerText, styles.bannerTextFlex]} numberOfLines={1}>
          {label}
        </Text>
        <MaterialCommunityIcons name="chevron-right" size={16} color={colors.white} />
      </TouchableOpacity>
    );
  }

  // Pending / in-progress
  const pendingLabel =
    pendingCount === 1
      ? '1 înregistrare în așteptare'
      : `${pendingCount} înregistrări în așteptare`;
  const label = syncing ? `${pendingLabel} · sincronizez…` : `${pendingLabel}`;

  return (
    <TouchableOpacity
      style={[styles.banner, styles.pendingBanner]}
      onPress={handlePress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Atinge pentru detalii.`}
    >
      {syncing ? (
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <MaterialCommunityIcons name="sync" size={16} color={colors.white} />
        </Animated.View>
      ) : (
        <MaterialCommunityIcons name="arrow-up-circle-outline" size={16} color={colors.white} />
      )}
      <Text style={[styles.bannerText, styles.bannerTextFlex]} numberOfLines={1}>
        {label}
      </Text>
      <MaterialCommunityIcons name="chevron-right" size={16} color={colors.white} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 8,
  },
  successBanner: {
    backgroundColor: colors.success,
  },
  pendingBanner: {
    backgroundColor: colors.primary,
  },
  failedBanner: {
    backgroundColor: colors.warning,
  },
  bannerText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  bannerTextFlex: {
    flex: 1,
  },
});
