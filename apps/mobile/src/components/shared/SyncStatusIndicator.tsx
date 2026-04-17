import { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
      <Animated.View
        style={{ transform: [{ rotate: spin }] }}
        accessibilityLabel="Sincronizare în curs"
      >
        <MaterialCommunityIcons name="sync" size={20} color={colors.neutral} />
      </Animated.View>
    );
  }

  if (pendingCount > 0) {
    return (
      <View style={styles.container} accessibilityLabel={`${pendingCount} operații în așteptare`}>
        <MaterialCommunityIcons name="arrow-up" size={20} color={colors.neutral} />
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{pendingCount}</Text>
        </View>
      </View>
    );
  }

  return (
    <MaterialCommunityIcons
      name="check-circle-outline"
      size={20}
      color={colors.success}
      accessibilityLabel="Sincronizat"
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
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
