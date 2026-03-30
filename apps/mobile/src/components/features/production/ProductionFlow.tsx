import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { NumericPad } from '../../ui/NumericPad';
import { BigButton } from '../../ui/BigButton';
import { ProductionConfirmation } from './ProductionConfirmation';
import { getDatabase } from '@/lib/storage';
import { BaleProductionsRepo } from '@/db/bale-productions-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { colors } from '@strawboss/ui-tokens';

interface ProductionFlowProps {
  parcelId: string;
  parcelName: string;
  balerId: string | null;
  operatorId: string;
  onComplete: () => void;
  onCancel: () => void;
}

type ProductionStep = 'info' | 'count' | 'confirm';

export function ProductionFlow({
  parcelId,
  parcelName,
  balerId,
  operatorId,
  onComplete,
  onCancel,
}: ProductionFlowProps) {
  const [step, setStep] = useState<ProductionStep>('info');
  const [baleCount, setBaleCount] = useState('');
  const [saving, setSaving] = useState(false);

  const handleConfirm = useCallback(async () => {
    setSaving(true);
    try {
      const db = await getDatabase();
      const productionsRepo = new BaleProductionsRepo(db);
      const syncQueue = new SyncQueueRepo(db);

      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const now = new Date().toISOString();
      const count = parseInt(baleCount, 10);

      const record = {
        id,
        parcel_id: parcelId,
        baler_id: balerId,
        operator_id: operatorId,
        production_date: now.slice(0, 10),
        bale_count: count,
        avg_bale_weight_kg: null,
        start_time: null,
        end_time: now,
        created_at: now,
        updated_at: now,
        server_version: 0,
      };

      await productionsRepo.create(record);

      await syncQueue.enqueue({
        entityType: 'bale_production',
        entityId: id,
        action: 'insert',
        payload: {
          id,
          parcel_id: parcelId,
          baler_id: balerId,
          operator_id: operatorId,
          production_date: record.production_date,
          bale_count: count,
          end_time: now,
        },
        idempotencyKey: `bale_production_${id}`,
      });

      onComplete();
    } catch (err) {
      Alert.alert(
        'Eroare',
        err instanceof Error ? err.message : 'Nu s-a putut salva producția',
      );
    } finally {
      setSaving(false);
    }
  }, [parcelId, balerId, operatorId, baleCount, onComplete]);

  switch (step) {
    case 'info':
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Înregistrare Producție</Text>
          <View style={styles.parcelCard}>
            <Text style={styles.parcelLabel}>Parcela curentă:</Text>
            <Text style={styles.parcelName}>{parcelName}</Text>
          </View>
          <View style={styles.actions}>
            <BigButton
              title="Comenzi producție"
              onPress={() => setStep('count')}
            />
            <BigButton title="Anulează" variant="outline" onPress={onCancel} />
          </View>
        </View>
      );

    case 'count':
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Număr baloți</Text>
          <NumericPad value={baleCount} onChange={setBaleCount} maxLength={4} />
          <View style={styles.actions}>
            <BigButton
              title="Continuă"
              onPress={() => setStep('confirm')}
              disabled={!baleCount || baleCount === '0'}
            />
            <BigButton
              title="Înapoi"
              variant="outline"
              onPress={() => setStep('info')}
            />
          </View>
        </View>
      );

    case 'confirm':
      return (
        <ProductionConfirmation
          parcelName={parcelName}
          baleCount={parseInt(baleCount, 10)}
          onConfirm={handleConfirm}
          onBack={() => setStep('count')}
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
  parcelCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    gap: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  parcelLabel: {
    fontSize: 14,
    color: colors.neutral,
    fontWeight: '500',
  },
  parcelName: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },
  actions: {
    gap: 12,
    marginTop: 'auto',
  },
});
