import { useEffect, useState, useCallback, useMemo } from 'react';
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
import { useNearbyLoaders } from '@/hooks/useNearbyLoaders';
import { useSync } from '@/hooks/useSync';
import { getDatabase } from '@/lib/storage';
import { TripsRepo, type LocalTrip } from '@/db/trips-repo';
import { colors, radii } from '@strawboss/ui-tokens';

const STATUS_COLORS: Record<string, string> = {
  planned: '#1565C0',
  loading: '#B7791F',
  loaded: '#0A5C36',
  in_transit: '#8D6E63',
  arrived: '#2E7D32',
  delivering: '#B7791F',
  delivered: '#2E7D32',
  completed: '#5D4037',
};

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planificat',
  loading: 'Se încarcă',
  loaded: 'Încărcat',
  in_transit: 'În drum',
  arrived: 'Sosit',
  delivering: 'Se livrează',
  delivered: 'Livrat',
  completed: 'Finalizat',
};

// Task assignment statuses are a separate enum from trip statuses.
const TASK_STATUS_COLORS: Record<string, string> = {
  available: '#1565C0',
  in_progress: '#B7791F',
  done: '#2E7D32',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  available: 'De început',
  in_progress: 'În lucru',
  done: 'Finalizat',
};

export default function DriverTripsScreen() {
  const userId = useAuthStore((s) => s.userId);
  const { tasks, refetch: refetchTasks } = useMyTasks();
  const { data: nearbyLoaders, refetch: refetchLoaders } = useNearbyLoaders();
  const { triggerSync } = useSync();
  const [trips, setTrips] = useState<LocalTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const activeTodayTask = useMemo(() => tasks.find((t) => t.status !== 'done'), [tasks]);

  const activeTrip = useMemo(
    () => trips.find((t) => t.status !== 'completed' && t.status !== 'cancelled'),
    [trips],
  );

  const loadTrips = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new TripsRepo(db);
      const all = await repo.listActive();
      // No userId yet (auth still hydrating) → show nothing rather than every
      // driver's trips. Filtering only happens once we know who is logged in.
      const mine = userId ? all.filter((t) => t.driver_id === userId) : [];
      setTrips(mine);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void (async () => {
      await triggerSync();
      await loadTrips();
    })();
  }, [userId, loadTrips, triggerSync]);

  const onRefresh = async () => {
    setRefreshing(true);
    await triggerSync();
    await Promise.all([loadTrips(), refetchTasks(), refetchLoaders()]);
    setRefreshing(false);
  };

  const handleTripPress = async (trip: LocalTrip) => {
    if (!trip.acknowledged_at) {
      try {
        const db = await getDatabase();
        const repo = new TripsRepo(db);
        await repo.acknowledge(trip.id);
        setTrips((prev) =>
          prev.map((t) =>
            t.id === trip.id ? { ...t, acknowledged_at: new Date().toISOString() } : t,
          ),
        );
      } catch {
        // Best-effort — proceed to nav even if local update fails.
      }
    }
    if (trip.status === 'arrived' || trip.status === 'delivering' || trip.status === 'delivered') {
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
          ListHeaderComponent={
            <View style={styles.headerCards}>
              {/* Card 1 — Loadere din apropiere */}
              <View style={styles.infoCard}>
                <View style={styles.infoCardHeader}>
                  <MaterialCommunityIcons name="excavator" size={18} color="#0A5C36" />
                  <Text style={styles.infoCardTitle}>Loadere active</Text>
                </View>
                {(nearbyLoaders ?? []).length === 0 ? (
                  <Text style={styles.infoCardEmpty}>Niciun loader în apropiere.</Text>
                ) : (
                  (nearbyLoaders ?? []).map((loader) => (
                    <View key={loader.id} style={styles.loaderRow}>
                      <MaterialCommunityIcons name="tractor" size={14} color="#5D4037" />
                      <Text style={styles.loaderCode}>
                        {loader.internalCode ?? loader.registrationPlate ?? '—'}
                      </Text>
                      <Text style={styles.loaderOperator}>{loader.operatorName ?? '—'}</Text>
                      <Text style={styles.loaderTime}>{Math.round(loader.distanceM)} m</Text>
                    </View>
                  ))
                )}
              </View>

              {/* Card 2 — Sarcina de azi */}
              {activeTodayTask ? (
                <TouchableOpacity
                  style={styles.infoCard}
                  activeOpacity={0.75}
                  onPress={() => {
                    if (activeTrip) {
                      router.push(`/trip/${activeTrip.id}`);
                    }
                  }}
                >
                  <View style={styles.infoCardHeader}>
                    <MaterialCommunityIcons name="clipboard-list" size={18} color="#0A5C36" />
                    <Text style={styles.infoCardTitle}>Sarcina de azi</Text>
                    {activeTrip && (
                      <MaterialCommunityIcons
                        name="chevron-right"
                        size={18}
                        color="#8D6E63"
                        style={{ marginLeft: 'auto' }}
                      />
                    )}
                  </View>
                  {activeTodayTask.parcelName ? (
                    <View style={styles.taskRow}>
                      <MaterialCommunityIcons name="map" size={14} color="#5D4037" />
                      <Text style={styles.taskRowText}>{activeTodayTask.parcelName}</Text>
                    </View>
                  ) : null}
                  {activeTodayTask.destinationName ? (
                    <View style={styles.taskRow}>
                      <MaterialCommunityIcons name="warehouse" size={14} color="#5D4037" />
                      <Text style={styles.taskRowText}>{activeTodayTask.destinationName}</Text>
                    </View>
                  ) : null}
                  <View style={styles.taskRow}>
                    <View
                      style={[
                        styles.taskStatusBadge,
                        {
                          backgroundColor: TASK_STATUS_COLORS[activeTodayTask.status] ?? '#5D4037',
                        },
                      ]}
                    >
                      <Text style={styles.taskStatusText}>
                        {TASK_STATUS_LABELS[activeTodayTask.status] ?? activeTodayTask.status}
                      </Text>
                    </View>
                    {!activeTrip && <Text style={styles.taskNoTrip}>Cursa nu a început încă</Text>}
                  </View>
                </TouchableOpacity>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const isFresh = item.status === 'loaded' && !item.acknowledged_at;
            return (
              <TouchableOpacity
                style={[styles.card, isFresh && styles.cardFresh]}
                onPress={() => void handleTripPress(item)}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderLeft}>
                    {isFresh && (
                      <View style={styles.newBadge}>
                        <Text style={styles.newBadgeText}>NOU</Text>
                      </View>
                    )}
                    <Text style={styles.tripNumber}>{item.trip_number ?? 'Cursă'}</Text>
                  </View>
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: STATUS_COLORS[item.status] ?? '#5D4037' },
                    ]}
                  >
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
                  {item.status === 'loaded' && (
                    <Text style={styles.loadedHint}>Apasă pentru plecare</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
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
    borderRadius: radii.lg,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardFresh: {
    borderLeftWidth: 4,
    borderLeftColor: '#0A5C36',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  newBadge: {
    backgroundColor: '#FBBF24',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  newBadgeText: { color: '#000', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  tripNumber: { fontSize: 16, fontWeight: '600', color: '#000' },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  destination: { fontSize: 14, color: '#5D4037' },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaText: { fontSize: 13, color: colors.textSecondary },
  deliveryHint: { fontSize: 12, color: '#0A5C36', fontWeight: '600' },
  loadedHint: { fontSize: 12, color: '#0A5C36', fontWeight: '600' },
  emptyText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  emptySubtext: { fontSize: 13, color: colors.textSecondary },
  headerCards: { gap: 12, marginBottom: 4 },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.lg,
    padding: 14,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  infoCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoCardTitle: { fontSize: 14, fontWeight: '700', color: '#0A5C36' },
  infoCardEmpty: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic' },
  loaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  loaderCode: { fontSize: 13, fontWeight: '600', color: '#374151', flexShrink: 0 },
  loaderOperator: { fontSize: 13, color: '#5D4037', flex: 1 },
  loaderTime: { fontSize: 11, color: colors.textSecondary },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskRowText: { fontSize: 13, color: '#374151', flex: 1 },
  taskStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  taskStatusText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  taskNoTrip: { fontSize: 11, color: colors.textSecondary, marginLeft: 4 },
});
