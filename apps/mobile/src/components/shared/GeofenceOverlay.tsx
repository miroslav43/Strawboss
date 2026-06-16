import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { NumericPad } from '@/components/ui/NumericPad';
import { BigButton } from '@/components/ui/BigButton';
import { BalerEntryCountdown } from '@/components/features/production/BalerEntryCountdown';
import { ConfirmCountdown } from '@/components/shared/ConfirmCountdown';
import { useTripTransition } from '@/hooks/useTripTransition';
import { getDatabase } from '@/lib/storage';
import { TripsRepo } from '@/db/trips-repo';
import { mobileLogger } from '@/lib/logger';
import type { GeofenceAlert } from '@/hooks/useGeofenceNotifications';

interface GeofenceOverlayProps {
  alert: GeofenceAlert | null;
  onDismiss: () => void;
  onConfirmParcelDone: (assignmentId: string, baleCount?: number) => Promise<void>;
  /**
   * Enter overlay — fires the auto-confirm POST after the countdown finishes.
   * Optional so layouts that have not wired it up still type-check.
   */
  onConfirmParcelEntry?: (assignmentId: string) => Promise<void>;
  /** Enter overlay — operator tapped Anulează during the countdown. */
  onCancelParcelEntry?: () => void;
  /**
   * Loader field-exit "Da" — reconciles produced vs loaded bales and returns
   * the result so the modal can surface a shortage. Only the loader layout
   * wires this.
   */
  onConfirmParcelLoaded?: (
    assignmentId: string,
  ) => Promise<{ completed: boolean; produced: number; loaded: number; missing: number } | null>;
}

/**
 * Overlay displayed on top of all screens when a geofence event occurs.
 *
 * - field_entry: green banner at top, auto-dismiss 5s
 * - entry_confirm: countdown modal (baler/loader/truck — copy via alert.action)
 * - deposit_entry: bottom-sheet popup with an action to mark arrival
 * - exit_confirm: fullscreen modal with NumericPad for bale count entry (baler)
 * - loaded_confirm: loader field-exit Da/Nu popup + reconciliation result
 */
export function GeofenceOverlay({
  alert,
  onDismiss,
  onConfirmParcelDone,
  onConfirmParcelEntry,
  onCancelParcelEntry,
  onConfirmParcelLoaded,
}: GeofenceOverlayProps) {
  if (!alert) return null;

  if (alert.type === 'entry_confirm') {
    const code = alert.parcelCode ?? alert.parcelName;
    const label =
      alert.action === 'load'
        ? `Începi încărcarea în ${code}`
        : alert.action === 'truck'
          ? `Confirmi sosirea la ${code}`
          : undefined; // undefined → BalerEntryCountdown's default baler copy
    return (
      <BalerEntryCountdown
        parcelCode={code}
        cropType={alert.cropType ?? null}
        label={label}
        onConfirm={() => {
          // Defer to the optional handler when present; otherwise just dismiss
          // so the user is not stuck on the overlay (defensive fallback).
          if (onConfirmParcelEntry) {
            void onConfirmParcelEntry(alert.assignmentId);
          } else {
            onDismiss();
          }
        }}
        onCancel={() => {
          if (onCancelParcelEntry) onCancelParcelEntry();
          else onDismiss();
        }}
      />
    );
  }

  if (alert.type === 'loaded_confirm') {
    return (
      <LoaderExitConfirmModal
        alert={alert}
        onDismiss={onDismiss}
        onConfirm={onConfirmParcelLoaded}
      />
    );
  }

  if (alert.type === 'exit_confirm') {
    return <ExitConfirmModal alert={alert} onDismiss={onDismiss} onConfirm={onConfirmParcelDone} />;
  }

  if (alert.type === 'deposit_entry') {
    return <DepositArrivalCountdown alert={alert} onDismiss={onDismiss} />;
  }

  if (alert.type === 'truck_approaching') {
    return <TruckApproachingBanner alert={alert} onDismiss={onDismiss} />;
  }

  return <EntryBanner alert={alert} onDismiss={onDismiss} />;
}

// ── Entry Banner (field_entry) ───────────────────────────────────────

