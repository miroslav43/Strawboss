import { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing } from 'react-native';
import { colors } from '@strawboss/ui-tokens';

interface SyncStatusIndicatorProps {
  syncing: boolean;
  pendingCount: number;
}

export function SyncStatusIndicator({
  syncing,
  pendingCount,
}: SyncStatusIndicatorProps) {
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (syncing) {
      const animation = Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      animation.start();
      return () => animation.stop();
    } else {
      spinValue.setValue(0);
    }
  }, [syncing, spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  if (syncing) {
    return (
      <View style={styles.container}>
        <Animated.Text
          style={[styles.icon, { transform: [{ rotate: spin }] }]}
        >
          {'\u21BB'}
        </Animated.Text>
      </View>
    );
  }

  if (pendingCount > 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.icon}>{'\u2191'}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{pendingCount}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.checkIcon}>{'\u2713'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  icon: {
    fontSize: 20,
    color: colors.neutral,
  },
  checkIcon: {
    fontSize: 20,
    color: colors.success,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: colors.warning,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '700',
  },
});
