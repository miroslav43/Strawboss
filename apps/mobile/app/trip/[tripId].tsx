import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  FlatList,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useDeliveryDestinations } from '@strawboss/api';
import { getDatabase } from '@/lib/storage';
import { TripsRepo, type LocalTrip } from '@/db/trips-repo';
import { mobileApiClient } from '@/lib/api-client';
import { useSync } from '@/hooks/useSync';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useRelatedMachines } from '@/hooks/useRelatedMachines';
import { useAuthStore } from '@/stores/auth-store';
import { TripProgress } from '@/components/shared/TripProgress';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { BigButton } from '@/components/ui/BigButton';
import { ActionCard } from '@/components/ui/ActionCard';
import { colors } from '@strawboss/ui-tokens';
import { mobileLogger } from '@/lib/logger';

export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const { triggerSync } = useSync();
  const { tasks } = useMyTasks();
  const { data: relatedMachines } = useRelatedMachines();
  // Only the driver runs the trip workflow. Loaders, balers and others reach
  // this screen via a notification and may only watch the trip's progress.
  const isDriver = useAuthStore((s) => s.role) === 'driver';
  const [trip, setTrip] = useState<LocalTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const destinationsQuery = useDeliveryDestinations(mobileApiClient);

  // The driver's own task carries the source parcel. The loader is a sibling
  // machine (different operator) so it only surfaces via related-machines.
  const myDriverTask = tasks.find((t) => t.machineType !== 'loader');
  const loaderMachine = (relatedMachines ?? []).find((m) => m.machineType === 'loader');

  const loadTrip = useCallback(async () => {
    if (!tripId) return;
    try {
      const db = await getDatabase();
      const repo = new TripsRepo(db);
      let result = await repo.findById(tripId);
      if (!result) {
        // Trip not in local DB yet (push arrived before sync) — trigger sync and retry once.
        await triggerSync();
        result = await repo.findById(tripId);
      }
      setTrip(result);
    } catch (err) {
      mobileLogger.error('Failed to load trip from local DB', {
        tripId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
    } finally {
      setLoading(false);
    }
  }, [tripId, triggerSync]);

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
        await mobileApiClient.post(`/api/v1/trips/${tripId}/${endpoint}`, extraData ?? {});

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
          err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        });
        Alert.alert('Error', err instanceof Error ? err.message : 'Failed to update trip');
      } finally {
        setActionLoading(false);
      }
    },
    [tripId, trip, loadTrip],
  );

  const assignDestination = useCallback(
    async (destinationId: string, destinationName: string, destinationAddress: string | null) => {
      if (!tripId) return;
      setPickerOpen(false);
      setActionLoading(true);
      try {
        await mobileApiClient.post(`/api/v1/trips/${tripId}/set-destination`, {
          destinationId,
        });
        const db = await getDatabase();
        const repo = new TripsRepo(db);
        await repo.update(tripId, {
          destination_id: destinationId,
          destination_name: destinationName,
          destination_address: destinationAddress,
        });
        await loadTrip();
      } catch (err) {
        mobileLogger.error('Trip detail: assign destination failed', {
          tripId,
          destinationId,
          err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        });
        Alert.alert('Eroare', err instanceof Error ? err.message : 'Nu am putut salva depozitul.');
      } finally {
        setActionLoading(false);
      }
    },
    [tripId, loadTrip],
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Cursă" onBack={() => router.back()} />
        <View style={styles.body}>
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Se încarcă...</Text>
          </View>
        </View>
      </View>
    );
  }

  if (!trip) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Cursă" onBack={() => router.back()} />
        <View style={styles.body}>
          <View style={styles.centered}>
            <Text style={styles.errorText}>Cursa nu a fost găsită</Text>
            <BigButton title="Înapoi" variant="outline" onPress={() => router.back()} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title={trip.trip_number ?? 'Cursă'} onBack={() => router.back()} />
      <OfflineBanner />
      <View style={styles.body}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Progress Bar */}
          <View style={styles.card}>
            <TripProgress currentStatus={trip.status} />
          </View>

          {/* Trip Info */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Detalii cursă</Text>
              <StatusPill status={trip.status} />
            </View>

            {trip.trip_number && <InfoRow label="Nr. cursă" value={trip.trip_number} />}
            {myDriverTask?.parcelName ? (
              <InfoRow label="Parcelă" value={myDriverTask.parcelName} />
            ) : null}
            {loaderMachine?.machineCode ? (
              <InfoRow label="Loader" value={loaderMachine.machineCode} />
            ) : null}
            {trip.destination_name && <InfoRow label="Destinație" value={trip.destination_name} />}
            {trip.destination_address && (
              <InfoRow label="Adresă" value={trip.destination_address} />
            )}
            <InfoRow label="Baloți" value={String(trip.bale_count ?? 0)} />
            {trip.gross_weight_kg != null && (
              <InfoRow label="Greutate brută" value={`${trip.gross_weight_kg} kg`} />
            )}
            {trip.departure_at && (
              <InfoRow
                label="Plecat la"
                value={new Date(trip.departure_at).toLocaleString('ro-RO')}
              />
            )}
            {trip.arrival_at && (
              <InfoRow label="Sosit la" value={new Date(trip.arrival_at).toLocaleString('ro-RO')} />
            )}
            {trip.delivered_at && (
              <InfoRow
                label="Livrat la"
                value={new Date(trip.delivered_at).toLocaleString('ro-RO')}
              />
            )}
          </View>

          {/* Actions — only the driver runs the trip workflow */}
          {isDriver ? (
            <View style={styles.actionsSection}>
              <Text style={styles.sectionTitle}>Acțiuni</Text>

              {(trip.status === 'planned' || trip.status === 'loading') && (
                <View style={styles.waitingCard}>
                  <MaterialCommunityIcons name="timer-sand" size={20} color={colors.neutral} />
                  <Text style={styles.waitingText}>Așteaptă ca loader-ul să încarce camionul.</Text>
                </View>
              )}

              {trip.status === 'loaded' &&
                !trip.destination_name &&
                trip.destination_id == null && (
                  <ActionCard
                    title="Alege depozit"
                    subtitle="Selectează destinația înainte de plecare"
                    icon={
                      <MaterialCommunityIcons name="warehouse" size={24} color={colors.primary} />
                    }
                    onPress={() => setPickerOpen(true)}
                    variant="active"
                  />
                )}

              {trip.status === 'loaded' &&
                (trip.destination_name != null || trip.destination_id != null) && (
                  <ActionCard
                    title="Plecare"
                    subtitle="Introduceți km și semnați pentru a pleca"
                    icon={
                      <MaterialCommunityIcons
                        name="arrow-right-bold"
                        size={24}
                        color={colors.primary}
                      />
                    }
                    onPress={() =>
                      router.push({
                        pathname: '/driver-ops/departure-flow',
                        params: { tripId: trip.id },
                      })
                    }
                    variant="active"
                  />
                )}

              {trip.status === 'in_transit' && (
                <ActionCard
                  title="Sosit la destinație"
                  subtitle="Introduceți km la sosire"
                  icon={
                    <MaterialCommunityIcons name="map-marker" size={24} color={colors.primary} />
                  }
                  onPress={() =>
                    router.push({
                      pathname: '/driver-ops/arrival-flow',
                      params: { tripId: trip.id },
                    })
                  }
                  variant="active"
                />
              )}

              {trip.status === 'arrived' && (
                <ActionCard
                  title="Începe livrarea"
                  subtitle="Cântărire, fotografiere și semnătură"
                  icon={
                    <MaterialCommunityIcons
                      name="arrow-down-bold"
                      size={24}
                      color={colors.primary}
                    />
                  }
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
                  title="Finalizează cursa"
                  subtitle="Marchează această cursă ca finalizată"
                  icon={
                    <MaterialCommunityIcons name="check-bold" size={24} color={colors.primary} />
                  }
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
                    Cursa este {trip.status === 'completed' ? 'finalizată' : 'anulată'}.
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.viewerCard}>
              <MaterialCommunityIcons name="eye-outline" size={20} color={colors.primary} />
              <Text style={styles.viewerText}>
                Urmărești starea acestei curse. Acțiunile sunt efectuate de șofer.
              </Text>
            </View>
          )}

          {actionLoading && (
            <View style={styles.overlay}>
              <ActivityIndicator size="large" color={colors.white} />
            </View>
          )}
        </ScrollView>
      </View>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Alege depozit</Text>
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={12}>
              <MaterialCommunityIcons name="close" size={22} color={colors.neutral} />
            </Pressable>
          </View>
          {destinationsQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ padding: 24 }} />
          ) : destinationsQuery.error ? (
            <Text style={styles.modalError}>Nu am putut încărca depozitele.</Text>
          ) : (
            <FlatList
              data={(destinationsQuery.data ?? []).filter((d) => d.isActive !== false)}
              keyExtractor={(d) => d.id}
              ItemSeparatorComponent={() => <View style={styles.modalDivider} />}
              ListEmptyComponent={<Text style={styles.modalEmpty}>Nu există depozite active.</Text>}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() =>
                    void assignDestination(
                      item.id,
                      item.name,
                      (item as { address?: string | null }).address ?? null,
                    )
                  }
                >
                  <MaterialCommunityIcons name="warehouse" size={20} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalRowTitle}>{item.name}</Text>
                    {(item as { address?: string | null }).address ? (
                      <Text style={styles.modalRowSub}>
                        {(item as { address?: string | null }).address}
                      </Text>
                    ) : null}
                  </View>
                  {item.isDefault ? (
                    <View style={styles.defaultBadge}>
                      <Text style={styles.defaultBadgeText}>implicit</Text>
                    </View>
                  ) : null}
                </Pressable>
              )}
            />
          )}
        </View>
      </Modal>
    </View>
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
    backgroundColor: colors.primary,
  },
  body: {
    flex: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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
  viewerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primary50,
    borderRadius: 12,
    padding: 14,
  },
  viewerText: {
    color: colors.primary,
    fontSize: 14,
    flex: 1,
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
  waitingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primary50,
    borderRadius: 12,
    padding: 14,
  },
  waitingText: {
    color: colors.primary,
    fontSize: 14,
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '70%',
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.primary },
  modalEmpty: { padding: 24, color: colors.neutral, textAlign: 'center' },
  modalError: { padding: 24, color: colors.danger, textAlign: 'center' },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  modalRowTitle: { fontSize: 15, fontWeight: '600', color: colors.black },
  modalRowSub: { fontSize: 12, color: colors.neutral, marginTop: 2 },
  modalDivider: { height: 1, backgroundColor: '#EFEAE3', marginHorizontal: 18 },
  defaultBadge: {
    backgroundColor: colors.primary50,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  defaultBadgeText: { fontSize: 10, fontWeight: '700', color: colors.primary, letterSpacing: 0.4 },
});