function EntryBanner({ alert, onDismiss }: { alert: GeofenceAlert; onDismiss: () => void }) {
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const insets = useSafeAreaInsets();

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

  return (
    <Animated.View
      style={[
        styles.bannerContainer,
        {
          paddingTop: insets.top + 12,
          backgroundColor: '#2E7D32',
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <Pressable style={styles.bannerContent} onPress={onDismiss}>
        <MaterialCommunityIcons name="grain" size={28} color="#FFF" />
        <Text style={styles.bannerText} numberOfLines={2}>
          Ai început câmpul {alert.parcelName}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// ── Truck Approaching Banner (truck_approaching) ─────────────────────
//
// One-time alert to a loader: the truck they are waiting for is within 5 km.
// Top banner that slides in, auto-closes after 5 s, and carries an explicit X
// close button. Fire-once is enforced server-side (a single 'approach'
// geofence event per truck/parcel/assignment).

function TruckApproachingBanner({
  alert,
  onDismiss,
}: {
  alert: GeofenceAlert;
  onDismiss: () => void;
}) {
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const insets = useSafeAreaInsets();

  const close = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: -120,
      duration: 300,
      useNativeDriver: true,
    }).start(() => onDismiss());
  }, [slideAnim, onDismiss]);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();

    // Auto-dismiss after 5 seconds.
    const timer = setTimeout(close, 5000);
    return () => clearTimeout(timer);
  }, [slideAnim, close]);

  const plate = alert.truckPlate ?? '—';

  return (
    <Animated.View
      style={[
        styles.bannerContainer,
        {
          paddingTop: insets.top + 12,
          backgroundColor: '#1565C0',
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={styles.bannerContent}>
        <MaterialCommunityIcons name="truck-fast" size={28} color="#FFF" />
        <Text style={styles.bannerText} numberOfLines={2}>
          Camionul {plate} — șoferul se apropie spre tine
        </Text>
        <Pressable
          onPress={close}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Închide"
        >
          <MaterialCommunityIcons name="close" size={26} color="#FFF" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ── Deposit Arrival Countdown (deposit_entry) ────────────────────────
//
// 10s auto-confirm overlay shown when the truck enters the destination deposit
// geofence. If the driver does nothing, the trip moves to "arrived"
// automatically when the countdown expires; they can confirm early or cancel.
// Distance is GPS-derived, so there is no odometer screen — the transition is
// enqueued offline-first and the trip opens so they can proceed to delivery.

function DepositArrivalCountdown({
  alert,
  onDismiss,
}: {
  alert: GeofenceAlert;
  onDismiss: () => void;
}) {
  const { enqueueTransition } = useTripTransition();

  const doArrive = useCallback(async () => {
    if (!alert.tripId) return;
    try {
      const db = await getDatabase();
      const tripsRepo = new TripsRepo(db);
      const trip = await tripsRepo.findById(alert.tripId);
      const currentStatus = trip?.status ?? 'in_transit';
      await enqueueTransition({
        tripId: alert.tripId,
        currentStatus,
        transition: 'arrive',
        body: {},
        localMeta: { arrival_at: new Date().toISOString() },
      });
      mobileLogger.flow('GeofenceOverlay: arrive enqueued offline-first', {
        tripId: alert.tripId,
      });
      router.push(`/trip/${alert.tripId}`);
    } catch (err) {
      mobileLogger.error('GeofenceOverlay: arrive failed', {
        tripId: alert.tripId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }, [alert.tripId, enqueueTransition]);

  const handleConfirmed = useCallback(() => {
    onDismiss();
    void doArrive();
  }, [onDismiss, doArrive]);

  return (
    <ConfirmCountdown
      visible
      actionLabel="Sosire la depozit"
      countdownSeconds={10}
      confirmLabel="Confirmă acum"
      onConfirmed={handleConfirmed}
      onCancel={onDismiss}
    />
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
  const insets = useSafeAreaInsets();

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
      <View style={[styles.modalContent, { paddingBottom: insets.bottom + 24 }]}>
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <View style={styles.modalHandle} />

          <MaterialCommunityIcons name="grain" size={48} color="#0A5C36" />
          <Text style={styles.modalTitle}>
            Ai terminat câmpul{'\n'}
            <Text style={styles.modalParcelName}>{alert.parcelName}</Text>?
          </Text>

          <Text style={styles.modalSubtitle}>Câți baloți ai produs pe acest câmp?</Text>

          <NumericPad value={baleCount} onChange={setBaleCount} maxLength={4} />
        </ScrollView>

        <View style={styles.modalActions}>
          <BigButton title="Confirmă" onPress={handleConfirm} loading={saving} />
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

// ── Loader Exit Confirm Modal (Da/Nu + reconciliation result) ─────────

function LoaderExitConfirmModal({
  alert,
  onDismiss,
  onConfirm,
}: {
  alert: GeofenceAlert;
  onDismiss: () => void;
  onConfirm?: (
    assignmentId: string,
  ) => Promise<{ completed: boolean; produced: number; loaded: number; missing: number } | null>;
}) {
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{
    completed: boolean;
    produced: number;
    loaded: number;
    missing: number;
  } | null>(null);
  const insets = useSafeAreaInsets();

  const handleYes = async () => {
    if (!onConfirm) {
      onDismiss();
      return;
    }
    setSaving(true);
    try {
      const res = await onConfirm(alert.assignmentId);
      // Shortage → keep the modal open to show the gap; the operator
      // acknowledges. Fully loaded (or no result) → dismiss.
      if (res && !res.completed) {
        setResult(res);
        return;
      }
    } catch {
      // best-effort
    } finally {
      setSaving(false);
    }
    onDismiss();
  };

  return (
    <View style={styles.modalBackdrop}>
      <View style={[styles.modalContent, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.modalHandle} />
        {result ? (
          <>
            <MaterialCommunityIcons name="alert" size={48} color="#C62828" />
            <Text style={styles.modalTitle}>Câmp neîncărcat complet</Text>
            <Text style={styles.modalSubtitle}>
              Produși {result.produced}, încărcați {result.loaded}. Lipsă {result.missing} baloți.
              Câmpul rămâne deschis — un administrator a fost anunțat.
            </Text>
            <View style={styles.modalActions}>
              <BigButton title="Am înțeles" onPress={onDismiss} />
            </View>
          </>
        ) : (
          <>
            <MaterialCommunityIcons name="package-variant-closed" size={48} color="#0A5C36" />
            <Text style={styles.modalTitle}>
              Ai terminat de încărcat{'\n'}
              <Text style={styles.modalParcelName}>{alert.parcelName}</Text>?
            </Text>
            <Text style={styles.modalSubtitle}>Au fost toți baloții balotați și încărcați?</Text>
            <View style={styles.modalActions}>
              <BigButton title="Da, am terminat" onPress={handleYes} loading={saving} />
              <BigButton
                title="Nu am terminat"
                variant="outline"
                onPress={onDismiss}
                disabled={saving}
              />
            </View>
          </>
        )}
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
  bannerText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },

  // ── Modal (deposit arrival + exit confirm) ──
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
  modalScroll: {
    alignSelf: 'stretch',
    flexShrink: 1,
  },
  modalScrollContent: {
    alignItems: 'center',
    gap: 16,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D7CCC8',
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
