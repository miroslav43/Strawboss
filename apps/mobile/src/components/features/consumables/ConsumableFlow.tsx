import { useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { UndoToast } from '@/components/shared/UndoToast';
import { NumericPad } from '../../ui/NumericPad';
import { BigButton } from '../../ui/BigButton';
import { ConsumableTypeSelector } from '../../shared/ConsumableTypeSelector';
import { FuelEntryFlow } from '../fuel/FuelEntryFlow';
import { getDatabase } from '@/lib/storage';
import { ConsumableLogsRepo } from '@/db/consumable-logs-repo';
import { FuelLogsRepo } from '@/db/fuel-logs-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { generateUuid } from '@/lib/uuid';
import { operatorStatsQueryKey } from '@/components/features/stats/OperatorStats';
import { useUndoableSave } from '@/hooks/useUndoableSave';
import { colors } from '@strawboss/ui-tokens';

type ConsumableType = 'diesel' | 'twine';

interface ConsumableFlowProps {
  machineId: string | null;
  operatorId: string;
  parcelId?: string;
  onComplete: () => void;
  /** Optional (e.g. modal); tab screens omit. */
  onCancel?: () => void;
  /**
   * When provided, the type selector is skipped and the flow starts on that
   * type's screen. Useful for role-specific tabs where only one type applies.
   */
  lockType?: ConsumableType;
}

// Simplified flow (T-consumables): the receipt / bon-fiscal OCR step was removed.
//   - diesel → delegates to the shared FuelEntryFlow (liters → pump photo → save).
//   - twine  → a single screen: quantity (kg) → Save.
type ConsumableStep = 'type' | 'fuel' | 'twine';

function initialStep(lockType?: ConsumableType): ConsumableStep {
  if (lockType === 'diesel') return 'fuel';
  if (lockType === 'twine') return 'twine';
  return 'type';
}

export function ConsumableFlow({
  machineId,
  operatorId,
  parcelId,
  onComplete,
  lockType,
}: ConsumableFlowProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { modalProps, showModal, hideModal } = useModal();
  const [step, setStep] = useState<ConsumableStep>(initialStep(lockType));
  const [consumableType, setConsumableType] = useState<ConsumableType | null>(lockType ?? null);
  const [quantity, setQuantity] = useState('');
  const [saving, setSaving] = useState(false);

  // Single undo for both paths. The diesel toast is surfaced here (not inside
  // FuelEntryFlow) so it survives that screen unmounting when we return to the
  // picker after a save. The id belongs to exactly one table; the other delete
  // is a harmless no-op (DELETE ... WHERE id = ? affects 0 rows).
  const { showUndo, toastState } = useUndoableSave({
    onDeleteLocal: async (entityId) => {
      const db = await getDatabase();
      await new ConsumableLogsRepo(db).deleteLocal(entityId);
      await new FuelLogsRepo(db).deleteLocal(entityId);
      void queryClient.invalidateQueries({ queryKey: operatorStatsQueryKey(operatorId) });
    },
  });

  const resetToStart = useCallback(() => {
    setQuantity('');
    setConsumableType(lockType ?? null);
    setStep(initialStep(lockType));
  }, [lockType]);

  const handleSaveTwine = useCallback(async () => {
    const qty = parseFloat(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      const consumableLogsRepo = new ConsumableLogsRepo(db);
      const syncQueue = new SyncQueueRepo(db);

      const id = generateUuid();
      const now = new Date().toISOString();

      // Local insert + queue enqueue must land together — a crash between the
      // two would otherwise leave a consumable log with server_version=0 and no
      // queue entry, so it silently never syncs.
      await db.withTransactionAsync(async () => {
        await consumableLogsRepo.create({
          id,
          machine_id: machineId,
          operator_id: operatorId,
          parcel_id: parcelId ?? null,
          consumable_type: 'twine',
          quantity: qty,
          unit: 'kg',
          logged_at: now,
          receipt_photo_uri: null,
          receipt_photo_url: null,
          created_at: now,
          updated_at: now,
          server_version: 0,
        });

        await syncQueue.enqueue({
          entityType: 'consumable_logs',
          entityId: id,
          action: 'insert',
          payload: {
            id,
            machine_id: machineId,
            operator_id: operatorId,
            parcel_id: parcelId ?? null,
            consumable_type: 'twine',
            description: null,
            quantity: qty,
            unit: 'kg',
            logged_at: now,
            receipt_photo_url: null,
          },
          idempotencyKey: `consumable_logs_${id}`,
        });
      });

      void queryClient.invalidateQueries({ queryKey: operatorStatsQueryKey(operatorId) });
      resetToStart();
      showUndo({
        entityId: id,
        idempotencyKey: `consumable_logs_${id}`,
        label: t('consumables.flow.toast.twine').replace('{qty}', String(qty)),
      });
      onComplete();
    } catch (err) {
      showModal({
        type: 'error',
        title: t('consumables.flow.error.title'),
        message: err instanceof Error ? err.message : t('consumables.flow.error.saveFailed'),
        onConfirm: hideModal,
      });
    } finally {
      setSaving(false);
    }
  }, [
    quantity,
    machineId,
    operatorId,
    parcelId,
    queryClient,
    resetToStart,
    showUndo,
    onComplete,
    showModal,
    hideModal,
  ]);

  // Diesel → the proven simple fuel flow (liters → pump photo → save, no receipt).
  if (step === 'fuel') {
    return (
      <FuelEntryFlow
        machineId={machineId}
        operatorId={operatorId}
        onComplete={onComplete}
        onCancel={lockType ? () => {} : resetToStart}
        onSaved={
          lockType
            ? undefined
            : (record) => {
                // Diesel saved → return to the consumable picker (the "main
                // page") and show the undo toast here, mirroring the twine path.
                resetToStart();
                showUndo(record);
                onComplete();
              }
        }
      />
    );
  }

  // Twine → quantity only → Save.
  if (step === 'twine') {
    return (
      <View style={styles.outerWrapper}>
        <View style={styles.container}>
          <Text style={styles.title}>{t('consumables.flow.twine.title')}</Text>
          <NumericPad value={quantity} onChange={setQuantity} maxLength={6} decimal />
          <View style={styles.actions}>
            <BigButton
              title={t('consumables.flow.twine.action.save')}
              onPress={handleSaveTwine}
              loading={saving}
              disabled={!quantity || quantity === '0'}
            />
            {!lockType ? (
              <BigButton
                title={t('consumables.flow.twine.action.back')}
                variant="outline"
                onPress={resetToStart}
              />
            ) : null}
          </View>
        </View>
        <AppModal {...modalProps} />
        <UndoToast state={toastState} bottomOffset={24} />
      </View>
    );
  }

  // Type selection (diesel / twine).
  return (
    <View style={styles.outerWrapper}>
      <View style={styles.container}>
        <Text style={styles.title}>{t('consumables.flow.typeSelector.title')}</Text>
        <ConsumableTypeSelector
          selected={consumableType}
          onSelect={(type) => setConsumableType(type)}
        />
        <View style={styles.actions}>
          <BigButton
            title={t('consumables.flow.typeSelector.action.continue')}
            onPress={() => {
              if (consumableType === 'diesel') setStep('fuel');
              else if (consumableType === 'twine') setStep('twine');
            }}
            disabled={consumableType === null}
          />
        </View>
      </View>
      <AppModal {...modalProps} />
      <UndoToast state={toastState} bottomOffset={24} />
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrapper: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 24,
    gap: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },
  actions: {
    gap: 12,
    marginTop: 'auto',
  },
});
