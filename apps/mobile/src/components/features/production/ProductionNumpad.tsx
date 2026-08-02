import { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useI18n } from '@/lib/i18n';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { UndoToast } from '@/components/shared/UndoToast';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { colors } from '@strawboss/ui-tokens';
import { getDatabase } from '@/lib/storage';
import { BaleProductionsRepo } from '@/db/bale-productions-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { mobileLogger } from '@/lib/logger';
import { fontScale } from '@/utils/responsive';
import { generateUuid } from '@/lib/uuid';
import { todayInRomania } from '@/lib/date';
import { operatorStatsQueryKey } from '@/components/features/stats/OperatorStats';
import { useUndoableSave } from '@/hooks/useUndoableSave';
import { useActiveParcels, type ActiveParcel } from '@/hooks/useActiveParcels';
import { useCurrentLoaderParcel } from '@/hooks/useCurrentLoaderParcel';

interface ProductionNumpadProps {
  operatorId: string;
  balerId: string | null;
}

type PadKey = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '0' | 'clear' | 'backspace';

type ParcelSource = 'gps' | 'task' | null;

const PAD_ROWS: PadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'backspace'],
];

const MAX_DIGITS = 5;
// GPS sampling (interval, timeout, permission handling) now lives entirely in
// `useCurrentLoaderParcel` — this screen no longer runs a second sampler.

