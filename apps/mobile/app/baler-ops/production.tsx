import { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ProductionFlow } from '@/components/features/production/ProductionFlow';
import { ParcelSelector } from '@/components/shared/ParcelSelector';
import { BigButton } from '@/components/ui/BigButton';
import { useAuthStore } from '@/stores/auth-store';

export default function BalerProductionScreen() {
  const userId = useAuthStore((s) => s.userId);
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);

  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [selectedParcelName, setSelectedParcelName] = useState<string | null>(null);
  const [parcelConfirmed, setParcelConfirmed] = useState(false);

  if (!userId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color="#0A5C36" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {!parcelConfirmed ? (
        <View style={styles.selectionContent}>
          <Text style={styles.title}>Înregistrează Producție</Text>
          <Text style={styles.subtitle}>Selectați parcela curentă:</Text>

          <ParcelSelector
            onSelect={(parcelId, parcelName) => {
              setSelectedParcelId(parcelId);
              setSelectedParcelName(parcelName);
            }}
            selectedId={selectedParcelId}
            selectedName={selectedParcelName}
          />

          <View style={styles.actions}>
            <BigButton
              title="Continuă"
              onPress={() => setParcelConfirmed(true)}
              disabled={!selectedParcelId}
            />
            <BigButton
              title="Anulează"
              variant="outline"
              onPress={() => router.back()}
            />
          </View>
        </View>
      ) : (
        <ProductionFlow
          parcelId={selectedParcelId!}
          parcelName={selectedParcelName!}
          balerId={assignedMachineId}
          operatorId={userId}
          onComplete={() => router.back()}
          onCancel={() => setParcelConfirmed(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3DED8' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  selectionContent: { flex: 1, padding: 16, gap: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#0A5C36' },
  subtitle: { fontSize: 14, color: '#5D4037' },
  actions: { marginTop: 'auto', gap: 12 },
});
