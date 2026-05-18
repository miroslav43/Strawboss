import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { useQueryClient } from '@tanstack/react-query';
import { NumericPad } from '../../ui/NumericPad';
import { BigButton } from '../../ui/BigButton';
import { OcrPhotoCapture } from '../../shared/OcrPhotoCapture';
import { OcrHint } from '../../shared/OcrHint';
import { getDatabase } from '@/lib/storage';
import { FuelLogsRepo } from '@/db/fuel-logs-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { uploadReceipt } from '@/lib/receiptUpload';
import { generateUuid } from '@/lib/uuid';
import { operatorStatsQueryKey } from '@/components/features/stats/OperatorStats';
import { colors } from '@strawboss/ui-tokens';

// Photo steps come before their numeric step so OCR can pre-fill the field.
type FuelStep = 'receipt' | 'liters' | 'odometer-photo' | 'odometer' | 'confirm';

export const FUEL_STEP_TITLES: Record<FuelStep, string> = {
  receipt: 'Bon de combustibil',
  liters: 'Litri alimentați',
  'odometer-photo': 'Foto bord (opțional)',
  odometer: 'Citire odometru (km)',
  confirm: 'Confirmare alimentare',
};

interface FuelEntryFlowProps {
  machineId: string | null;
  operatorId: string;
  onComplete: () => void;
  onCancel: () => void;
  onStepChange?: (title: string) => void;
}

