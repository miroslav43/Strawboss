import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { NumericPad } from '../../ui/NumericPad';
import { BigButton } from '../../ui/BigButton';
import { PhotoCapture } from '../../shared/PhotoCapture';
import { ConsumableTypeSelector } from '../../shared/ConsumableTypeSelector';
import { ConsumableConfirmation } from './ConsumableConfirmation';
import { getDatabase } from '@/lib/storage';
import { FuelLogsRepo } from '@/db/fuel-logs-repo';
import { ConsumableLogsRepo } from '@/db/consumable-logs-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { uploadReceipt } from '@/lib/receiptUpload';
import { generateUuid } from '@/lib/uuid';
import { operatorStatsQueryKey } from '@/components/features/stats/OperatorStats';
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
   * the quantity step locked to this type. Useful for role-specific tabs
   * where only one type is relevant (e.g. 'diesel' for loader_operator).
   */
  lockType?: ConsumableType;
}

type ConsumableStep = 'type' | 'quantity' | 'photo' | 'confirm';

const UNIT_LABELS: Record<ConsumableType, string> = {
  diesel: 'litri',
  twine: 'kg',
};

export function ConsumableFlow({
  machineId,
  operatorId,
  parcelId,
  onComplete,
  lockType,
}: ConsumableFlowProps) {
  const queryClient = useQueryClient();
  // If lockType is set, we start directly at quantity with the type pre-selected.
  const [step, setStep] = useState<ConsumableStep>(lockType ? 'quantity' : 'type');
  const [consumableType, setConsumableType] = useState<ConsumableType | null>(lockType ?? null);
  const [quantity, setQuantity] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (!consumableType) return;
    const savedType = consumableType;
    setSaving(true);
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

      const pendingCount = await syncQueue.getPendingCount();
      void queryClient.invalidateQueries({
        queryKey: operatorStatsQueryKey(operatorId),
      });
      // If lockType is set, reset to quantity (skip type selection); otherwise back to type.
      setConsumableType(lockType ?? null);
      setQuantity('');
      setPhotoUri(null);
      setStep(lockType ? 'quantity' : 'type');
      Alert.alert(
        'Salvat',
        `${qty} ${UNIT_LABELS[savedType]} înregistrat. În coadă sync: ${pendingCount}.`,
      );
      onComplete();
    } catch (err) {
      Alert.alert(
        'Eroare',
        err instanceof Error ? err.message : 'Nu s-a putut salva consumabilul',
      );
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
  ]);

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
              onPress={() => setStep('quantity')}
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
        </View>
      );

    case 'quantity':
      return (
        <View style={styles.container}>
          <Text style={styles.title}>
            Cantitate ({consumableType ? UNIT_LABELS[consumableType] : ''})
          </Text>
          <NumericPad
            value={quantity}
            onChange={setQuantity}
            maxLength={6}
            decimal
          />
          <View style={styles.actions}>
            <BigButton
              title="Continuă"
              onPress={() => setStep('photo')}
              disabled={!quantity || quantity === '0'}
            />
            {/* Hide Back when type is locked — there is no previous step */}
            {!lockType && (
              <BigButton
                title="Înapoi"
                variant="outline"
                onPress={() => setStep('type')}
              />
            )}
          </View>
        </View>
      );

    case 'photo':
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Bon fiscal (opțional)</Text>
          <PhotoCapture
            label="Fotografie bon"
            onCapture={(uri) => setPhotoUri(uri)}
          />
          <View style={styles.actions}>
            <BigButton
              title="Continuă"
              onPress={() => setStep('confirm')}
            />
            <BigButton
              title="Sari peste"
              variant="outline"
              onPress={() => {
                setPhotoUri(null);
                setStep('confirm');
              }}
            />
          </View>
        </View>
      );

    case 'confirm':
      return (
        <ConsumableConfirmation
          consumableType={consumableType as ConsumableType}
          quantity={parseFloat(quantity)}
          hasPhoto={photoUri !== null}
          onConfirm={handleConfirm}
          onBack={() => setStep('photo')}
          loading={saving}
        />
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
  actions: {
    gap: 12,
    marginTop: 'auto',
  },
});
