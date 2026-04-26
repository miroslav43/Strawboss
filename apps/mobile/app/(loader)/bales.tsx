import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useMyTrucksToLoad, type TripToLoad } from '@/hooks/useMyTrucksToLoad';
import { TaskList } from '@/components/shared/TaskList';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { getDatabase } from '@/lib/storage';
import { BaleLoadsRepo } from '@/db/bale-loads-repo';
import { colors } from '@strawboss/ui-tokens';

interface MyLoad {
  id: string;
  baleCount: number;
  loadedAt: string;
  notes: string | null;
}

/**
 * Accepts both snake_case server rows and snake_case local rows (which also
 * happen to share field names in this case) and a hypothetical camelCase
 * payload for defensive forwards-compatibility.
 */
function toMyLoad(row: Record<string, unknown>): MyLoad | null {
  const id = (row.id as string) ?? null;
  if (!id) return null;
  const rawCount = row.bale_count ?? row.baleCount ?? 0;
  const loadedAt =
    (row.loaded_at as string | undefined) ??
    (row.loadedAt as string | undefined) ??
    null;
  if (!loadedAt) return null;
  return {
    id,
    baleCount: Number(rawCount),
    loadedAt,
    notes: (row.notes as string | null) ?? null,
  };
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const STATUS_LABELS: Record<string, string> = {
  planned:    'Planificat',
  loading:    'Se încarcă',
  loaded:     'Încărcat',
  in_transit: 'În drum',
  completed:  'Finalizat',
};

const STATUS_COLORS: Record<string, string> = {
  planned:    '#1565C0',
  loading:    '#B7791F',
  loaded:     '#2E7D32',
};

function TripCard({ trip }: { trip: TripToLoad }) {
  const label = trip.truckPlate ?? trip.truckCode ?? 'Camion necunoscut';
  const parcelLabel = trip.sourceParcelName ?? trip.sourceParcelCode ?? null;
  const statusColor = STATUS_COLORS[trip.status] ?? '#5D4037';
  const statusLabel = STATUS_LABELS[trip.status] ?? trip.status;

  return (
    <TouchableOpacity
      style={styles.tripCard}
      activeOpacity={0.8}
      onPress={() =>
        router.push(
          `/loader-ops/load-bales?tripId=${trip.id}` as `/${string}`,
        )
      }
    >
      <View style={styles.tripCardHeader}>
        <View style={styles.tripTitleRow}>
          <MaterialCommunityIcons name="truck" size={20} color={colors.primary} />
          <Text style={styles.tripPlate}>{label}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text style={styles.statusBadgeText}>{statusLabel}</Text>
        </View>
      </View>

      {parcelLabel ? (
        <View style={styles.tripDetailRow}>
          <MaterialCommunityIcons name="map-marker" size={13} color={colors.neutral400} />
          <Text style={styles.tripDetail}>{parcelLabel}</Text>
        </View>
      ) : null}

      <View style={styles.tripDetailRow}>
        <MaterialCommunityIcons name="grain" size={13} color={colors.neutral400} />
        <Text style={styles.tripDetail}>{trip.baleCount} baloți încărcați</Text>
      </View>

      <View style={styles.tripCta}>
        <Text style={styles.tripCtaText}>Apasă pentru a înregistra încărcare →</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function LoaderBalesScreen() {
  const userId = useAuthStore((s) => s.userId);
  const [refreshing, setRefreshing] = useState(false);

  const tripsQuery = useMyTrucksToLoad();
  const { tasks, refetch: refetchTasks } = useMyTasks();

  const {
    data: loads,
    isLoading: loadsLoading,
    refetch: refetchLoads,
  } = useQuery<MyLoad[]>({
    queryKey: ['bale-loads', 'my', userId],
    enabled: !!userId,
    queryFn: async () => {
      const since = startOfTodayIso();
      // Start with anything the server already knows about for today.
      const serverRaw = await mobileApiClient
        .get<Record<string, unknown>[]>(
          `/api/v1/bale-loads?operatorId=${userId}&dateFrom=${encodeURIComponent(since)}`,
        )
        .catch(() => []);
      const serverLoads = (serverRaw ?? [])
        .map(toMyLoad)
        .filter((r): r is MyLoad => r !== null);

      // Then overlay local rows so the user sees pending (pre-sync) loads too.
      const db = await getDatabase();
      const localRows = await new BaleLoadsRepo(db).listByOperatorSince(
        userId!,
        since,
      );
      const localLoads = localRows
        .map((r) => toMyLoad(r as unknown as Record<string, unknown>))
        .filter((r): r is MyLoad => r !== null);

      // Merge by id — server wins when both sides have the same record.
      const byId = new Map<string, MyLoad>();
      for (const l of localLoads) byId.set(l.id, l);
      for (const l of serverLoads) byId.set(l.id, l);

      return [...byId.values()].sort((a, b) =>
        b.loadedAt.localeCompare(a.loadedAt),
      );
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([tripsQuery.refetch(), refetchLoads(), refetchTasks()]);
    setRefreshing(false);
  };

  const trips = tripsQuery.data ?? [];
  const myLoads = loads ?? [];

  return (
    <View style={styles.outerContainer}>
      <ScreenHeader title="Încărcări" />

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* ── Sarcini planificate de administrator ── */}
        {tasks.length > 0 ? (
          <View style={styles.tasksSection}>
            <TaskList tasks={tasks} role="loader_operator" />
          </View>
        ) : null}

        {/* ── Camioane de încărcat ── */}
        <Text style={styles.sectionTitle}>Camioane de încărcat azi</Text>
        {tripsQuery.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Se încarcă cursele...</Text>
          </View>
        ) : trips.length === 0 ? (
          <View style={styles.emptyTrips}>
            <Text style={styles.emptyText}>Nicio cursă planificată azi.</Text>
            <Text style={styles.emptySubtext}>
              Administratorul nu a planificat curse sau nu ești asignat ca operator loader.
            </Text>
          </View>
        ) : (
          trips.map((trip) => <TripCard key={trip.id} trip={trip} />)
        )}

        {/* ── Încărcări înregistrate ── */}
        <Text style={[styles.sectionTitle, styles.sectionTitleSecond]}>
          Încărcări înregistrate azi
        </Text>
        {loadsLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : myLoads.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Nicio încărcare înregistrată azi.</Text>
          </View>
        ) : (
          myLoads.map((load) => (
            <View key={load.id} style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Baloți</Text>
                <Text style={styles.cardValue}>{load.baleCount}</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Ora</Text>
                <Text style={styles.cardSubtext}>
                  {new Date(load.loadedAt).toLocaleTimeString('ro-RO', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              {load.notes ? <Text style={styles.notes}>{load.notes}</Text> : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: '#0A5C36' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  list: { padding: 16, gap: 12 },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.primary,
    marginTop: 8,
    marginBottom: 4,
  },
  tasksSection: {
    marginBottom: 16,
  },
  sectionTitleSecond: {
    marginTop: 20,
  },
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
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  tripCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tripTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  tripPlate: { fontSize: 18, fontWeight: '700', color: '#0A5C36', flex: 1 },
  statusBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  tripDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tripDetail: { fontSize: 13, color: '#5D4037' },
  tripCta: { marginTop: 4 },
  tripCtaText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  loadingText: { fontSize: 14, color: '#5D4037' },
  emptyTrips: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    gap: 4,
    marginBottom: 4,
  },
  emptyState: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 24,
  },
  emptyText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  emptySubtext: { fontSize: 13, color: '#8D6E63', textAlign: 'center', lineHeight: 18 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontSize: 13, color: '#5D4037' },
  cardValue: { fontSize: 20, fontWeight: '700', color: '#0A5C36' },
  cardSubtext: { fontSize: 14, color: '#374151' },
  notes: { fontSize: 12, color: '#8D6E63', fontStyle: 'italic', marginTop: 4 },
});
