import { useEffect, useRef } from 'react';
import { Animated, Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@strawboss/ui-tokens';
import type { UndoToastState } from '@/hooks/useUndoableSave';

interface UndoToastProps {
  state: UndoToastState;
  /**
   * Distance from the bottom of its container (default: 96).
   * Override when the host component has a large bottom button.
   */
  bottomOffset?: number;
}

/**
 * FM-4 — Toast "Anulează" de 5 secunde.
 *
 * Renders an animated toast at the bottom of the screen. When `state.canUndo`
 * is true the "Anulează" button is active; once the sync queue entry is
 * dispatched `canUndo` flips to false and the button is visually disabled.
 */
export function UndoToast({ state, bottomOffset = 96 }: UndoToastProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const prevVisible = useRef(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (state.visible && !prevVisible.current) {
      // Fade in
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    } else if (!state.visible && prevVisible.current) {
      // Fade out
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
    prevVisible.current = state.visible;
  }, [state.visible, fadeAnim]);

  if (!state.visible) return null;

  return (
    <Animated.View
      style={[styles.container, { bottom: bottomOffset + insets.bottom, opacity: fadeAnim }]}
    >
      <View style={styles.content}>
        <MaterialCommunityIcons name="check-circle" size={18} color={colors.white} />
        <Text style={styles.label} numberOfLines={1}>
          {state.label}
        </Text>
        {state.secondsLeft > 0 && <Text style={styles.timer}>{state.secondsLeft}s</Text>}
      </View>
      <TouchableOpacity
        style={[styles.undoButton, !state.canUndo && styles.undoButtonDisabled]}
        onPress={state.canUndo ? state.onUndo : undefined}
        disabled={!state.canUndo}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Anulează înregistrarea"
      >
        <Text style={[styles.undoText, !state.canUndo && styles.undoTextDisabled]}>Anulează</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1B3A2B',
    borderRadius: 14,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
    gap: 6,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  label: {
    flex: 1,
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  timer: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '500',
    minWidth: 20,
    textAlign: 'right',
  },
  undoButton: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginLeft: 4,
  },
  undoButtonDisabled: {
    opacity: 0.35,
  },
  undoText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '700',
  },
  undoTextDisabled: {
    color: 'rgba(255,255,255,0.5)',
  },
});
