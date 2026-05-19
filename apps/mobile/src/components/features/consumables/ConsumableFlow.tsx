import { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { UndoToast } from '@/components/shared/UndoToast';
import { NumericPad } from '../../ui/NumericPad';
import { BigButton } from '../../ui/BigButton';
import { StepIndicator } from '../../ui/StepIndicator';
import { OcrPhotoCapture } from '../../shared/OcrPhotoCapture';
import { OcrHint } from '../../shared/OcrHint';
import { ConsumableTypeSelector } from '../../shared/ConsumableTypeSelector';
import { ConsumableConfirmation } from './ConsumableConfirmation';
import { getDatabase } from '@/lib/storage';
import { FuelLogsRepo } from '@/db/fuel-logs-repo';
import { ConsumableLogsRepo } from '@/db/consumable-logs-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { uploadReceipt } from '@/lib/receiptUpload';
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
   * When provided, the type selector is skipped and the flow starts at
   * the receipt step locked to this type. Useful for role-specific tabs
   * where only one type is relevant (e.g. 'diesel' for loader_operator).
   */
  lockType?: ConsumableType;
}

// Photo step comes before the quantity step so OCR can pre-fill it.
type ConsumableStep = 'type' | 'receipt' | 'quantity' | 'confirm';

const UNIT_LABELS: Record<ConsumableType, string> = {
  diesel: 'litri',
  twine: 'kg',
};

const STEP_ORDER: ConsumableStep[] = ['type', 'receipt', 'quantity', 'confirm'];
const SCREEN_WIDTH = Dimensions.get('window').width;

