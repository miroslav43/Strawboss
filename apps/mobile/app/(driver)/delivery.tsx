import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerSection}>
          <Text style={styles.title}>Livrare</Text>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={[styles.body, styles.centered]}>
          <ActivityIndicator color="#0A5C36" />
        </View>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={styles.content}>
          {activeTrip ? (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Cursă activă</Text>
                <Text style={styles.tripNumber}>{activeTrip.trip_number ?? 'Cursă'}</Text>
                {activeTrip.destination_name ? (
                  <View style={styles.inlineRow}>
                    <MaterialCommunityIcons name="map-marker" size={16} color="#5D4037" />
                    <Text style={styles.destination}>{activeTrip.destination_name}</Text>
                  </View>
                ) : null}
                <View style={styles.inlineRow}>
                  <MaterialCommunityIcons name="grain" size={16} color="#8D6E63" />
                  <Text style={styles.baleCount}>{activeTrip.bale_count} baloți</Text>
                </View>
              </View>

              <BigButton
                title="Începe procesul de livrare"
                onPress={() =>
                  router.push(`/driver-ops/delivery-flow?tripId=${activeTrip.id}`)
                }
              />
            </>
          ) : (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="truck" size={48} color="#8D6E63" />
              <Text style={styles.emptyText}>Nicio cursă la destinație.</Text>
              <Text style={styles.emptySubtext}>
                Când ajungeți la destinație, livrarea apare automat.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
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
  },
  title: { fontSize: 24, fontWeight: '700', color: '#FFFFFF' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: { justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, gap: 16 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
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
  empty: {
    flex: 1,
    alignItems: 'center',
    gap: 12,
    paddingTop: 48,
    paddingHorizontal: 24,
  },
  emptyText: { fontSize: 15, color: '#374151', fontWeight: '500', textAlign: 'center' },
  emptySubtext: { fontSize: 13, color: '#8D6E63', textAlign: 'center' },
});
