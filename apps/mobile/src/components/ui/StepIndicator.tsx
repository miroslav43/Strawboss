import { View, StyleSheet } from 'react-native';
import { colors } from '@strawboss/ui-tokens';

interface StepIndicatorProps {
  /** Total number of steps in the flow (1-based). */
  totalSteps: number;
  /** Current step index (0-based). */
  currentStep: number;
}

/**
 * FM-10: Horizontal step indicator for multi-step flows.
 *
 * Displays `totalSteps` segments (filled vs unfilled) to show the user's
 * position inside a flow. Designed to sit between the screen header and the
 * main content area.
 *
 * Design choices:
 *  - Segments instead of dots: scale well across 3–6 steps without
 *    overcrowding on small screens.
 *  - Completed steps: primary green fill.
 *  - Current step: secondary green (slightly lighter) so it reads as "active".
 *  - Future steps: neutral200 (muted).
 *  - Accessible: the container declares `accessibilityLabel` so screen readers
 *    announce "Pasul X din N".
 *
 * Model: similar approach to TripProgress.tsx but segment-based instead of
 * dot + connecting line, which suits shorter flows better.
 */
export function StepIndicator({ totalSteps, currentStep }: StepIndicatorProps) {
  return (
    <View
      style={styles.container}
      accessible
      accessibilityLabel={`Pasul ${currentStep + 1} din ${totalSteps}`}
      accessibilityRole="progressbar"
    >
      {Array.from({ length: totalSteps }).map((_, index) => {
        const isCompleted = index < currentStep;
        const isCurrent = index === currentStep;
        return (
          <View
            key={index}
            style={[
              styles.segment,
              isCompleted && styles.segmentCompleted,
              isCurrent && styles.segmentCurrent,
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 6,
    backgroundColor: 'transparent',
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.neutral200,
  },
  segmentCompleted: {
    backgroundColor: colors.primary,
  },
  segmentCurrent: {
    backgroundColor: colors.secondary,
  },
});
