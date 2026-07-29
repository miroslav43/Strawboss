import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useI18n } from '@/lib/i18n';
import { BigButton } from '@/components/ui/BigButton';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { PendingTransitionBadge } from '@/components/shared/PendingTransitionBadge';
import { ConfirmCountdown } from '@/components/shared/ConfirmCountdown';
import { mobileLogger } from '@/lib/logger';
import { colors } from '@strawboss/ui-tokens';
import { useTripTransition } from '@/hooks/useTripTransition';
import { getDatabase } from '@/lib/storage';
import { TripsRepo } from '@/db/trips-repo';

/**
 * Departure flow — the driver explicitly confirms the trip has departed (a 3s
 * countdown gate, not a signature — the backend hasn't collected a driver
 * signature since `departSchema` was emptied out). Trip distance is derived
 * from the GPS track between depart and arrive, so no odometer is collected.
 */
export default function DepartureFlowScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const { t } = useI18n();

  const [submitting, setSubmitting] = useState(false);
  const [pendingSync, setPendingSync] = useState(false);
  // FM-6: countdown state
  const [countdownVisible, setCountdownVisible] = useState(false);

  const { enqueueTransition } = useTripTransition();

  const handleConfirmDeparture = useCallback(() => {
    setCountdownVisible(true);
  }, []);

  const handleCountdownCancel = useCallback(() => {
    setCountdownVisible(false);
  }, []);

  // Actual depart logic — runs after countdown expires (FM-6).
  const executeDepart = useCallback(async () => {
    setCountdownVisible(false);
    if (!tripId) return;
    setSubmitting(true);
    try {
      // Read current local trip status for pre-validation.
      const db = await getDatabase();
      const tripsRepo = new TripsRepo(db);
      const trip = await tripsRepo.findById(tripId);
      const currentStatus = trip?.status ?? 'loaded';

      await enqueueTransition({
        tripId,
        currentStatus,
        transition: 'depart',
        body: {},
        localMeta: {
          departure_at: new Date().toISOString(),
        },
      });

      mobileLogger.flow('DepartureFlow: depart enqueued offline-first', { tripId });
      setPendingSync(true);

      // Navigate immediately — the local state is already updated.
      router.replace(`/trip/${tripId}`);
    } catch (err) {
      mobileLogger.error('DepartureFlow: depart failed', {
        tripId,
        err: err instanceof Error ? err.message : String(err),
      });
      Alert.alert(
        t('departureFlow.alert.error.title'),
        err instanceof Error ? err.message : t('departureFlow.alert.error.message'),
      );
    } finally {
      setSubmitting(false);
    }
  }, [tripId, enqueueTransition]);

  return (
    <View style={styles.outer}>
      <ScreenHeader title={t('departureFlow.screenTitle')} />
      <ScrollView style={[styles.body, { flex: 1 }]} contentContainerStyle={styles.content}>
        {pendingSync && (
          <View style={styles.badgeRow}>
            <PendingTransitionBadge />
          </View>
        )}
        <Text style={styles.hintText}>{t('departureFlow.hint')}</Text>
        <BigButton
          title={t('departureFlow.button.confirmDeparture')}
          onPress={handleConfirmDeparture}
          disabled={submitting}
        />
        {submitting ? null : (
          <BigButton
            title={t('departureFlow.button.cancel')}
            onPress={() => router.back()}
            variant="outline"
          />
        )}
      </ScrollView>
      {/* FM-6: countdown overlay — shown after the driver confirms */}
      <ConfirmCountdown
        visible={countdownVisible}
        actionLabel={t('departureFlow.countdown.actionLabel')}
        countdownSeconds={3}
        onConfirmed={() => void executeDepart()}
        onCancel={handleCountdownCancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: colors.primary },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  badgeRow: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  hintText: { fontSize: 14, color: '#5D4037', paddingHorizontal: 16, paddingBottom: 8 },
  content: { padding: 16, gap: 12 },
});
