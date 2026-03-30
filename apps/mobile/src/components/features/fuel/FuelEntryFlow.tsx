import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { NumericPad } from '../../ui/NumericPad';
import { BigButton } from '../../ui/BigButton';
import { PhotoCapture } from '../../shared/PhotoCapture';
import { getDatabase } from '@/lib/storage';
import { FuelLogsRepo } from '@/db/fuel-logs-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { colors } from '@strawboss/ui-tokens';

interface FuelEntryFlowProps {
  machineId: string | null;
  operatorId: string;
  onComplete: () => void;
  onCancel: () => void;
}

type FuelStep = 'liters' | 'odometer' | 'photo' | 'confirm';

export function FuelEntryFlow({
  machineId,
  operatorId,
  onComplete,
  onCancel,
}: FuelEntryFlowProps) {
  const [step, setStep] = useState<FuelStep>('liters');
  const [liters, setLiters] = useState('');
  const [odometer, setOdometer] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleConfirm = useCallback(async () => {
    setSaving(true);
    try {
      const db = await getDatabase();
      const fuelLogsRepo = new FuelLogsRepo(db);
      const syncQueue = new SyncQueueRepo(db);

      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const now = new Date().toISOString();
      const quantityLiters = parseFloat(liters);
      const odometerKm = odometer ? parseFloat(odometer) : null;

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
          parcel_id: null,
          logged_at: now,
          fuel_type: 'diesel',
          quantity_liters: quantityLiters,
          odometer_km: odometerKm,
          receipt_photo_uri: photoUri,
        },
        idempotencyKey: `fuel_log_${id}`,
      });

      onComplete();
    } catch (err) {
      Alert.alert(
        'Eroare',
        err instanceof Error ? err.message : 'Nu s-a putut salva alimentarea',
      );
    } finally {
      setSaving(false);
    }
  }, [machineId, operatorId, liters, odometer, photoUri, onComplete]);

  switch (step) {
    case 'liters':
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Litri alimentați</Text>
          <NumericPad
            value={liters}
            onChange={setLiters}
            maxLength={6}
            decimal
          />
          <View style={styles.actions}>
            <BigButton
              title="Continuă"
              onPress={() => setStep('odometer')}
              disabled={!liters || liters === '0'}
            />
            <BigButton title="Anulează" variant="outline" onPress={onCancel} />
          </View>
        </View>
      );

    case 'odometer':
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Citire odometru (km)</Text>
          <NumericPad
            value={odometer}
            onChange={setOdometer}
            maxLength={7}
            decimal
          />
          <View style={styles.actions}>
            <BigButton
              title="Continuă"
              onPress={() => setStep('photo')}
              disabled={!odometer || odometer === '0'}
            />
            <BigButton
              title="Înapoi"
              variant="outline"
              onPress={() => setStep('liters')}
            />
          </View>
        </View>
      );

    case 'photo':
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Foto bord / pompă (opțional)</Text>
          <PhotoCapture
            label="Fotografie"
            onCapture={(uri) => setPhotoUri(uri)}
          />
          <View style={styles.actions}>
            <BigButton title="Continuă" onPress={() => setStep('confirm')} />
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
        <View style={styles.container}>
          <Text style={styles.title}>Confirmare Alimentare</Text>

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
            <BigButton
              title="Salvează"
              onPress={handleConfirm}
              loading={saving}
            />
            <TouchableOpacity onPress={() => setStep('photo')} style={styles.backButton}>
              <Text style={styles.backText}>Înapoi</Text>
            </TouchableOpacity>
          </View>
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
