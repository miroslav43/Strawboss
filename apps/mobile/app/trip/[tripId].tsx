import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { getDatabase } from '@/lib/storage';
import { TripsRepo, type LocalTrip } from '@/db/trips-repo';

/**
 * Trip detail screen - placeholder structure.
 * Full implementation in Task 14.
 */
export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<LocalTrip | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!tripId) return;
      try {
        const db = await getDatabase();
        const repo = new TripsRepo(db);
        const result = await repo.findById(tripId);
        setTrip(result);
      } catch (err) {
        console.error('Failed to load trip:', err);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [tripId]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: true, title: 'Trip' }} />
        <Text style={styles.loadingText}>Loading...</Text>
      </SafeAreaView>
    );
  }

  if (!trip) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: true, title: 'Trip' }} />
        <View style={styles.content}>
          <Text style={styles.errorText}>Trip not found</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.back()}>
            <Text style={styles.buttonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{ headerShown: true, title: trip.trip_number ?? 'Trip' }}
      />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Trip Details</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Status:</Text>
            <Text style={styles.value}>{trip.status}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Bale Count:</Text>
            <Text style={styles.value}>{trip.bale_count ?? 0}</Text>
          </View>
          {trip.destination_name && (
            <View style={styles.row}>
              <Text style={styles.label}>Destination:</Text>
              <Text style={styles.value}>{trip.destination_name}</Text>
            </View>
          )}
          {trip.destination_address && (
            <View style={styles.row}>
              <Text style={styles.label}>Address:</Text>
              <Text style={styles.value}>{trip.destination_address}</Text>
            </View>
          )}
        </View>

        <View style={styles.actions}>
          {trip.status === 'planned' && (
            <TouchableOpacity
              style={styles.button}
              onPress={() => router.push('/operations/load')}
            >
              <Text style={styles.buttonText}>Start Loading</Text>
            </TouchableOpacity>
          )}
          {(trip.status === 'loaded' || trip.status === 'in_transit' || trip.status === 'arrived') && (
            <TouchableOpacity
              style={styles.button}
              onPress={() => router.push('/operations/deliver')}
            >
              <Text style={styles.buttonText}>Deliver</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3DED8',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  card: {
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
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0A5C36',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
    color: '#5D4037',
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  actions: {
    gap: 12,
  },
  button: {
    backgroundColor: '#0A5C36',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingText: {
    fontSize: 16,
    color: '#5D4037',
    textAlign: 'center',
    marginTop: 48,
  },
  errorText: {
    fontSize: 16,
    color: '#C62828',
    textAlign: 'center',
  },
});
