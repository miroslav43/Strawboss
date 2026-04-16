import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { getDatabase } from '@/lib/storage';
import { TripsRepo, type LocalTrip } from '@/db/trips-repo';
import { mobileApiClient } from '@/lib/api-client';
import { TripProgress } from '@/components/shared/TripProgress';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { StatusPill } from '@/components/ui/StatusPill';
import { BigButton } from '@/components/ui/BigButton';
import { ActionCard } from '@/components/ui/ActionCard';
import { colors } from '@strawboss/ui-tokens';
import { mobileLogger } from '@/lib/logger';

export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<LocalTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const loadTrip = useCallback(async () => {
    if (!tripId) return;
    try {
      const db = await getDatabase();
      const repo = new TripsRepo(db);
      const result = await repo.findById(tripId);
      setTrip(result);
    } catch (err) {
      mobileLogger.error('Failed to load trip from local DB', {
        tripId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    void loadTrip();
  }, [loadTrip]);

  const updateTripStatus = useCallback(
    async (newStatus: string, extraData?: Partial<LocalTrip>) => {
      if (!tripId) return;
      const fromStatus = trip?.status ?? 'unknown';
      setActionLoading(true);
      mobileLogger.flow('Trip detail: status transition start', {
        tripId,
        fromStatus,
        toStatus: newStatus,
      });
      try {
        // Map status to the correct API endpoint
        const STATUS_ENDPOINTS: Record<string, string> = {
          loading: 'start-loading',
          loaded: 'complete-loading',
          in_transit: 'depart',
          arrived: 'arrive',
          delivering: 'start-delivery',
          delivered: 'confirm-delivery',
          completed: 'complete',
          cancelled: 'cancel',
          disputed: 'dispute',
        };
        const endpoint = STATUS_ENDPOINTS[newStatus];
        if (!endpoint) {
          throw new Error(`Unknown target status: ${newStatus}`);
        }

        // Call the dedicated workflow endpoint (with proper state machine validation)
        await mobileApiClient.post(
          `/api/v1/trips/${tripId}/${endpoint}`,
          extraData ?? {},
        );

        // Update local SQLite to reflect the new status
        const db = await getDatabase();
        const tripsRepo = new TripsRepo(db);
        await tripsRepo.update(tripId, { status: newStatus, ...extraData });

        await loadTrip();
        mobileLogger.flow('Trip detail: status transition completed', {
          tripId,
          fromStatus,
          toStatus: newStatus,
        });
      } catch (err) {
        mobileLogger.error('Trip detail: status transition failed', {
          tripId,
          fromStatus,
          toStatus: newStatus,
          err:
            err instanceof Error
              ? { message: err.message, stack: err.stack }
              : err,
        });
        Alert.alert(
          'Error',
          err instanceof Error ? err.message : 'Failed to update trip',
        );
      } finally {
        setActionLoading(false);
      }
    },
    [tripId, trip, loadTrip],
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: true, title: 'Trip' }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading trip...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!trip) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: true, title: 'Trip' }} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Trip not found</Text>
          <BigButton title="Go Back" variant="outline" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{ headerShown: true, title: trip.trip_number ?? 'Trip' }}
      />
      <OfflineBanner />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Progress Bar */}
        <View style={styles.card}>
          <TripProgress currentStatus={trip.status} />
        </View>

        {/* Trip Info */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Trip Details</Text>
            <StatusPill status={trip.status} />
          </View>

          {trip.trip_number && (
            <InfoRow label="Trip Number" value={trip.trip_number} />
          )}
          {trip.destination_name && (
            <InfoRow label="Destination" value={trip.destination_name} />
          )}
          {trip.destination_address && (
            <InfoRow label="Address" value={trip.destination_address} />
          )}
          <InfoRow label="Bale Count" value={String(trip.bale_count ?? 0)} />
          {trip.gross_weight_kg != null && (
            <InfoRow
              label="Gross Weight"
              value={`${trip.gross_weight_kg} kg`}
            />
          )}
          {trip.departure_at && (
            <InfoRow
              label="Departed"
              value={new Date(trip.departure_at).toLocaleString()}
            />
          )}
          {trip.arrival_at && (
            <InfoRow
              label="Arrived"
              value={new Date(trip.arrival_at).toLocaleString()}
            />
          )}
          {trip.delivered_at && (
            <InfoRow
              label="Delivered"
              value={new Date(trip.delivered_at).toLocaleString()}
            />
          )}
        </View>

        {/* Actions */}
        <View style={styles.actionsSection}>
          <Text style={styles.sectionTitle}>Actions</Text>

          {trip.status === 'planned' && (
            <ActionCard
              title="Start Loading"
              subtitle="Scan machine and count bales"
              icon={<Text style={styles.actionIcon}>{'\u2B06'}</Text>}
              onPress={() =>
                router.push({
                  pathname: '/operations/load',
                  params: { tripId: trip.id },
                })
              }
              variant="active"
            />
          )}

          {trip.status === 'loading' && (
            <ActionCard
              title="Continue Loading"
              subtitle="Resume the loading process"
              icon={<Text style={styles.actionIcon}>{'\u2B06'}</Text>}
              onPress={() =>
                router.push({
                  pathname: '/operations/load',
                  params: { tripId: trip.id },
                })
              }
              variant="active"
            />
          )}

          {trip.status === 'loaded' && (
            <ActionCard
              title="Depart"
              subtitle="Begin transit to destination"
              icon={<Text style={styles.actionIcon}>{'\u27A1'}</Text>}
              onPress={() =>
                updateTripStatus('in_transit', {
                  departure_at: new Date().toISOString(),
                })
              }
              variant="active"
            />
          )}

          {trip.status === 'in_transit' && (
            <ActionCard
              title="Arrive at Destination"
              subtitle="Mark arrival at delivery point"
              icon={<Text style={styles.actionIcon}>{'\uD83D\uDCCD'}</Text>}
              onPress={() =>
                updateTripStatus('arrived', {
                  arrival_at: new Date().toISOString(),
                })
              }
              variant="active"
            />
          )}

          {trip.status === 'arrived' && (
            <ActionCard
              title="Start Delivery"
              subtitle="Weigh, photograph, and sign"
              icon={<Text style={styles.actionIcon}>{'\u2B07'}</Text>}
              onPress={() =>
                router.push({
                  pathname: '/operations/deliver',
                  params: { tripId: trip.id },
                })
              }
              variant="active"
            />
          )}

          {trip.status === 'delivered' && (
            <ActionCard
              title="Complete Trip"
              subtitle="Mark this trip as finished"
              icon={<Text style={styles.actionIcon}>{'\u2713'}</Text>}
              onPress={() =>
                updateTripStatus('completed', {
                  completed_at: new Date().toISOString(),
                })
              }
              variant="active"
            />
          )}

          {(trip.status === 'completed' || trip.status === 'cancelled') && (
            <View style={styles.doneCard}>
              <Text style={styles.doneText}>
                This trip is {trip.status}.
              </Text>
            </View>
          )}
        </View>

        {actionLoading && (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color={colors.white} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.primary,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
    color: colors.neutral,
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.black,
    maxWidth: '60%',
    textAlign: 'right',
  },
  actionsSection: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.neutral,
  },
  actionIcon: {
    fontSize: 20,
  },
  doneCard: {
    backgroundColor: colors.primary50,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  doneText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  loadingText: {
    fontSize: 16,
    color: colors.neutral,
    marginTop: 12,
  },
  errorText: {
    fontSize: 16,
    color: colors.danger,
    textAlign: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
});