export function ConsumableFlow({
  machineId,
  operatorId,
  parcelId,
  onComplete,
  lockType,
}: ConsumableFlowProps) {
  const queryClient = useQueryClient();
  const { modalProps, showModal, hideModal } = useModal();
  // If lockType is set, we start directly at the receipt step.
  const [step, setStep] = useState<ConsumableStep>(lockType ? 'receipt' : 'type');

  // FM-4: undo hook — type-agnostic; the actual repo deletion is resolved at save time
  // via a ref that holds the entity type ('fuel_logs' | 'consumable_logs').
  const savedEntityTypeRef = useRef<'fuel_logs' | 'consumable_logs'>('consumable_logs');
  const { showUndo, toastState } = useUndoableSave({
    onDeleteLocal: async (entityId) => {
      const db = await getDatabase();
      if (savedEntityTypeRef.current === 'fuel_logs') {
        const repo = new FuelLogsRepo(db);
        await repo.deleteLocal(entityId);
      } else {
        const repo = new ConsumableLogsRepo(db);
        await repo.deleteLocal(entityId);
      }
      void queryClient.invalidateQueries({ queryKey: operatorStatsQueryKey(operatorId) });
    },
  });
  const slideAnim = useRef(new Animated.Value(0)).current;
  const prevStepRef = useRef<ConsumableStep>(lockType ? 'receipt' : 'type');
  const [consumableType, setConsumableType] = useState<ConsumableType | null>(lockType ?? null);
  const [quantity, setQuantity] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // Non-null while the field still holds an unverified OCR suggestion.
  const [quantitySuggested, setQuantitySuggested] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const goToStep = useCallback(
    (next: ConsumableStep) => {
      const prevIndex = STEP_ORDER.indexOf(prevStepRef.current);
      const nextIndex = STEP_ORDER.indexOf(next);
      const forward = nextIndex >= prevIndex;
      // Start off-screen on the entry side
      slideAnim.setValue(forward ? SCREEN_WIDTH : -SCREEN_WIDTH);
      setStep(next);
      prevStepRef.current = next;
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    },
    [slideAnim],
  );

  const handleConfirm = useCallback(async () => {
    if (!consumableType) return;
    const savedType = consumableType;
    setSaving(true);
    // FM-4: track which repo to delete from during undo
    savedEntityTypeRef.current = savedType === 'diesel' ? 'fuel_logs' : 'consumable_logs';
    try {
      const db = await getDatabase();
      const syncQueue = new SyncQueueRepo(db);

      const id = generateUuid();
      const now = new Date().toISOString();
      const qty = parseFloat(quantity);

      let receiptPhotoUrl: string | null = null;
      if (photoUri) {
        try {
          const result = await uploadReceipt(photoUri);
          receiptPhotoUrl = result.url;
        } catch {
          receiptPhotoUrl = null;
        }
      }

      if (savedType === 'diesel') {
        const fuelLogsRepo = new FuelLogsRepo(db);
        await fuelLogsRepo.create({
          id,
          machine_id: machineId,
          operator_id: operatorId,
          parcel_id: parcelId ?? null,
          logged_at: now,
          fuel_type: 'diesel',
          quantity_liters: qty,
          odometer_km: null,
          hourmeter_hrs: null,
          is_full_tank: 0,
          receipt_photo_uri: photoUri,
          receipt_photo_url: receiptPhotoUrl,
          notes: null,
          created_at: now,
          updated_at: now,
          server_version: 0,
        });

        await syncQueue.enqueue({
          entityType: 'fuel_logs',
          entityId: id,
          action: 'insert',
          payload: {
            id,
            machine_id: machineId,
            operator_id: operatorId,
            parcel_id: parcelId ?? null,
            logged_at: now,
            fuel_type: 'diesel',
            quantity_liters: qty,
            // Postgres column is BOOLEAN; send a native boolean.
            is_full_tank: false,
            receipt_photo_url: receiptPhotoUrl,
            notes: null,
            sync_version: 1,
            client_id: id,
          },
          idempotencyKey: `fuel_logs_${id}`,
        });
      } else if (savedType === 'twine') {
        const consumableLogsRepo = new ConsumableLogsRepo(db);
        await consumableLogsRepo.create({
          id,
          machine_id: machineId,
          operator_id: operatorId,
          parcel_id: parcelId ?? null,
          consumable_type: 'twine',
          quantity: qty,
          unit: 'kg',
          logged_at: now,
          receipt_photo_uri: photoUri,
          receipt_photo_url: receiptPhotoUrl,
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
            receipt_photo_url: receiptPhotoUrl,
          },
          idempotencyKey: `consumable_logs_${id}`,
        });
      }

      void queryClient.invalidateQueries({
        queryKey: operatorStatsQueryKey(operatorId),
      });
      // If lockType is set, reset to receipt (skip type selection); otherwise back to type.
      setConsumableType(lockType ?? null);
      setQuantity('');
      setPhotoUri(null);
      setQuantitySuggested(null);
      goToStep(lockType ? 'receipt' : 'type');

      // FM-4: show undo toast (replaces auto-dismiss success modal)
      const idempotencyKey = savedType === 'diesel' ? `fuel_logs_${id}` : `consumable_logs_${id}`;
      showUndo({
        entityId: id,
        idempotencyKey,
        label: `Înregistrat — ${qty} ${UNIT_LABELS[savedType]}`,
      });

      onComplete();
    } catch (err) {
      showModal({
        type: 'error',
        title: 'Eroare',
        message: err instanceof Error ? err.message : 'Nu s-a putut salva consumabilul',
        onConfirm: hideModal,
      });
    } finally {
      setSaving(false);
    }
  }, [
    consumableType,
    lockType,
    machineId,
    operatorId,
    parcelId,
    quantity,
    photoUri,
    onComplete,
    queryClient,
    goToStep,
    showUndo,
  ]);

  const stepContent = (() => {
    switch (step) {
      case 'type':
        return (
          <View style={styles.container}>
            <Text style={styles.title}>Tip Consumabil</Text>
            <ConsumableTypeSelector
              selected={consumableType}
              onSelect={(type) => setConsumableType(type)}
            />
            <View style={styles.actions}>
              <BigButton
                title="Continuă"
                onPress={() => goToStep('receipt')}
                disabled={consumableType === null}
              />
              {consumableType !== null ? (
                <BigButton
                  title="Șterge selecția"
                  variant="outline"
                  onPress={() => setConsumableType(null)}
                />
              ) : null}
            </View>
            <AppModal {...modalProps} />
          </View>
        );

      case 'receipt':
        return (
          <View style={styles.container}>
            <Text style={styles.title}>Bon fiscal</Text>
            <Text style={styles.subtitle}>Fotografiază bonul — citim automat cantitatea.</Text>
            <OcrPhotoCapture
              mode="consumable"
              label="Fotografie bon"
              onResult={(uri, s) => {
                setPhotoUri(uri);
                if (s.quantity !== undefined) {
                  setQuantity(String(s.quantity));
                  setQuantitySuggested(s.quantity);
                }
              }}
            />
            <View style={styles.actions}>
              <BigButton title="Continuă" onPress={() => goToStep('quantity')} />
              <BigButton
                title="Sari peste"
                variant="outline"
                onPress={() => goToStep('quantity')}
              />
            </View>
            <AppModal {...modalProps} />
          </View>
        );

      case 'quantity':
        return (
          <View style={styles.container}>
            <Text style={styles.title}>
              Cantitate ({consumableType ? UNIT_LABELS[consumableType] : ''})
            </Text>
            {quantitySuggested !== null && (
              <OcrHint
                value={`${quantitySuggested} ${consumableType ? UNIT_LABELS[consumableType] : ''}`}
              />
            )}
            <NumericPad
              value={quantity}
              onChange={(v) => {
                setQuantity(v);
                setQuantitySuggested(null);
              }}
              maxLength={6}
              decimal
            />
            <View style={styles.actions}>
              <BigButton
                title="Continuă"
                onPress={() => goToStep('confirm')}
                disabled={!quantity || quantity === '0'}
              />
              <BigButton title="Înapoi" variant="outline" onPress={() => goToStep('receipt')} />
            </View>
            <AppModal {...modalProps} />
          </View>
        );

      case 'confirm':
        return (
          <>
            <ConsumableConfirmation
              consumableType={consumableType as ConsumableType}
              quantity={parseFloat(quantity)}
              hasPhoto={photoUri !== null}
              onConfirm={handleConfirm}
              onBack={() => goToStep('quantity')}
              loading={saving}
            />
            <AppModal {...modalProps} />
          </>
        );
    }
  })();

  const currentStepIndex = STEP_ORDER.indexOf(step);
  // When lockType is set, the 'type' step is skipped — show 3 steps starting
  // from 'receipt'. We subtract 1 from the total and the current index.
  const effectiveTotal = lockType ? STEP_ORDER.length - 1 : STEP_ORDER.length;
  const effectiveIndex = lockType ? Math.max(0, currentStepIndex - 1) : currentStepIndex;

  return (
    <View style={styles.outerWrapper}>
      <StepIndicator totalSteps={effectiveTotal} currentStep={effectiveIndex} />
      <Animated.View style={[styles.animatedWrapper, { transform: [{ translateX: slideAnim }] }]}>
        {stepContent}
      </Animated.View>
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
  subtitle: {
    fontSize: 14,
    color: colors.neutral,
    textAlign: 'center',
    marginTop: -16,
  },
  actions: {
    gap: 12,
    marginTop: 'auto',
  },
  animatedWrapper: {
    flex: 1,
  },
});
