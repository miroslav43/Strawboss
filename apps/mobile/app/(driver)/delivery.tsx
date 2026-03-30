import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth-store';
import { useEffect, useState, useCallback } from 'react';
import { getDatabase } from '@/lib/storage';
import { TripsRepo, type LocalTrip } from '@/db/trips-repo';
import { BigButton } from '@/components/ui/BigButton';

export default function DriverDeliveryScreen() {
  const userId = useAuthStore((s) => s.userId);
  const [activeTrip, setActiveTrip] = useState<LocalTrip | null>(null);
  const [loading, setLoading] = useState(true);

  const loadActiveDelivery = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new TripsRepo(db);
      const all = await repo.listActive();
      // Find the trip that is in arrived/delivering state for this driver
      const delivery = all.find(
        (t) =>
          t.driver_id === userId &&
          (t.status === 'arrived' || t.status === 'delivering'),
      );
      setActiveTrip(delivery ?? null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadActiveDelivery();
  }, [loadActiveDelivery]);

  if (loading) {
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
      <View style={styles.header}>
        <Text style={styles.title}>Livrare</Text>
      </View>

      {activeTrip ? (
        <View style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Cursă activă</Text>
            <Text style={styles.tripNumber}>{activeTrip.trip_number ?? 'Cursă'}</Text>
            {activeTrip.destination_name ? (
              <Text style={styles.destination}>📍 {activeTrip.destination_name}</Text>
            ) : null}
            <Text style={styles.baleCount}>🌾 {activeTrip.bale_count} baloți</Text>
          </View>

          <BigButton
            title="📋  Începe procesul de livrare"
            onPress={() =>
              router.push(`/driver-ops/delivery-flow?tripId=${activeTrip.id}`)
            }
          />
        </View>
      ) : (
        <View style={styles.centered}>
          <Text style={styles.emptyEmoji}>🚛</Text>
          <Text style={styles.emptyText}>Nicio cursă la destinație.</Text>
          <Text style={styles.emptySubtext}>
            Când ajungeți la destinație, livrarea apare automat.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3DED8' },
  header: { padding: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#0A5C36' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 24 },
  content: { padding: 16, gap: 16 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: { fontSize: 13, color: '#5D4037', fontWeight: '500' },
  tripNumber: { fontSize: 20, fontWeight: '700', color: '#000' },
  destination: { fontSize: 14, color: '#5D4037' },
  baleCount: { fontSize: 14, color: '#8D6E63' },
  emptyEmoji: { fontSize: 48 },
  emptyText: { fontSize: 15, color: '#374151', fontWeight: '500', textAlign: 'center' },
  emptySubtext: { fontSize: 13, color: '#8D6E63', textAlign: 'center' },
});
