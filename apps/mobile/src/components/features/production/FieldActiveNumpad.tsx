import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useI18n } from '@/lib/i18n';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@strawboss/ui-tokens';
import { fontScale } from '@/utils/responsive';
import { getDatabase } from '@/lib/storage';
import { BaleProductionsRepo } from '@/db/bale-productions-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { mobileLogger } from '@/lib/logger';
import { generateUuid } from '@/lib/uuid';
import { todayInRomania } from '@/lib/date';
import { useMyTasks } from '@/hooks/useMyTasks';
import { operatorStatsQueryKey } from '@/components/features/stats/OperatorStats';
import {
  useActiveParcels,
  findParcelAtLocation,
  type ActiveParcel,
} from '@/hooks/useActiveParcels';

interface FieldActiveNumpadProps {
  operatorId: string;
  balerId: string | null;
}

type PadKey = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '0' | 'clear' | 'backspace';

const PAD_ROWS: PadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'backspace'],
];

const MAX_DIGITS = 5;
const GPS_REFRESH_MS = 45_000;
// Cap the wait for a fix so production never stalls on a cold/weak GPS. Balanced
// accuracy resolves faster than High and suffices for parcel-polygon matching.
const GPS_FIX_TIMEOUT_MS = 12_000;

/**
 * FM-7: Minimal numpad for the "Câmp activ" mode.
 *
 * Shows only:
 *  - Big number display
 *  - Numpad keys
 *  - Save button
 *  - Daily bale counter (today's total saved locally)
 *
 * GPS-based parcel detection still runs silently in the background.
 * Parcel name is shown in a compact line to confirm auto-detection.
 */
