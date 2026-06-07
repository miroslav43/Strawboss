import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useAuthStore } from '@/stores/auth-store';
import { getDatabase } from '@/lib/storage';
import { TripsRepo, type LocalTrip } from '@/db/trips-repo';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { ActiveTripCard, pickFeaturedTrip } from '@/components/features/driver/ActiveTripCard';
import { useSync } from '@/hooks/useSync';
import { fontScale } from '@/utils/responsive';

export default function DriverDeliveryScreen() {
  const userId = useAuthStore((s) => s.userId);
  const { triggerSync } = useSync();
  const [activeTrip, setActiveTrip] = useState<LocalTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Feature the most relevant active trip across the whole lifecycle
  // (loaded → in_transit → arrived → delivering → delivered), so the driver can
  // watch the distance-to-depot readout while en route — not only once arrived.
  const loadActiveTrip = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new TripsRepo(db);
      const all = await repo.listActive();
      const mine = userId ? all.filter((t) => t.driver_id === userId) : [];
      setActiveTrip(pickFeaturedTrip(mine));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Pull the latest trip state when the tab is focused, THEN load from cache.
  // On a fresh install the initial (Cursele Mele) sync may not have finished
  // when the user opens Livrare — and useFocusEffect won't re-run when that
  // background sync later lands — so an in-delivery trip would be missing until
  // a manual refresh. Syncing here (best-effort) keeps the card current and
  // also reflects status changes made elsewhere (depart / delivery flows).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        try {
          await triggerSync();
        } catch {
          // Offline or sync error — fall back to whatever is cached locally.
        }
        if (active) await loadActiveTrip();
      })();
      return () => {
        active = false;
      };
    }, [triggerSync, loadActiveTrip]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await triggerSync();
    await loadActiveTrip();
    setRefreshing(false);
  }, [triggerSync, loadActiveTrip]);

  const handleTripPress = useCallback((trip: LocalTrip) => {
    if (trip.status === 'arrived' || trip.status === 'delivering' || trip.status === 'delivered') {
      router.push(`/driver-ops/delivery-flow?tripId=${trip.id}`);
    } else {
      router.push(`/trip/${trip.id}`);
    }
  }, []);

  return (
    <View style={styles.outerContainer}>
      <ScreenHeader title="Livrare" />

      {loading ? (
        <View style={[styles.body, styles.centered]}>
          <ActivityIndicator color="#0A5C36" />
        </View>
      ) : (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0A5C36" />
          }
        >
          {activeTrip ? (
            <ActiveTripCard trip={activeTrip} onPress={handleTripPress} />
          ) : (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="truck" size={48} color="#8D6E63" />
              <Text style={styles.emptyText}>Nicio cursă activă.</Text>
              <Text style={styles.emptySubtext}>
                Cursa apare aici cât timp este activă, până la livrare.
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
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: { justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, gap: 16, flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    gap: 12,
    paddingTop: 48,
    paddingHorizontal: 24,
  },
  emptyText: { fontSize: fontScale(15), color: '#374151', fontWeight: '500', textAlign: 'center' },
  emptySubtext: { fontSize: fontScale(13), color: '#8D6E63', textAlign: 'center' },
});