export function FuelEntryFlow({
  machineId,
  operatorId,
  onComplete,
  onCancel,
  onStepChange,
}: FuelEntryFlowProps) {
  const queryClient = useQueryClient();
  const { modalProps, showModal, hideModal } = useModal();
  const [step, setStep] = useState<FuelStep>('receipt');

  const goToStep = useCallback(
    (next: FuelStep) => {
      setStep(next);
      onStepChange?.(FUEL_STEP_TITLES[next]);
    },
    [onStepChange],
  );
  const [liters, setLiters] = useState('');
  const [odometer, setOdometer] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // Non-null while the field still holds an unverified OCR suggestion.
  const [litersSuggested, setLitersSuggested] = useState<number | null>(null);
  const [kmSuggested, setKmSuggested] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const handleConfirm = useCallback(async () => {
    setSaving(true);
    try {
      const db = await getDatabase();
      const fuelLogsRepo = new FuelLogsRepo(db);
      const syncQueue = new SyncQueueRepo(db);

      const id = generateUuid();
      const now = new Date().toISOString();
      const quantityLiters = parseFloat(liters);
      const odometerKm = odometer ? parseFloat(odometer) : null;

      // Best-effort immediate upload — if it fails (offline), SyncManager retries later.
      let receiptPhotoUrl: string | null = null;
      if (photoUri) {
        try {
          const result = await uploadReceipt(photoUri);
          receiptPhotoUrl = result.url;
        } catch {
          receiptPhotoUrl = null;
        }
      }

      await fuelLogsRepo.create({
        id,
        machine_id: machineId,
        operator_id: operatorId,
        parcel_id: null,
        logged_at: now,
        fuel_type: 'diesel',
        quantity_liters: quantityLiters,
        odometer_km: odometerKm,
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
          odometer_km: odometerKm,
          // Postgres `is_full_tank` is BOOLEAN — send a native boolean so the
          // server insert doesn't trip on an implicit integer→boolean cast.
          is_full_tank: false,
          receipt_photo_url: receiptPhotoUrl,
          notes: null,
          sync_version: 1,
          client_id: id,
        },
        idempotencyKey: `fuel_logs_${id}`,
      });

      const pendingCount = await syncQueue.getPendingCount();

      void queryClient.invalidateQueries({
        queryKey: operatorStatsQueryKey(operatorId),
      });

      setLiters('');
      setOdometer('');
      setPhotoUri(null);
      setLitersSuggested(null);
      setKmSuggested(null);
      goToStep('receipt');
      showModal({
        type: 'success',
        title: 'Salvat',
        message: `${quantityLiters} L alimentare înregistrată. În coadă sync: ${pendingCount}.`,
        autoDismiss: true,
        onConfirm: hideModal,
      });
      onComplete();
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
  }, [machineId, operatorId, liters, odometer, photoUri, onComplete, queryClient, goToStep]);

  switch (step) {
    case 'receipt':
      return (
        <View style={styles.container}>
          <Text style={styles.subtitle}>Fotografiază bonul — citim automat litrii.</Text>
          <OcrPhotoCapture
            mode="fuel"
            label="Fotografie bon"
            onResult={(uri, s) => {
              setPhotoUri(uri);
              if (s.liters !== undefined) {
                setLiters(String(s.liters));
                setLitersSuggested(s.liters);
              }
            }}
          />
          <View style={styles.actions}>
            <BigButton title="Continuă" onPress={() => goToStep('liters')} />
            <BigButton title="Anulează" variant="outline" onPress={onCancel} />
          </View>
        </View>
      );

    case 'liters':
      return (
        <View style={styles.container}>
          {litersSuggested !== null && <OcrHint value={`${litersSuggested} L`} />}
          <NumericPad
            value={liters}
            onChange={(v) => {
              setLiters(v);
              setLitersSuggested(null);
            }}
            maxLength={6}
            decimal
          />
          <View style={styles.actions}>
            <BigButton
              title="Continuă"
              onPress={() => goToStep('odometer-photo')}
              disabled={!liters || liters === '0'}
            />
            <BigButton title="Înapoi" variant="outline" onPress={() => goToStep('receipt')} />
          </View>
        </View>
      );

    case 'odometer-photo':
      return (
        <View style={styles.container}>
          <Text style={styles.subtitle}>
            Fotografiază kilometrajul de la bord — îl citim automat.
          </Text>
          <OcrPhotoCapture
            mode="odometer"
            label="Fotografie bord"
            onResult={(_uri, s) => {
              if (s.km !== undefined) {
                setOdometer(String(s.km));
                setKmSuggested(s.km);
              }
            }}
          />
          <View style={styles.actions}>
            <BigButton title="Continuă" onPress={() => goToStep('odometer')} />
            <BigButton title="Sari peste" variant="outline" onPress={() => goToStep('odometer')} />
          </View>
        </View>
      );

    case 'odometer':
      return (
        <View style={styles.container}>
          {kmSuggested !== null && <OcrHint value={`${kmSuggested} km`} />}
          <NumericPad
            value={odometer}
            onChange={(v) => {
              setOdometer(v);
              setKmSuggested(null);
            }}
            maxLength={7}
            decimal
          />
          <View style={styles.actions}>
            <BigButton
              title="Continuă"
              onPress={() => goToStep('confirm')}
              disabled={!odometer || odometer === '0'}
            />
            <BigButton
              title="Înapoi"
              variant="outline"
              onPress={() => goToStep('odometer-photo')}
            />
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
              <Text style={styles.label}>Odometru</Text>
              <View style={styles.valueRow}>
                <Text style={styles.value}>{odometer}</Text>
                <Text style={styles.unit}>km</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.label}>Fotografie</Text>
              <Text style={[styles.value, photoUri ? styles.photoPresent : styles.photoAbsent]}>
                {photoUri ? 'Adăugată' : 'Nu'}
              </Text>
            </View>
          </View>

          <View style={styles.actions}>
            <BigButton title="Salvează" onPress={handleConfirm} loading={saving} />
            <TouchableOpacity onPress={() => goToStep('odometer')} style={styles.backButton}>
              <Text style={styles.backText}>Înapoi</Text>
            </TouchableOpacity>
          </View>
          <AppModal {...modalProps} />
        </View>
      );
  }
}

const styles = StyleSheet.create({
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
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  divider: {
    height: 1,
    backgroundColor: colors.neutral100,
  },
  label: {
    fontSize: 16,
    color: colors.neutral,
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.black,
  },
  valueHighlight: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
  },
  unit: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.neutral,
  },
  photoPresent: {
    color: colors.primary,
  },
  photoAbsent: {
    color: colors.neutral,
  },
  actions: {
    gap: 12,
    marginTop: 'auto',
  },
  backButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
});
