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
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { TaskList } from '@/components/shared/TaskList';
import { ConnectionStatusBadge } from '@/components/shared/ConnectionStatusBadge';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { useAuthStore } from '@/stores/auth-store';
import { useMyTasks } from '@/hooks/useMyTasks';
import { getDatabase } from '@/lib/storage';
import { TripsRepo, type LocalTrip } from '@/db/trips-repo';

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

const STATUS_LABELS: Record<string, string> = {
  planned:    'Planificat',
  loading:    'Se încarcă',
  loaded:     'Încărcat',
  in_transit: 'În drum',
  arrived:    'Sosit',
  delivering: 'Se livrează',
  delivered:  'Livrat',
  completed:  'Finalizat',
};

export default function DriverTripsScreen() {
  const userId = useAuthStore((s) => s.userId);
  const { tasks, refetch: refetchTasks } = useMyTasks();
  const [trips, setTrips] = useState<LocalTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTrips = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new TripsRepo(db);
      const all = await repo.listActive();
      // Filter to trips assigned to this driver
      const mine = userId ? all.filter((t) => t.driver_id === userId) : all;
      setTrips(mine);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadTrips();
  }, [loadTrips]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadTrips(), refetchTasks()]);
    setRefreshing(false);
  };

  const handleTripPress = (trip: LocalTrip) => {
    if (trip.status === 'arrived' || trip.status === 'delivering') {
      router.push(`/driver-ops/delivery-flow?tripId=${trip.id}`);
    } else {
      router.push(`/trip/${trip.id}`);
    }
  };

  return (
    <View style={styles.outerContainer}>
      <ScreenHeader
        title="Cursele Mele"
        right={
          <View style={styles.headerRightGroup}>
            <ConnectionStatusBadge />
            <NotificationBell />
          </View>
        }
      >
        <TaskList tasks={tasks} role="driver" />
      </ScreenHeader>

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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => handleTripPress(item)}>
              <View style={styles.cardHeader}>
                <Text style={styles.tripNumber}>{item.trip_number ?? 'Cursă'}</Text>
                <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] ?? '#5D4037' }]}>
                  <Text style={styles.badgeText}>
                    {STATUS_LABELS[item.status] ?? item.status}
                  </Text>
                </View>
              </View>
              {item.destination_name ? (
                <View style={styles.inlineRow}>
                  <MaterialCommunityIcons name="map-marker" size={14} color="#5D4037" />
                  <Text style={styles.destination}>{item.destination_name}</Text>
                </View>
              ) : null}
              <View style={styles.meta}>
                <View style={styles.inlineRow}>
                  <MaterialCommunityIcons name="grain" size={13} color="#8D6E63" />
                  <Text style={styles.metaText}>{item.bale_count} baloți</Text>
                </View>
                {item.status === 'arrived' && (
                  <Text style={styles.deliveryHint}>Apasă pentru livrare</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>Nicio cursă activă.</Text>
              <Text style={styles.emptySubtext}>Cursele asignate vor apărea aici.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#0A5C36',
  },
  headerRightGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingTop: 40,
  },
  list: {
    padding: 16,
    gap: 12,
  },
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tripNumber: { fontSize: 16, fontWeight: '600', color: '#000' },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  destination: { fontSize: 14, color: '#5D4037' },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaText: { fontSize: 13, color: '#8D6E63' },
  deliveryHint: { fontSize: 12, color: '#0A5C36', fontWeight: '600' },
  emptyText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  emptySubtext: { fontSize: 13, color: '#8D6E63' },
});
