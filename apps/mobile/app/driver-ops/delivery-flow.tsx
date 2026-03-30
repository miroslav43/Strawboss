import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { getDatabase } from '@/lib/storage';
import { TripsRepo, type LocalTrip } from '@/db/trips-repo';
import { EnhancedDeliveryFlow } from '@/components/features/delivery/EnhancedDeliveryFlow';

export default function DriverDeliveryFlowScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [trip, setTrip] = useState<LocalTrip | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tripId) return;
    getDatabase()
      .then((db) => {
        const repo = new TripsRepo(db);
        return repo.findById(tripId);
      })
      .then((found) => setTrip(found))
      .finally(() => setLoading(false));
  }, [tripId]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color="#0A5C36" />
        </View>
      </SafeAreaView>
    );
  }

  if (!trip || !tripId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Cursa nu a fost găsită.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <EnhancedDeliveryFlow
        tripId={tripId}
        tripNumber={trip.trip_number ?? 'Cursă'}
        baleCount={trip.bale_count}
        destinationName={trip.destination_name ?? '—'}
        onComplete={() => router.replace('/(driver)')}
        onCancel={() => router.back()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3DED8' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: '#C62828', fontSize: 14 },
});
