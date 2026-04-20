import { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ProductionFlow } from '@/components/features/production/ProductionFlow';
import { ParcelSelector } from '@/components/shared/ParcelSelector';
import { BigButton } from '@/components/ui/BigButton';
import { useAuthStore } from '@/stores/auth-store';
import { mobileLogger } from '@/lib/logger';

export default function BalerProductionScreen() {
  const userId = useAuthStore((s) => s.userId);
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);

  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [selectedParcelName, setSelectedParcelName] = useState<string | null>(null);
  const [parcelConfirmed, setParcelConfirmed] = useState(false);

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerSection}>
          <Text style={styles.title}>Înregistrează Producție</Text>
          {!parcelConfirmed && (
            <Text style={styles.subtitle}>Selectați parcela curentă</Text>
          )}
        </View>
      </SafeAreaView>

      <View style={styles.body}>
        {!userId ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#0A5C36" />
          </View>
        ) : !parcelConfirmed ? (
          <ScrollView contentContainerStyle={styles.content}>
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
                onPress={() => {
                  if (selectedParcelId) {
                    mobileLogger.flow('Baler production: parcel chosen', {
                      parcelId: selectedParcelId,
                    });
                  }
                  setParcelConfirmed(true);
                }}
                disabled={!selectedParcelId}
              />
              <BigButton
                title="Anulează"
                variant="outline"
                onPress={() => router.back()}
              />
            </View>
          </ScrollView>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: '#0A5C36' },
  safeArea: { backgroundColor: '#0A5C36' },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 4,
  },
  title: { fontSize: 24, fontWeight: '700', color: '#FFFFFF' },
  subtitle: { fontSize: 14, color: 'rgba(255, 255, 255, 0.8)' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, gap: 16, flexGrow: 1 },
  actions: { gap: 12, marginTop: 'auto', paddingTop: 16 },
});
