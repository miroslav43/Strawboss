import { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing } from 'react-native';
import { colors } from '@strawboss/ui-tokens';

const STEPS = [
  'planned',
  'loading',
  'loaded',
  'in_transit',
  'arrived',
  'delivering',
  'delivered',
  'completed',
] as const;

const STEP_LABELS: Record<string, string> = {
  planned:    'Plan',
  loading:    'Load',
  loaded:     'Loaded',
  in_transit: 'Transit',
  arrived:    'Arrive',
  delivering: 'Deliver',
  delivered:  'Done',
  completed:  'Complete',
};

interface TripProgressProps {
  currentStatus: string;
}

export function TripProgress({ currentStatus }: TripProgressProps) {
  const currentIndex = STEPS.indexOf(currentStatus as (typeof STEPS)[number]);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.3,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <View style={styles.container}>
      <View style={styles.stepsRow}>
        {STEPS.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent   = index === currentIndex;
          const isFuture    = index > currentIndex;

          return (
            <View key={step} style={styles.stepItem}>
              <View style={styles.dotRow}>
                {index > 0 && (
                  <View
                    style={[
                      styles.line,
                      isCompleted || isCurrent
                        ? styles.lineCompleted
                        : styles.lineFuture,
                    ]}
                  />
                )}
                {isCurrent ? (
                  <Animated.View
                    style={[
                      styles.dot,
                      styles.dotCurrent,
                      { transform: [{ scale: pulseAnim }] },
                    ]}
                  />
                ) : (
                  <View
                    style={[
                      styles.dot,
                      isCompleted && styles.dotCompleted,
                      isFuture    && styles.dotFuture,
                    ]}
                  />
                )}
                {index < STEPS.length - 1 && (
                  <View
                    style={[
                      styles.line,
                      isCompleted ? styles.lineCompleted : styles.lineFuture,
                    ]}
                  />
                )}
              </View>
              <Text
                style={[
                  styles.label,
                  isCurrent && styles.labelCurrent,
                  isFuture  && styles.labelFuture,
                ]}
              >
                {STEP_LABELS[step] ?? step}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    justifyContent: 'center',
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
  },
  dotCompleted: {
    backgroundColor: colors.primary,
  },
  dotCurrent: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.secondary,
  },
  dotFuture: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.neutral200,
  },
  line: {
    flex: 1,
    height: 2,
  },
  lineCompleted: {
    backgroundColor: colors.primary,
  },
  lineFuture: {
    backgroundColor: colors.neutral200,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.neutral,
    textAlign: 'center',
  },
  labelCurrent: {
    color: colors.primary,
    fontWeight: '700',
  },
  labelFuture: {
    color: colors.neutral200,
  },
});
