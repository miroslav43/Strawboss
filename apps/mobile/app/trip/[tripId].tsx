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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useDeliveryDestinations } from '@strawboss/api';
import { getDatabase } from '@/lib/storage';
import { TripsRepo, type LocalTrip } from '@/db/trips-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { useSync } from '@/hooks/useSync';
import { useTripTransition } from '@/hooks/useTripTransition';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useRelatedMachines } from '@/hooks/useRelatedMachines';
import { useAuthStore } from '@/stores/auth-store';
import { TripProgress } from '@/components/shared/TripProgress';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import {
  PendingTransitionBadge,
  type PendingTransitionStatus,
} from '@/components/shared/PendingTransitionBadge';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { BigButton } from '@/components/ui/BigButton';
import { ActionCard } from '@/components/ui/ActionCard';
import { OpenMapsToDepotButton } from '@/components/features/driver/OpenMapsToDepotButton';
import { NavigateToLoaderButton } from '@/components/features/driver/NavigateToLoaderButton';
import { colors, radii } from '@strawboss/ui-tokens';
import { mobileLogger } from '@/lib/logger';
import { mobileApiClient } from '@/lib/api-client';
import type { TripTransitionPayload } from '@/sync/push';
import { useI18n } from '@/lib/i18n';

export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { triggerSync } = useSync();
  const { enqueueTransition } = useTripTransition();
  const { tasks } = useMyTasks();
  const { data: relatedMachines } = useRelatedMachines();
  // Only the driver runs the trip workflow. Loaders, balers and others reach
  // this screen via a notification and may only watch the trip's progress.
  const { t } = useI18n();
  const isDriver = useAuthStore((s) => s.role) === 'driver';
  const [trip, setTrip] = useState<LocalTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // M11 — the real sync_queue status for this trip's pending transition (if
  // any), so the badge can distinguish `failed` (needs a tap to retry) from
  // `pending`/`in_flight` (will send automatically).
  const [transitionStatus, setTransitionStatus] = useState<{
    id: number;
    status: PendingTransitionStatus;
  } | null>(null);
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
      const syncQueueRepo = new SyncQueueRepo(db);
      setTransitionStatus(await syncQueueRepo.getTransitionStatusForTrip(tripId));
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

  const assignDestination = useCallback(
    async (destinationId: string, destinationName: string, destinationAddress: string | null) => {
      if (!tripId) return;
      setPickerOpen(false);
      setActionLoading(true);
      try {
        // FM-1: Offline-first — write locally then enqueue for server sync.
        const db = await getDatabase();
        const repo = new TripsRepo(db);
        const syncQueueRepo = new SyncQueueRepo(db);

        // Update destination fields locally (no status change for set-destination).
        await repo.update(tripId, {
          destination_id: destinationId,
          destination_name: destinationName,
          destination_address: destinationAddress,
        });

        // Enqueue the transition for the server.
        const payload: TripTransitionPayload = {
          transition: 'set-destination',
          tripId,
          body: { destinationId },
        };
        await syncQueueRepo.enqueue({
          entityType: 'trip_transition',
          entityId: tripId,
          action: 'update',
          payload,
          idempotencyKey: `trip_transition_${tripId}_set-destination_${destinationId}`,
        });

        mobileLogger.flow('Trip detail: set-destination enqueued offline-first', {
          tripId,
          destinationId,
        });

        // Reload local trip to update the UI immediately.
        await loadTrip();

        // Best-effort sync.
        void triggerSync().catch(() => {});
      } catch (err) {
        mobileLogger.error('Trip detail: assign destination failed', {
          tripId,
          destinationId,
          err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        });
        Alert.alert(
          t('tripDetail.alert.error.title'),
          err instanceof Error ? err.message : t('tripDetail.alert.error.saveDepot'),
        );
      } finally {
        setActionLoading(false);
      }
    },
    [tripId, loadTrip, triggerSync],
  );

  // Arrival is a single-tap confirm — distance comes from the GPS track, so no
  // odometer screen. Optimistically applies "arrived" locally and enqueues the
  // transition (offline-first, with a pending badge until it syncs).
  const handleArrive = useCallback(async () => {
    if (!trip) return;
    setActionLoading(true);
    try {
      await enqueueTransition({
        tripId: trip.id,
        currentStatus: trip.status,
        transition: 'arrive',
        body: {},
        localMeta: { arrival_at: new Date().toISOString() },
      });
      await loadTrip();
    } catch (err) {
      mobileLogger.error('Trip detail: arrive failed', {
        tripId: trip.id,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      Alert.alert(
        t('tripDetail.alert.error.title'),
        err instanceof Error ? err.message : t('tripDetail.alert.error.arrive'),
      );
    } finally {
      setActionLoading(false);
    }
  }, [trip, enqueueTransition, loadTrip]);

  // M11 — tap-to-retry for a `failed` transition badge: reset the sync_queue
  // row back to `pending` and kick a sync cycle immediately instead of
  // waiting for the next automatic trigger.
  const handleRetryTransition = useCallback(async () => {
    if (!transitionStatus) return;
    try {
      const db = await getDatabase();
      const syncQueueRepo = new SyncQueueRepo(db);
      await syncQueueRepo.retry(transitionStatus.id);
      await loadTrip();
      void triggerSync().catch(() => {});
    } catch (err) {
      mobileLogger.error('Trip detail: retry transition failed', {
        tripId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
    }
  }, [transitionStatus, loadTrip, triggerSync, tripId]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title={t('tripDetail.screenTitle.fallback')} onBack={() => router.back()} />
        <View style={styles.body}>
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>{t('tripDetail.loading.text')}</Text>
          </View>
        </View>
      </View>
    );
  }

  if (!trip) {
    return (
      <View style={styles.container}>
        <ScreenHeader title={t('tripDetail.screenTitle.fallback')} onBack={() => router.back()} />
        <View style={styles.body}>
          <View style={styles.centered}>
            <Text style={styles.errorText}>{t('tripDetail.error.notFound')}</Text>
            <BigButton
              title={t('tripDetail.button.back')}
              variant="outline"
              onPress={() => router.back()}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={trip.trip_number ?? t('tripDetail.screenTitle.fallback')}
        onBack={() => router.back()}
      />
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
              <Text style={styles.cardTitle}>{t('tripDetail.card.tripDetails')}</Text>
              <StatusPill status={trip.status} />
            </View>
            {/* FM-1 / M11: Show badge when a local transition is awaiting sync —
                status/onRetry reflect the real sync_queue row so a `failed`
                transition reads as actionable rather than "still pending". */}
            {trip.has_pending_transition === 1 && (
              <View style={styles.pendingBadgeRow}>
                <PendingTransitionBadge
                  status={transitionStatus?.status ?? 'pending'}
                  onRetry={
                    transitionStatus?.status === 'failed'
                      ? () => void handleRetryTransition()
                      : undefined
                  }
                />
              </View>
            )}

            {trip.trip_number && (
              <InfoRow label={t('tripDetail.infoRow.tripNumber')} value={trip.trip_number} />
            )}
            {myDriverTask?.parcelName ? (
              <InfoRow label={t('tripDetail.infoRow.parcel')} value={myDriverTask.parcelName} />
            ) : null}
            {loaderMachine?.machineCode ? (
              <InfoRow label={t('tripDetail.infoRow.loader')} value={loaderMachine.machineCode} />
            ) : null}
            {trip.destination_name && (
              <InfoRow label={t('tripDetail.infoRow.destination')} value={trip.destination_name} />
            )}
            {trip.destination_address && (
              <InfoRow label={t('tripDetail.infoRow.address')} value={trip.destination_address} />
            )}
            <InfoRow label={t('tripDetail.infoRow.bales')} value={String(trip.bale_count ?? 0)} />
            {trip.gross_weight_kg != null && (
              <InfoRow
                label={t('tripDetail.infoRow.grossWeight')}
                value={`${trip.gross_weight_kg} kg`}
              />
            )}
            {trip.departure_at && (
              <InfoRow
                label={t('tripDetail.infoRow.departedAt')}
                value={new Date(trip.departure_at).toLocaleString('ro-RO')}
              />
            )}
            {trip.arrival_at && (
              <InfoRow
                label={t('tripDetail.infoRow.arrivedAt')}
                value={new Date(trip.arrival_at).toLocaleString('ro-RO')}
              />
            )}
            {trip.delivered_at && (
              <InfoRow
                label={t('tripDetail.infoRow.deliveredAt')}
                value={new Date(trip.delivered_at).toLocaleString('ro-RO')}
              />
            )}
          </View>

          {/* Navigate to the destination depot in Google Maps */}
          {(trip.destination_id || trip.destination_name || trip.destination_address) && (
            <OpenMapsToDepotButton
              tripId={trip.id}
              destinationId={trip.destination_id}
              destinationName={trip.destination_name}
              destinationAddress={trip.destination_address}
            />
          )}

          {/* Navigate to the loader: live loader GPS (last 30 min) else loading field */}
          {(trip.loader_id || trip.source_parcel_id) && (
            <NavigateToLoaderButton
              tripId={trip.id}
              loaderMachineId={trip.loader_id}
              sourceParcelId={trip.source_parcel_id}
            />
          )}

          {/* Actions — only the driver runs the trip workflow */}
          {isDriver ? (
            <View style={styles.actionsSection}>
              <Text style={styles.sectionTitle}>{t('tripDetail.actions.sectionTitle')}</Text>

              {(trip.status === 'planned' || trip.status === 'loading') && (
                <View style={styles.waitingCard}>
                  <MaterialCommunityIcons name="timer-sand" size={20} color={colors.neutral} />
                  <Text style={styles.waitingText}>{t('tripDetail.actions.waitingForLoader')}</Text>
                </View>
              )}

              {trip.status === 'loaded' &&
                !trip.destination_name &&
                trip.destination_id == null && (
                  <ActionCard
                    title={t('tripDetail.actions.chooseDepot.title')}
                    subtitle={t('tripDetail.actions.chooseDepot.subtitle')}
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
                    title={t('tripDetail.actions.depart.title')}
                    subtitle={t('tripDetail.actions.depart.subtitle')}
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
                  title={t('tripDetail.actions.arrive.title')}
                  subtitle={t('tripDetail.actions.arrive.subtitle')}
                  icon={
                    <MaterialCommunityIcons name="map-marker" size={24} color={colors.primary} />
                  }
                  onPress={() => void handleArrive()}
                  disabled={actionLoading}
                  variant="active"
                />
              )}

              {(trip.status === 'arrived' ||
                trip.status === 'delivering' ||
                trip.status === 'delivered') && (
                <ActionCard
                  title={t('tripDetail.actions.delivery.title')}
                  subtitle={t('tripDetail.actions.delivery.subtitle')}
                  icon={
                    <MaterialCommunityIcons
                      name="arrow-down-bold"
                      size={24}
                      color={colors.primary}
                    />
                  }
                  onPress={() =>
                    router.push({
                      pathname: '/driver-ops/delivery-flow',
                      params: { tripId: trip.id },
                    })
                  }
                  variant="active"
                />
              )}

              {(trip.status === 'completed' || trip.status === 'cancelled') && (
                <View style={styles.doneCard}>
                  <Text style={styles.doneText}>
                    {trip.status === 'completed'
                      ? t('tripDetail.done.completed')
                      : t('tripDetail.done.cancelled')}
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.viewerCard}>
              <MaterialCommunityIcons name="eye-outline" size={20} color={colors.primary} />
              <Text style={styles.viewerText}>{t('tripDetail.viewer.text')}</Text>
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
        <View style={[styles.modalSheet, { paddingBottom: Math.max(24, insets.bottom) }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('tripDetail.modal.chooseDepot.title')}</Text>
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={12}>
              <MaterialCommunityIcons name="close" size={22} color={colors.neutral} />
            </Pressable>
          </View>
          {destinationsQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ padding: 24 }} />
          ) : destinationsQuery.error ? (
            <Text style={styles.modalError}>{t('tripDetail.modal.error.loadDepots')}</Text>
          ) : (
            <FlatList
              data={(destinationsQuery.data ?? []).filter((d) => d.isActive !== false)}
              keyExtractor={(d) => d.id}
              ItemSeparatorComponent={() => <View style={styles.modalDivider} />}
              ListEmptyComponent={
                <Text style={styles.modalEmpty}>{t('tripDetail.modal.empty.noActiveDepots')}</Text>
              }
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
                    <Text style={styles.modalRowTitle} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {(item as { address?: string | null }).address ? (
                      <Text style={styles.modalRowSub} numberOfLines={1}>
                        {(item as { address?: string | null }).address}
                      </Text>
                    ) : null}
                  </View>
                  {item.isDefault ? (
                    <View style={styles.defaultBadge}>
                      <Text style={styles.defaultBadgeText}>
                        {t('tripDetail.modal.defaultBadge')}
                      </Text>
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
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
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
    borderRadius: radii.md,
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
  pendingBadgeRow: {
    marginTop: -4,
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
    borderRadius: radii.md,
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
    borderRadius: radii.md,
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
    borderRadius: radii.md,
  },
  waitingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primary50,
    borderRadius: radii.md,
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
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
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
