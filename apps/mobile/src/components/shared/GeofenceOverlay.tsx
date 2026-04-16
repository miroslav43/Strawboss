import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { NumericPad } from '@/components/ui/NumericPad';
import { BigButton } from '@/components/ui/BigButton';
import type { GeofenceAlert } from '@/hooks/useGeofenceNotifications';

interface GeofenceOverlayProps {
  alert: GeofenceAlert | null;
  onDismiss: () => void;
  onConfirmParcelDone: (assignmentId: string, baleCount?: number) => Promise<void>;
}

/**
 * Overlay displayed on top of all screens when a geofence event occurs.
 *
 * - field_entry / deposit_entry: green/blue banner at top, auto-dismiss 5s
 * - exit_confirm: fullscreen modal with NumericPad for bale count entry
 */
export function GeofenceOverlay({
  alert,
  onDismiss,
  onConfirmParcelDone,
}: GeofenceOverlayProps) {
  if (!alert) return null;

  if (alert.type === 'exit_confirm') {
    return (
      <ExitConfirmModal
        alert={alert}
        onDismiss={onDismiss}
        onConfirm={onConfirmParcelDone}
      />
    );
  }

  return <EntryBanner alert={alert} onDismiss={onDismiss} />;
}

// ── Entry Banner (field_entry / deposit_entry) ───────────────────────

function EntryBanner({
  alert,
  onDismiss,
}: {
  alert: GeofenceAlert;
  onDismiss: () => void;
}) {
  const slideAnim = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    // Slide in
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();

    // Auto-dismiss after 5 seconds
    const timer = setTimeout(() => {
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 300,
        useNativeDriver: true,
      }).start(() => onDismiss());
    }, 5000);

    return () => clearTimeout(timer);
  }, [slideAnim, onDismiss]);

  const isDeposit = alert.type === 'deposit_entry';
  const bgColor = isDeposit ? '#1565C0' : '#2E7D32';
  const icon = isDeposit ? '\uD83C\uDFED' : '\uD83C\uDF3E'; // 🏭 / 🌾
  const message = isDeposit
    ? 'Ai ajuns la depozit'
    : `Ai început câmpul ${alert.parcelName}`;

  return (
    <Animated.View
      style={[
        styles.bannerContainer,
        { backgroundColor: bgColor, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <Pressable style={styles.bannerContent} onPress={onDismiss}>
        <Text style={styles.bannerIcon}>{icon}</Text>
        <Text style={styles.bannerText}>{message}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ── Exit Confirm Modal (with bale count input) ──────────────────────

function ExitConfirmModal({
  alert,
  onDismiss,
  onConfirm,
}: {
  alert: GeofenceAlert;
  onDismiss: () => void;
  onConfirm: (assignmentId: string, baleCount?: number) => Promise<void>;
}) {
  const [baleCount, setBaleCount] = useState('');
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const count = parseInt(baleCount, 10);
      const validCount = !isNaN(count) && count > 0 ? count : undefined;
      await onConfirm(alert.assignmentId, validCount);
    } catch {
      // best-effort — server handles via sync
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.modalBackdrop}>
      <View style={styles.modalContent}>
        <View style={styles.modalHandle} />

        <Text style={styles.modalIcon}>{'\uD83C\uDF3E'}</Text>
        <Text style={styles.modalTitle}>
          Ai terminat câmpul{'\n'}
          <Text style={styles.modalParcelName}>{alert.parcelName}</Text>?
        </Text>

        <Text style={styles.modalSubtitle}>
          Câți baloți ai produs pe acest câmp?
        </Text>

        <NumericPad value={baleCount} onChange={setBaleCount} maxLength={4} />

        <View style={styles.modalActions}>
          <BigButton
            title={saving ? '' : 'Confirmă'}
            onPress={handleConfirm}
            disabled={saving}
          />
          {saving && (
            <ActivityIndicator
              color="#FFF"
              style={StyleSheet.absoluteFill}
            />
          )}
          <BigButton
            title="Nu am terminat"
            variant="outline"
            onPress={onDismiss}
            disabled={saving}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Banner ──
  bannerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingTop: 50, // safe area
    paddingBottom: 16,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 10,
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bannerIcon: {
    fontSize: 28,
  },
  bannerText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },

  // ── Exit Modal ──
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    zIndex: 9999,
  },
  modalContent: {
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 16,
    alignItems: 'center',
    maxHeight: '90%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D7CCC8',
  },
  modalIcon: {
    fontSize: 48,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0A5C36',
    textAlign: 'center',
    lineHeight: 30,
  },
  modalParcelName: {
    color: '#B7791F',
  },
  modalSubtitle: {
    fontSize: 15,
    color: '#5D4037',
    textAlign: 'center',
  },
  modalActions: {
    gap: 10,
    width: '100%',
    marginTop: 8,
  },
});
