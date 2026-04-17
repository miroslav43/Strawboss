import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { Machine } from '@strawboss/types';
import { BigButton } from '@/components/ui/BigButton';
import { NumericPad } from '@/components/ui/NumericPad';
import { AlertBanner } from '@/components/shared/AlertBanner';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { useAuthStore } from '@/stores/auth-store';
import { mobileLogger } from '@/lib/logger';

type Step = 'count' | 'confirm';

export default function LoadBalesScreen() {
  const { truckId } = useLocalSearchParams<{ truckId: string }>();
  const userId = useAuthStore((s) => s.userId);
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);

  const [step, setStep] = useState<Step>('count');
  const [baleCountStr, setBaleCountStr] = useState('');
  const baleCount = parseInt(baleCountStr, 10) || 0;
  const [saving, setSaving] = useState(false);
  const [availabilityWarning, setAvailabilityWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data: truck, isLoading: truckLoading } = useQuery({
    queryKey: ['machine', truckId],
    queryFn: () => mobileApiClient.get<Machine>(`/api/v1/machines/${truckId}`),
    enabled: !!truckId,
  });

  const handleContinue = async () => {
    if (baleCount <= 0) return;

    // Check parcel bale availability if we have a parcel context
    // (For now we skip the parcel check since loader may not have parcel info here)
    setStep('confirm');
  };

  const handleConfirm = async () => {
    if (!truckId || !userId || saving) return;

    setSaving(true);
    mobileLogger.flow('Loader load-bales: enqueue bale_load', {
      truckId,
      baleCount,
    });
    try {
      const db = await getDatabase();
      const syncRepo = new SyncQueueRepo(db);

      const entityId = Math.random().toString(36).slice(2);
      const idempotencyKey = `bale-load-${entityId}`;

      await syncRepo.enqueue({
        entityType: 'bale_load',
        entityId,
        action: 'insert',
        payload: {
          truckId,
          loaderId: assignedMachineId,
          operatorId: userId,
          baleCount,
          loadedAt: new Date().toISOString(),
        },
        idempotencyKey,
      });

      mobileLogger.flow('Loader load-bales: enqueued OK', { entityId });
      setSaved(true);
      setTimeout(() => router.back(), 1500);
    } catch (err) {
      mobileLogger.error('Loader load-bales: enqueue failed', {
        truckId,
        err:
          err instanceof Error
            ? { message: err.message, stack: err.stack }
            : err,
      });
    } finally {
      setSaving(false);
    }
  };

  if (truckLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color="#0A5C36" />
          <Text style={styles.loadingText}>Se verifică camionul...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (saved) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <MaterialCommunityIcons name="check-circle" size={64} color="#0A5C36" />
          <Text style={styles.successText}>Baloți înregistrați!</Text>
          <Text style={styles.successSubtext}>Se sincronizează cu serverul...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Încarcă Baloți</Text>
        {truck ? (
          <View style={styles.truckRow}>
            <MaterialCommunityIcons name="truck" size={14} color="#5D4037" />
            <Text style={styles.truckInfo}>{truck.registrationPlate ?? truck.internalCode}</Text>
          </View>
        ) : null}
      </View>

      {availabilityWarning ? (
        <AlertBanner
          message={availabilityWarning}
          severity="warning"
          onDismiss={() => setAvailabilityWarning(null)}
        />
      ) : null}

      {step === 'count' && (
        <View style={styles.content}>
          <Text style={styles.stepLabel}>Număr baloți încărcați:</Text>
          <NumericPad
            value={baleCountStr}
            onChange={setBaleCountStr}
            decimal={false}
          />
          <BigButton
            title="Continuă"
            onPress={handleContinue}
            disabled={baleCount <= 0}
          />
          <BigButton
            title="Anulează"
            onPress={() => router.back()}
            variant="outline"
          />
        </View>
      )}

      {step === 'confirm' && (
        <View style={styles.content}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Confirmare încărcare</Text>
            {truck ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Camion</Text>
                <Text style={styles.summaryValue}>
                  {truck.registrationPlate ?? truck.internalCode}
                </Text>
              </View>
            ) : null}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Baloți</Text>
              <Text style={styles.summaryValueLarge}>{baleCount}</Text>
            </View>
          </View>

          <BigButton
            title="Încarcă"
            onPress={handleConfirm}
            loading={saving}
          />
          <BigButton
            title="Înapoi"
            onPress={() => setStep('count')}
            variant="outline"
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3DED8' },
  header: { padding: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#0A5C36' },
  truckRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  truckInfo: { fontSize: 14, color: '#5D4037' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: '#5D4037', fontSize: 14 },
  content: { padding: 16, gap: 12 },
  stepLabel: { fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: 4 },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  summaryTitle: { fontSize: 16, fontWeight: '600', color: '#0A5C36' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: 14, color: '#5D4037' },
  summaryValue: { fontSize: 14, fontWeight: '500', color: '#374151' },
  summaryValueLarge: { fontSize: 28, fontWeight: '700', color: '#0A5C36' },
  successText: { fontSize: 20, fontWeight: '700', color: '#0A5C36' },
  successSubtext: { fontSize: 14, color: '#5D4037' },
});