export function FieldActiveNumpad({ operatorId, balerId }: FieldActiveNumpadProps) {
  const { t } = useI18n();
  const { tasks } = useMyTasks();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { modalProps, showModal, hideModal } = useModal();
  const parcelQuery = useActiveParcels();
  const activeParcels: ActiveParcel[] | undefined = parcelQuery.data as ActiveParcel[] | undefined;

  const [count, setCount] = useState('');
  const [parcelId, setParcelId] = useState<string | null>(null);
  const [parcelName, setParcelName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [todayTotal, setTodayTotal] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const taskOnlyParcel = useMemo(() => {
    // Fallback when GPS does not match a polygon: if exactly one assigned task
    // has a parcel, use it. A null parcel name must NOT exclude it (that would
    // leave parcelId null and keep SAVE disabled) — fall back to the code.
    const withParcel = tasks.filter((t) => t.parcelId !== null);
    const uniqueIds = new Set(withParcel.map((t) => t.parcelId));
    if (uniqueIds.size !== 1) return null;
    const first = withParcel[0];
    if (!first?.parcelId) return null;
    return {
      id: first.parcelId,
      name: first.parcelName ?? first.parcelCode ?? t('production.fieldNumpad.taskParcelFallback'),
    };
  }, [tasks]);

  // Load today's total from local DB
  useEffect(() => {
    void (async () => {
      try {
        const db = await getDatabase();
        const repo = new BaleProductionsRepo(db);
        const today = todayInRomania();
        const total = await repo.getTodayTotalForOperator(operatorId, today);
        setTodayTotal(total);
      } catch {
        // Non-critical
      }
    })();
  }, [operatorId]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      async function sample() {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!alive) return;
        if (status !== 'granted') return;
        try {
          const loc = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('GPS timeout')), GPS_FIX_TIMEOUT_MS),
            ),
          ]);
          if (!alive) return;
          if (activeParcels?.length) {
            const hit = findParcelAtLocation(
              loc.coords.longitude,
              loc.coords.latitude,
              activeParcels,
            );
            if (hit) {
              setParcelId(hit.id);
              setParcelName(hit.name);
              return;
            }
          }
          // Task fallback
          if (taskOnlyParcel) {
            setParcelId(taskOnlyParcel.id);
            setParcelName(taskOnlyParcel.name);
          }
        } catch {
          // GPS unavailable — fall back to task parcel
          if (taskOnlyParcel) {
            setParcelId(taskOnlyParcel.id);
            setParcelName(taskOnlyParcel.name);
          }
        }
      }

      void sample();
      const intervalId = setInterval(() => void sample(), GPS_REFRESH_MS);

      return () => {
        alive = false;
        clearInterval(intervalId);
      };
    }, [activeParcels, taskOnlyParcel]),
  );

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    };
  }, []);

  const handlePress = useCallback((key: PadKey) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (key === 'backspace') {
      setCount((prev) => prev.slice(0, -1));
      return;
    }
    if (key === 'clear') {
      setCount('');
      return;
    }
    setCount((prev) => {
      if (prev.length >= MAX_DIGITS) return prev;
      if (prev === '' && key === '0') return prev;
      return prev + key;
    });
  }, []);

  const showToast = useCallback(
    (message: string) => {
      setToastMessage(message);
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }).start();
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => {
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 240,
          useNativeDriver: true,
        }).start(() => setToastMessage(null));
      }, 1800);
    },
    [toastOpacity],
  );

  const numericCount = useMemo(() => {
    const n = parseInt(count, 10);
    return Number.isFinite(n) ? n : 0;
  }, [count]);

  const canSave = !saving && numericCount > 0 && parcelId !== null;

  const handleSave = useCallback(async () => {
    if (!canSave || parcelId === null) return;
    setSaving(true);
    mobileLogger.flow('FieldActiveNumpad: saving local record', {
      parcelId,
      baleCount: numericCount,
    });
    try {
      const db = await getDatabase();
      const productionsRepo = new BaleProductionsRepo(db);
      const syncQueue = new SyncQueueRepo(db);

      const id = generateUuid();
      const now = new Date().toISOString();
      const productionDate = todayInRomania();

      await productionsRepo.create({
        id,
        parcel_id: parcelId,
        baler_id: balerId,
        operator_id: operatorId,
        production_date: productionDate,
        bale_count: numericCount,
        avg_bale_weight_kg: null,
        start_time: null,
        end_time: now,
        created_at: now,
        updated_at: now,
        server_version: 0,
      });

      await syncQueue.enqueue({
        entityType: 'bale_productions',
        entityId: id,
        action: 'insert',
        payload: {
          id,
          parcel_id: parcelId,
          baler_id: balerId,
          operator_id: operatorId,
          production_date: productionDate,
          bale_count: numericCount,
          end_time: now,
        },
        idempotencyKey: `bale_productions_${id}`,
      });

      mobileLogger.flow('FieldActiveNumpad: queued for sync', { parcelId, id });
      void queryClient.invalidateQueries({ queryKey: ['bale-productions'] });
      void queryClient.invalidateQueries({ queryKey: operatorStatsQueryKey(operatorId) });

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTodayTotal((t) => t + numericCount);
      setCount('');
      showToast(t('production.fieldNumpad.toast.saved').replace('{count}', String(numericCount)));
    } catch (err) {
      mobileLogger.error('FieldActiveNumpad: save failed', {
        parcelId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      showModal({
        type: 'error',
        title: t('production.fieldNumpad.error.title'),
        message: err instanceof Error ? err.message : t('production.fieldNumpad.error.saveFailed'),
        onConfirm: hideModal,
      });
    } finally {
      setSaving(false);
    }
  }, [
    canSave,
    parcelId,
    balerId,
    operatorId,
    numericCount,
    queryClient,
    showToast,
    showModal,
    hideModal,
  ]);

  return (
    <View style={styles.container}>
      {/* Compact parcel + counter row */}
      <View style={styles.infoRow}>
        <Text style={styles.parcelChip} numberOfLines={1}>
          {parcelName ?? '—'}
        </Text>
        <View style={styles.counterChip}>
          <Text style={styles.counterLabel}>{t('production.fieldNumpad.todayLabel')}</Text>
          <Text style={styles.counterValue}>{todayTotal}</Text>
          <Text style={styles.counterUnit}>{t('production.fieldNumpad.balesUnit')}</Text>
        </View>
      </View>

      {/* Big number display */}
      <View style={styles.display}>
        <Text style={styles.displayNumber}>{count || '0'}</Text>
        <Text style={styles.displayLabel}>{t('production.fieldNumpad.displayLabel')}</Text>
      </View>

      {/* Numpad */}
      <View style={styles.pad}>
        {PAD_ROWS.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((key) => {
              const isAction = key === 'clear' || key === 'backspace';
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.key, isAction && styles.actionKey]}
                  onPress={() => handlePress(key)}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel={
                    key === 'backspace'
                      ? t('production.fieldNumpad.accessibility.deleteLastDigit')
                      : key === 'clear'
                        ? t('production.fieldNumpad.accessibility.clearAll')
                        : key
                  }
                >
                  {key === 'backspace' ? (
                    <MaterialCommunityIcons
                      name="backspace-outline"
                      size={32}
                      color={colors.neutral}
                    />
                  ) : key === 'clear' ? (
                    <Text style={[styles.keyText, styles.actionKeyText]}>C</Text>
                  ) : (
                    <Text style={styles.keyText}>{key}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* Toast */}
      {toastMessage !== null && (
        <Animated.View
          style={[styles.toast, { opacity: toastOpacity, bottom: insets.bottom + 96 }]}
        >
          <MaterialCommunityIcons name="check-circle" size={18} color={colors.white} />
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}

      {/* Save button */}
      <TouchableOpacity
        style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={!canSave}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t('production.fieldNumpad.accessibility.saveProduction')}
      >
        <Text style={styles.saveButtonText}>
          {saving
            ? t('production.fieldNumpad.saveButton.saving')
            : t('production.fieldNumpad.saveButton.label')}
        </Text>
      </TouchableOpacity>
      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  parcelChip: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    backgroundColor: colors.white,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.neutral100,
    overflow: 'hidden',
  },
  counterChip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    backgroundColor: colors.primary50,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.primary200,
  },
  counterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  counterValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
  },
  counterUnit: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
  },
  display: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    flexShrink: 0,
  },
  displayNumber: {
    fontSize: fontScale(92),
    fontWeight: '800',
    color: colors.primary,
    lineHeight: fontScale(100),
    letterSpacing: -1,
  },
  displayLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.neutral,
    marginTop: -4,
    letterSpacing: 0.5,
  },
  pad: {
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    minHeight: 0,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    height: 64,
  },
  key: {
    flex: 1,
    height: '100%',
    backgroundColor: colors.white,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  actionKey: {
    backgroundColor: colors.surface,
  },
  keyText: {
    fontSize: 40,
    fontWeight: '700',
    color: colors.black,
  },
  actionKeyText: {
    fontSize: 32,
    color: colors.neutral,
  },
  toast: {
    position: 'absolute',
    bottom: 96,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.success,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  toastText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    height: 72,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  saveButtonDisabled: {
    backgroundColor: colors.neutral200,
    shadowOpacity: 0,
    elevation: 0,
  },
  saveButtonText: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