export function ProductionNumpad({ operatorId, balerId }: ProductionNumpadProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { modalProps, showModal, hideModal } = useModal();
  const parcelQuery = useActiveParcels();
  const activeParcels: ActiveParcel[] | undefined = parcelQuery.data as ActiveParcel[] | undefined;
  const parcelsLoading = parcelQuery.isLoading;
  // Parcels now come from the local cache (useCachedParcels), which never
  // errors offline — it's the source of truth, not a fallback. `fromCache`
  // tells us whether the server has confirmed this list yet this session, so
  // we can say "resolved from the day's plan, offline" instead of implying
  // the resolution itself is uncertain.
  const parcelsFromCache = parcelQuery.fromCache;

  const [count, setCount] = useState('');
  const [saving, setSaving] = useState(false);

  // One answer to "which field am I on", shared with the loader and with this
  // role's own home screen.
  //
  // This component used to resolve the field itself, and disagreed with the
  // shared resolver on every point that matters: it matched GPS against EVERY
  // parcel in the organisation rather than the operator's own assigned fields
  // (so production could be recorded against a field nobody had assigned), it
  // required a task to carry a non-null `parcelName` where the sibling numpad
  // required only an id, and it ran a second independent GPS sampler. With 2+
  // assigned fields and no GPS hit it silently left SAVE disabled with no
  // explanation at all.
  const parcel = useCurrentLoaderParcel();
  const resolved = parcel.status === 'resolved' && parcel.targetType === 'parcel';
  const parcelId = resolved ? parcel.parcelId : null;
  const parcelName = resolved ? parcel.parcelName : null;
  const parcelCode = resolved ? parcel.parcelCode : null;
  const parcelSource: ParcelSource = !resolved
    ? null
    : parcel.source === 'in_progress_task'
      ? 'task'
      : 'gps';

  // FM-4: undo hook — deletes the bale_productions row + sync queue entry
  const { showUndo, toastState } = useUndoableSave({
    onDeleteLocal: async (entityId) => {
      const db = await getDatabase();
      const repo = new BaleProductionsRepo(db);
      await repo.deleteLocal(entityId);
      void queryClient.invalidateQueries({ queryKey: ['bale-productions'] });
      void queryClient.invalidateQueries({ queryKey: operatorStatsQueryKey(operatorId) });
    },
  });

  const subtitle = useMemo(() => {
    if (parcelSource === 'gps') {
      // `gps_nearby` named the field from the wider radius rather than from
      // containment — say how far off, so a wrong field is obvious.
      if (parcel.source === 'gps_nearby') {
        return t('production.numpad.gps.nearField', { distance: parcel.distanceM ?? 0 });
      }
      return t('production.numpad.parcelSource.gps');
    }
    if (parcelSource === 'task') {
      // Resolved via the day's single assigned parcel rather than a GPS hit —
      // honest about it when that resolution came from the offline cache
      // rather than a fresh server confirmation.
      return parcelsFromCache
        ? t('production.numpad.parcelsFromCache')
        : t('production.numpad.parcelSource.task');
    }
    if (parcel.status === 'awaiting_geometry') {
      return t('production.numpad.gps.outlinesMissing');
    }
    if (parcel.status === 'unavailable') {
      return t('production.numpad.gps.noAssignment');
    }
    if (parcel.gpsState === 'unavailable') {
      return t('production.numpad.gps.unavailable');
    }
    if (parcel.gpsState === 'locating') {
      return t('production.numpad.gps.loading');
    }
    return t('production.numpad.gps.outsideParcels');
  }, [
    parcelSource,
    parcel.source,
    parcel.distanceM,
    parcel.status,
    parcel.gpsState,
    parcelsFromCache,
    t,
  ]);

  const bannerMainTitle = useMemo(() => {
    if (parcelName) return parcelName;
    if (parcel.status === 'needs_start') return t('production.numpad.noParcel');
    return '—';
  }, [parcelName, parcel.status, t]);

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

  const numericCount = useMemo(() => {
    const n = parseInt(count, 10);
    return Number.isFinite(n) ? n : 0;
  }, [count]);

  // Soft presence gate: block only a field GPS can PROVE is the wrong one.
  // `'unknown'` (offline, or no outline cached) still saves — a baler works
  // long continuous sessions and a signal drop must not stop the count. That is
  // the deliberate difference from the loader's strict in-field gate, where the
  // bales are leaving on a truck.
  const canSave = !saving && numericCount > 0 && parcelId !== null && parcel.presence !== 'outside';

  const doSave = useCallback(async () => {
    if (!canSave || parcelId === null) return;
    setSaving(true);
    mobileLogger.flow('Baler production: saving local record', {
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

      // Local insert + queue enqueue must land together — a crash between the
      // two would otherwise leave a production row with server_version=0 and
      // no queue entry, so it silently never syncs.
      await db.withTransactionAsync(async () => {
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
      });

      mobileLogger.flow('Baler production: queued for sync', { parcelId, id });
      void queryClient.invalidateQueries({ queryKey: ['bale-productions'] });
      void queryClient.invalidateQueries({
        queryKey: operatorStatsQueryKey(operatorId),
      });

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCount('');

      // FM-4: show undo toast
      showUndo({
        entityId: id,
        idempotencyKey: `bale_productions_${id}`,
        label: t('production.numpad.toast.saved').replace('{count}', String(numericCount)),
      });
    } catch (err) {
      mobileLogger.error('Baler production: save failed', {
        parcelId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      showModal({
        type: 'error',
        title: t('production.numpad.error.title'),
        message: err instanceof Error ? err.message : t('production.numpad.error.saveFailed'),
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
    showUndo,
    showModal,
    hideModal,
  ]);

  // FM-5: duplicate detection — check for existing production on same (parcelId, date)
  const handleSave = useCallback(async () => {
    if (!canSave || parcelId === null) return;
    try {
      const db = await getDatabase();
      const productionsRepo = new BaleProductionsRepo(db);
      const productionDate = todayInRomania();
      const existing = await productionsRepo.findByParcelAndDate(parcelId, productionDate);
      if (existing.length > 0) {
        const totalExisting = existing.reduce((acc, p) => acc + p.bale_count, 0);
        const minutesAgo = Math.round(
          (Date.now() - new Date(existing[0]!.created_at).getTime()) / 60_000,
        );
        showModal({
          type: 'warning',
          title: t('production.numpad.duplicateModal.title'),
          message: t('production.numpad.duplicateModal.message')
            .replace('{total}', String(totalExisting))
            .replace('{minutes}', String(minutesAgo)),
          confirmText: t('production.numpad.duplicateModal.confirm'),
          cancelText: t('production.numpad.duplicateModal.cancel'),
          onConfirm: () => {
            hideModal();
            void doSave();
          },
          onCancel: hideModal,
        });
        return;
      }
    } catch {
      // Non-fatal — proceed with save even if duplicate check fails
    }
    await doSave();
  }, [canSave, parcelId, showModal, hideModal, doSave]);

  return (
    <View style={styles.container}>
      <View style={styles.parcelSection}>
        <Text style={styles.parcelLabel}>{t('production.numpad.parcelLabel')}</Text>

        {parcelsLoading && (activeParcels === undefined || activeParcels.length === 0) ? (
          <View style={styles.bannerLoading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.bannerLoadingText}>{t('production.numpad.loadingParcels')}</Text>
          </View>
        ) : (
          <View style={styles.bannerCard}>
            <View style={styles.bannerTitleRow}>
              <MaterialCommunityIcons
                name="map-marker-radius"
                size={18}
                color={colors.primary}
                style={styles.bannerIcon}
              />
              <View style={styles.bannerTitleTextWrap}>
                <Text style={styles.bannerTitle} numberOfLines={2}>
                  {bannerMainTitle}
                </Text>
                {parcelCode ? <Text style={styles.bannerCode}>{parcelCode}</Text> : null}
              </View>
            </View>
            <Text style={styles.bannerSubtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.display}>
        <Text style={styles.displayNumber}>{count || '0'}</Text>
        <Text style={styles.displayLabel}>{t('production.numpad.displayLabel')}</Text>
      </View>

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
                  accessibilityLabel={
                    key === 'backspace'
                      ? t('production.numpad.accessibility.deleteLastDigit')
                      : key === 'clear'
                        ? t('production.numpad.accessibility.clearAll')
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

      <UndoToast state={toastState} bottomOffset={80} />

      <TouchableOpacity
        style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={!canSave}
        activeOpacity={0.85}
      >
        <Text style={styles.saveButtonText} numberOfLines={1}>
          {saving
            ? t('production.numpad.saveButton.saving')
            : t('production.numpad.saveButton.label')}
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
  parcelSection: {
    gap: 6,
    flexShrink: 0,
  },
  parcelLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.neutral,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bannerCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral100,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  bannerIcon: {
    marginTop: 2,
  },
  bannerTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bannerTitleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.black,
    lineHeight: 20,
  },
  bannerCode: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: colors.neutral,
    letterSpacing: 0.2,
  },
  bannerSubtitle: {
    fontSize: 11,
    color: colors.neutral,
    lineHeight: 14,
  },
  bannerLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  bannerLoadingText: {
    fontSize: 13,
    color: colors.neutral,
  },
  bannerError: {
    fontSize: 14,
    color: colors.danger,
    paddingVertical: 8,
  },
  display: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    flexShrink: 0,
  },
  displayNumber: {
    fontSize: fontScale(76),
    fontWeight: '800',
    color: colors.primary,
    lineHeight: 82,
    letterSpacing: -1,
  },
  displayLabel: {
    fontSize: 16,
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
    height: 56,
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
    fontSize: fontScale(36),
    fontWeight: '700',
    color: colors.black,
  },
  actionKeyText: {
    fontSize: 30,
    color: colors.neutral,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    height: 64,
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
    fontSize: fontScale(18),
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
