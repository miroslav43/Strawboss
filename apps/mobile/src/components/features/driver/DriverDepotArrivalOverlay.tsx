import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { ConfirmCountdown } from '@/components/shared/ConfirmCountdown';
import { useDriverDepotArrival } from '@/hooks/useDriverDepotArrival';
import { useTripTransition } from '@/hooks/useTripTransition';
import { mobileLogger } from '@/lib/logger';
import { useI18n } from '@/lib/i18n';

/**
 * Client-side fallback for the depot-arrival countdown (mounted in the driver
 * layout). Shows the same 10s auto-confirm countdown as the push-driven
 * `deposit_entry` overlay, but driven by local GPS presence so it appears even
 * when the server push was missed (app backgrounded / not delivered) or already
 * consumed (edge-triggered enter recorded earlier).
 *
 * `suppressed` is true while the push-driven overlay is already showing, so the
 * two paths never stack into a double countdown.
 */
export function DriverDepotArrivalOverlay({ suppressed }: { suppressed: boolean }) {
  const { t } = useI18n();
  const arrival = useDriverDepotArrival();
  const { enqueueTransition } = useTripTransition();
  // GPS presence is level-triggered; once the driver confirms or cancels for a
  // trip, don't re-prompt for that same trip (otherwise it would loop while
  // parked inside the depot).
  const [handledTripId, setHandledTripId] = useState<string | null>(null);

  const active = !!arrival && !suppressed && arrival.tripId !== handledTripId;

  const handleConfirmed = useCallback(() => {
    if (!arrival) return;
    const tripId = arrival.tripId;
    setHandledTripId(tripId);
    void (async () => {
      try {
        await enqueueTransition({
          tripId,
          currentStatus: 'in_transit',
          transition: 'arrive',
          body: {},
          localMeta: { arrival_at: new Date().toISOString() },
        });
        mobileLogger.flow('DriverDepotArrival: arrive enqueued (client GPS)', { tripId });
        router.push(`/trip/${tripId}`);
      } catch (err) {
        mobileLogger.error('DriverDepotArrival: arrive failed', {
          tripId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [arrival, enqueueTransition]);

  const handleCancel = useCallback(() => {
    if (arrival) setHandledTripId(arrival.tripId);
  }, [arrival]);

  return (
    <ConfirmCountdown
      visible={active}
      actionLabel={t('driver.depotArrivalOverlay.actionLabel')}
      countdownSeconds={10}
      confirmLabel={t('driver.depotArrivalOverlay.confirmLabel')}
      onConfirmed={handleConfirmed}
      onCancel={handleCancel}
    />
  );
}
