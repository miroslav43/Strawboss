import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fontScale } from '@/utils/responsive';
import { colors } from '@strawboss/ui-tokens';

interface ConfirmCountdownProps {
  /** Whether the overlay is visible. */
  visible: boolean;
  /**
   * Label for the action being confirmed (shown as "Acțiunea în X…").
   * Keep it short — e.g. "Plecare", "Livrare confirmată", "CMR confirmat".
   */
  actionLabel: string;
  /** Countdown duration in seconds (default: 3). */
  countdownSeconds?: number;
  /**
   * Called when the countdown reaches zero. This is where you execute
   * the actual irreversible action.
   */
  onConfirmed: () => void;
  /**
   * Called when the user taps "Anulează" during the countdown.
   * Should hide the overlay (set `visible` to false).
   */
  onCancel: () => void;
  /**
   * Optional label for an "accept now" button. When provided, an extra button
   * is shown that fires `onConfirmed` immediately instead of waiting for the
   * countdown to expire. Omit it to keep the cancel-only behaviour.
   */
  confirmLabel?: string;
}

/**
 * FM-6 — Confirmare cu countdown pentru acțiuni ireversibile.
 *
 * Displays a full-screen overlay with a countdown (default 3 s). The action
 * is only executed after the countdown expires. The user can cancel at any
 * point before that.
 *
 * Usage:
 *   const [showCountdown, setShowCountdown] = useState(false);
 *
 *   <ConfirmCountdown
 *     visible={showCountdown}
 *     actionLabel="Plecare"
 *     onConfirmed={() => { setShowCountdown(false); void handleDepart(); }}
 *     onCancel={() => setShowCountdown(false)}
 *   />
 *
 *   <BigButton title="Pleacă" onPress={() => setShowCountdown(true)} />
 */
export function ConfirmCountdown({
  visible,
  actionLabel,
  countdownSeconds = 3,
  onConfirmed,
  onCancel,
  confirmLabel,
}: ConfirmCountdownProps) {
  const [remaining, setRemaining] = useState(countdownSeconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const hasConfirmedRef = useRef(false);
  // Keep the latest onConfirmed in a ref so a change in its identity (e.g. the
  // parent re-renders when an async value like the depot contact resolves) does
  // NOT restart the countdown or reset hasConfirmedRef — which could otherwise
  // reset the timer mid-flight or double-fire the action.
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  const clearCountdown = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Pulse animation for the countdown digit
  const pulse = useCallback(() => {
    scaleAnim.setValue(1.3);
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 4,
      tension: 200,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  useEffect(() => {
    if (!visible) {
      clearCountdown();
      setRemaining(countdownSeconds);
      hasConfirmedRef.current = false;
      fadeAnim.setValue(0);
      return;
    }

    // Fade in the overlay
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();

    setRemaining(countdownSeconds);
    hasConfirmedRef.current = false;
    pulse();

    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        const next = prev - 1;
        if (next > 0) {
          pulse();
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          return next;
        }
        // Reached zero — fire confirmed once
        clearCountdown();
        if (!hasConfirmedRef.current) {
          hasConfirmedRef.current = true;
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // Defer slightly so React can process this tick's state update first
          setTimeout(() => onConfirmedRef.current(), 0);
        }
        return 0;
      });
    }, 1000);

    return () => {
      clearCountdown();
    };
  }, [visible, countdownSeconds, clearCountdown, pulse, fadeAnim]);

  const handleCancel = useCallback(() => {
    clearCountdown();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onCancel();
  }, [clearCountdown, onCancel]);

  // "Accept now" — fire the action immediately instead of waiting out the
  // countdown. Guarded so it can't double-fire with the expiry handler.
  const handleConfirmNow = useCallback(() => {
    if (hasConfirmedRef.current) return;
    hasConfirmedRef.current = true;
    clearCountdown();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onConfirmedRef.current();
  }, [clearCountdown]);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleCancel}
      statusBarTranslucent
    >
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        <View style={styles.card}>
          <View style={styles.iconRow}>
            <MaterialCommunityIcons name="timer-sand" size={32} color={colors.primary} />
          </View>

          <Text style={styles.actionTitle}>{actionLabel}</Text>
          <Text style={styles.countdownLabel}>se execută în</Text>

          <Animated.Text style={[styles.countdownDigit, { transform: [{ scale: scaleAnim }] }]}>
            {remaining}
          </Animated.Text>

          {confirmLabel ? (
            <TouchableOpacity
              style={styles.confirmButton}
              onPress={handleConfirmNow}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
            >
              <MaterialCommunityIcons name="check-circle" size={20} color={colors.white} />
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Anulează acțiunea"
          >
            <MaterialCommunityIcons name="close-circle" size={20} color={colors.white} />
            <Text style={styles.cancelText}>Anulează</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 300,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 12,
  },
  iconRow: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
  },
  countdownLabel: {
    fontSize: 14,
    color: colors.neutral,
    marginBottom: 4,
  },
  countdownDigit: {
    fontSize: fontScale(72),
    fontWeight: '900',
    color: colors.primary,
    lineHeight: fontScale(80),
    marginBottom: 8,
  },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingHorizontal: 28,
    paddingVertical: 14,
    marginTop: 8,
    width: '100%',
    justifyContent: 'center',
  },
  confirmText: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '800',
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#C62828',
    borderRadius: 16,
    paddingHorizontal: 28,
    paddingVertical: 14,
    marginTop: 8,
    width: '100%',
    justifyContent: 'center',
  },
  cancelText: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '800',
  },
});
