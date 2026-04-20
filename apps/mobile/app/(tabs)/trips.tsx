import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getDatabase } from '@/lib/storage';
import { TripsRepo, type LocalTrip } from '@/db/trips-repo';
import { mobileLogger } from '@/lib/logger';

const STATUS_COLORS: Record<string, string> = {
  planned:    '#1565C0',
  loading:    '#B7791F',
  loaded:     '#0A5C36',
  in_transit: '#8D6E63',
  arrived:    '#2E7D32',
  delivering: '#B7791F',
  delivered:  '#2E7D32',
  completed:  '#5D4037',
};

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

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerSection}>
          <Text style={styles.title}>Curse Active</Text>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={[styles.body, styles.centered]}>
          <ActivityIndicator color="#0A5C36" />
        </View>
      ) : (
        <FlatList
          style={styles.body}
          data={trips}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.tripCard}
              onPress={() => router.push(`/trip/${item.id}`)}
            >
              <View style={styles.tripHeader}>
                <Text style={styles.tripNumber}>{item.trip_number ?? 'Fără număr'}</Text>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: STATUS_COLORS[item.status] ?? '#5D4037' },
                  ]}
                >
                  <Text style={styles.statusText}>
                    {item.status.replace('_', ' ')}
                  </Text>
                </View>
              </View>
              {item.destination_name ? (
                <Text style={styles.destination}>{item.destination_name}</Text>
              ) : null}
              <View style={styles.tripMeta}>
                <Text style={styles.metaText}>Baloți: {item.bale_count ?? 0}</Text>
                {item.departure_at ? (
                  <Text style={styles.metaText}>
                    Plecat: {new Date(item.departure_at).toLocaleString('ro-RO')}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>Nicio cursă activă</Text>
              <Text style={styles.emptySubtext}>
                Cursele asignate vor apărea aici
              </Text>
            </View>
          }
        />
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
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, paddingTop: 40 },
  list: { padding: 16, gap: 12 },
  tripCard: {
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
  tripHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tripNumber: { fontSize: 16, fontWeight: '600', color: '#000' },
  statusBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  destination: { fontSize: 14, color: '#5D4037' },
  tripMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  metaText: { fontSize: 12, color: '#8D6E63' },
  emptyText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  emptySubtext: { fontSize: 13, color: '#8D6E63' },
});
