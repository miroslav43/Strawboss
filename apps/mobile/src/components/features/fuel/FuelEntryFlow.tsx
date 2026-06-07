import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { UndoToast } from '@/components/shared/UndoToast';
import { useQueryClient } from '@tanstack/react-query';
import { NumericPad } from '../../ui/NumericPad';
import { BigButton } from '../../ui/BigButton';
import { StepIndicator } from '../../ui/StepIndicator';
import { PhotoCapture } from '../../shared/PhotoCapture';
import { getDatabase } from '@/lib/storage';
import { FuelLogsRepo } from '@/db/fuel-logs-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { mobileLogger } from '@/lib/logger';
import { generateUuid } from '@/lib/uuid';
import { operatorStatsQueryKey } from '@/components/features/stats/OperatorStats';
import { useUndoableSave, type UndoRecord } from '@/hooks/useUndoableSave';
import { colors } from '@strawboss/ui-tokens';

/**
 * Plan C (T17) — fuel flow simplified to two real entries + confirm:
 *   1. liters         — operator types how many liters they pumped.
 *   2. station-photo  — operator photographs the fuel station (audit only,
 *                       NO OCR, NO receipt/bon fiscal).
 *   3. confirm        — summary + Save.
 *
 * The previous 5-step flow (receipt OCR, liters, photo, confirm) was
 * unreliable on phones and tedious for drivers. Existing fuel log entries on
 * the server still render correctly; only NEW entries follow the simplified
 * flow.
 */
type FuelStep = 'liters' | 'station-photo' | 'confirm';

export const FUEL_STEP_TITLES: Record<FuelStep, string> = {
  liters: 'Litri alimentați',
  'station-photo': 'Foto stație combustibil',
  confirm: 'Confirmare alimentare',
};

const FUEL_STEP_ORDER: FuelStep[] = ['liters', 'station-photo', 'confirm'];

interface FuelEntryFlowProps {
  machineId: string | null;
  operatorId: string;
  onComplete: () => void;
  onCancel: () => void;
  onStepChange?: (title: string) => void;
  /**
   * Optional. When provided, the flow delegates post-save handling — navigation
   * AND the undo toast — to the parent instead of resetting itself to the first
   * step. The parent receives the undo record so it can render the toast at a
   * level that survives this screen unmounting. Used by ConsumableFlow so a
   * baler returns to the consumable picker after logging diesel (the undo toast
   * would otherwise vanish with the unmounted flow).
   */
  onSaved?: (record: UndoRecord) => void;
}

