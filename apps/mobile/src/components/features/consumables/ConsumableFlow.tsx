import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { NumericPad } from '../../ui/NumericPad';
import { BigButton } from '../../ui/BigButton';
import { PhotoCapture } from '../../shared/PhotoCapture';
import { ConsumableTypeSelector } from '../../shared/ConsumableTypeSelector';
import { ConsumableConfirmation } from './ConsumableConfirmation';
import { getDatabase } from '@/lib/storage';
import { FuelLogsRepo } from '@/db/fuel-logs-repo';
import { ConsumableLogsRepo } from '@/db/consumable-logs-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { colors } from '@strawboss/ui-tokens';

type ConsumableType = 'diesel' | 'twine';

interface ConsumableFlowProps {
  machineId: string | null;
  operatorId: string;
  parcelId?: string;
  onComplete: () => void;
  onCancel: () => void;
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
  onCancel,
}: ConsumableFlowProps) {
  const [step, setStep] = useState<ConsumableStep>('type');
  const [consumableType, setConsumableType] = useState<ConsumableType | null>(null);
  const [quantity, setQuantity] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (!consumableType) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      const syncQueue = new SyncQueueRepo(db);

      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const now = new Date().toISOString();
      const qty = parseFloat(quantity);

      if (consumableType === 'diesel') {
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
          notes: null,
          created_at: now,
          updated_at: now,
          server_version: 0,
        });

        await syncQueue.enqueue({
          entityType: 'fuel_log',
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
            receipt_photo_uri: photoUri,
          },
          idempotencyKey: `fuel_log_${id}`,
        });
      } else {
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
          created_at: now,
          updated_at: now,
          server_version: 0,
        });

        await syncQueue.enqueue({
          entityType: 'consumable_log',
          entityId: id,
          action: 'insert',
          payload: {
            id,
            machine_id: machineId,
            operator_id: operatorId,
            parcel_id: parcelId ?? null,
            consumable_type: 'twine',
            quantity: qty,
            unit: 'kg',
            logged_at: now,
            receipt_photo_uri: photoUri,
          },
          idempotencyKey: `consumable_log_${id}`,
        });
      }

      onComplete();
    } catch (err) {
      Alert.alert(
        'Eroare',
        err instanceof Error ? err.message : 'Nu s-a putut salva consumabilul',
      );
    } finally {
      setSaving(false);
    }
  }, [consumableType, machineId, operatorId, parcelId, quantity, photoUri, onComplete]);

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
            <BigButton title="Anulează" variant="outline" onPress={onCancel} />
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
            <BigButton
              title="Înapoi"
              variant="outline"
              onPress={() => setStep('type')}
            />
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
