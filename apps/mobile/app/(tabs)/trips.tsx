import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getDatabase } from '@/lib/storage';
import { TripsRepo, type LocalTrip } from '@/db/trips-repo';
import { mobileLogger } from '@/lib/logger';

export default function TripsScreen() {
  const [trips, setTrips] = useState<LocalTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const loadTrips = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new TripsRepo(db);
      const activeTrips = await repo.listActive();
      setTrips(activeTrips);
    } catch (err) {
      mobileLogger.error('Failed to load active trips from local DB', {
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrips();
  }, [loadTrips]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTrips();
    setRefreshing(false);
  };

  const getStatusColor = (status: string): string => {
    const statusColors: Record<string, string> = {
      planned: '#1565C0',
      loading: '#B7791F',
      loaded: '#0A5C36',
      in_transit: '#8D6E63',
      arrived: '#2E7D32',
      delivering: '#B7791F',
      delivered: '#2E7D32',
      completed: '#5D4037',
    };
    return statusColors[status] ?? '#5D4037';
  };

  const renderTrip = ({ item }: { item: LocalTrip }) => (
    <TouchableOpacity
      style={styles.tripCard}
      onPress={() => router.push(`/trip/${item.id}`)}
    >
      <View style={styles.tripHeader}>
        <Text style={styles.tripNumber}>{item.trip_number ?? 'No number'}</Text>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: getStatusColor(item.status) },
          ]}
        >
          <Text style={styles.statusText}>{item.status.replace('_', ' ')}</Text>
        </View>
      </View>
      {item.destination_name && (
        <Text style={styles.destination}>{item.destination_name}</Text>
      )}
      <View style={styles.tripMeta}>
        <Text style={styles.metaText}>
          Bales: {item.bale_count ?? 0}
        </Text>
        {item.departure_at && (
          <Text style={styles.metaText}>
            Departed: {new Date(item.departure_at).toLocaleString()}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.loadingText}>Loading trips...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerContainer}>
        <Text style={styles.title}>Active Trips</Text>
      </View>
      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        renderItem={renderTrip}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No active trips</Text>
            <Text style={styles.emptySubtext}>
              Trips assigned to you will appear here
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3DED8',
  },
  headerContainer: {
    padding: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0A5C36',
  },
  list: {
    padding: 16,
    gap: 12,
  },
  tripCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 12,
  },
  tripHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tripNumber: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  statusBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  destination: {
    fontSize: 14,
    color: '#5D4037',
  },
  tripMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaText: {
    fontSize: 12,
    color: '#8D6E63',
  },
  loadingText: {
    fontSize: 16,
    color: '#5D4037',
    textAlign: 'center',
    marginTop: 48,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#5D4037',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#8D6E63',
    marginTop: 8,
  },
});