export function FuelEntryFlow({
  machineId,
  operatorId,
  onComplete,
  onCancel,
  onStepChange,
  onSaved,
}: FuelEntryFlowProps) {
  const queryClient = useQueryClient();
  const { modalProps, showModal, hideModal } = useModal();
  const [step, setStep] = useState<FuelStep>('liters');
  const [liters, setLiters] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { showUndo, toastState } = useUndoableSave({
    onDeleteLocal: async (entityId) => {
      const db = await getDatabase();
      const repo = new FuelLogsRepo(db);
      await repo.deleteLocal(entityId);
      void queryClient.invalidateQueries({
        queryKey: operatorStatsQueryKey(operatorId),
      });
    },
  });

  const goToStep = useCallback(
    (next: FuelStep) => {
      setStep(next);
      onStepChange?.(FUEL_STEP_TITLES[next]);
    },
    [onStepChange],
  );

  const handleConfirm = useCallback(async () => {
    const quantityLiters = parseFloat(liters);
    if (!Number.isFinite(quantityLiters) || quantityLiters <= 0) {
      // Should be unreachable via NumericPad input, but guards against a
      // corrupted state on app resume and against NaN sneaking into SQLite.
      mobileLogger.warn('FuelEntryFlow: invalid quantity', { liters });
      return;
    }
    setSaving(true);
    try {
      const db = await getDatabase();
      const fuelLogsRepo = new FuelLogsRepo(db);
      const syncQueue = new SyncQueueRepo(db);

      const id = generateUuid();
      const now = new Date().toISOString();

      // The receipt photo is uploaded LAZILY by SyncManager.uploadPendingReceipts
      // before the row is pushed. Doing it synchronously here would silently
      // drop the URL when the network is flaky (the catch used to swallow the
      // error and let the row sync without a photo). Keeping `photoUri` lets
      // the pre-push hook retry the upload at every sync cycle.
      const receiptPhotoUrl: string | null = null;

      await fuelLogsRepo.create({
        id,
        machine_id: machineId,
        operator_id: operatorId,
        parcel_id: null,
        logged_at: now,
        fuel_type: 'diesel',
        quantity_liters: quantityLiters,
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
          parcel_id: null,
          logged_at: now,
          fuel_type: 'diesel',
          quantity_liters: quantityLiters,
          is_full_tank: false,
          receipt_photo_url: receiptPhotoUrl,
          notes: null,
          sync_version: 1,
          client_id: id,
        },
        idempotencyKey: `fuel_logs_${id}`,
      });

      void queryClient.invalidateQueries({
        queryKey: operatorStatsQueryKey(operatorId),
      });

      const undoRecord: UndoRecord = {
        entityId: id,
        idempotencyKey: `fuel_logs_${id}`,
        label: `Înregistrat — ${quantityLiters} L combustibil`,
      };

      if (onSaved) {
        // Parent owns post-save navigation + the undo toast (so it survives
        // this screen unmounting). Don't reset local state or show our own toast.
        onSaved(undoRecord);
      } else {
        // Standalone use (driver fuel tab, loader consumables): stay on the
        // flow so the operator can log another fueling right away.
        setLiters('');
        setPhotoUri(null);
        goToStep('liters');
        showUndo(undoRecord);
        onComplete();
      }
    } catch (err) {
      showModal({
        type: 'error',
        title: 'Eroare',
        message: err instanceof Error ? err.message : 'Nu s-a putut salva alimentarea',
        onConfirm: hideModal,
      });
    } finally {
      setSaving(false);
    }
  }, [
    machineId,
    operatorId,
    liters,
    photoUri,
    onComplete,
    onSaved,
    queryClient,
    goToStep,
    showUndo,
    showModal,
    hideModal,
  ]);

  const stepIndex = FUEL_STEP_ORDER.indexOf(step);

  const stepContent = (() => {
    switch (step) {
      case 'liters':
        return (
          <View style={styles.container}>
            <Text style={styles.subtitle}>Câți litri ai alimentat?</Text>
            <NumericPad value={liters} onChange={setLiters} maxLength={6} decimal />
            <View style={styles.actions}>
              <BigButton
                title="Continuă"
                onPress={() => goToStep('station-photo')}
                disabled={!liters || liters === '0'}
              />
              <BigButton title="Anulează" variant="outline" onPress={onCancel} />
            </View>
          </View>
        );

      case 'station-photo':
        return (
          <View style={styles.container}>
            <Text style={styles.subtitle}>
              Fotografiază stația de combustibil. NU este nevoie de bon fiscal.
            </Text>
            <PhotoCapture label="Fotografie stație" onCapture={(uri) => setPhotoUri(uri)} />
            <View style={styles.actions}>
              <BigButton
                title="Continuă"
                onPress={() => goToStep('confirm')}
                disabled={!photoUri}
              />
              <BigButton title="Înapoi" variant="outline" onPress={() => goToStep('liters')} />
            </View>
          </View>
        );

      case 'confirm':
        return (
          <View style={styles.container}>
            <View style={styles.summaryCard}>
              <View style={styles.row}>
                <Text style={styles.label}>Litri</Text>
                <View style={styles.valueRow}>
                  <Text style={styles.valueHighlight}>{liters}</Text>
                  <Text style={styles.unit}>L</Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.row}>
                <Text style={styles.label}>Fotografie</Text>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.thumb} />
                ) : (
                  <Text style={[styles.value, styles.photoAbsent]}>—</Text>
                )}
              </View>
            </View>

            <View style={styles.actions}>
              <BigButton title="Salvează" onPress={handleConfirm} loading={saving} />
              <TouchableOpacity onPress={() => goToStep('station-photo')} style={styles.backButton}>
                <Text style={styles.backText}>Înapoi</Text>
              </TouchableOpacity>
            </View>
            <AppModal {...modalProps} />
          </View>
        );
    }
  })();

  return (
    <View style={styles.wrapper}>
      <StepIndicator totalSteps={FUEL_STEP_ORDER.length} currentStep={stepIndex} />
      {stepContent}
      <UndoToast state={toastState} bottomOffset={24} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  container: { flex: 1, padding: 24, gap: 24 },
  subtitle: {
    fontSize: 14,
    color: colors.neutral,
    textAlign: 'center',
    marginTop: -16,
  },
  summaryCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  divider: { height: 1, backgroundColor: colors.neutral100 },
  label: { fontSize: 16, color: colors.neutral },
  value: { fontSize: 16, fontWeight: '600', color: colors.black },
  valueHighlight: { fontSize: 24, fontWeight: '700', color: colors.primary },
  unit: { fontSize: 14, fontWeight: '500', color: colors.neutral },
  photoAbsent: { color: colors.neutral },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  actions: { gap: 12, marginTop: 'auto' },
  backButton: { alignItems: 'center', paddingVertical: 12 },
  backText: { fontSize: 16, fontWeight: '600', color: colors.primary },
});
