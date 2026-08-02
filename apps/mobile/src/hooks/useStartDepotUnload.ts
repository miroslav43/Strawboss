import { useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import { useI18n } from '@/lib/i18n';
import { useDepotAction } from '@/hooks/useDepotAction';
import type { DepotIncomingTruck } from '@/hooks/useDepotInventory';

type ShowModal = (params: {
  type: 'error' | 'warning' | 'success' | 'confirm';
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}) => void;

/**
 * Step 1 of the manned-depot flow, with its override dialogue.
 *
 * Shared by the Inventar home tab and the Curse list so the two cannot drift —
 * an operator who can start a truck from one screen and not the other is exactly
 * the kind of inconsistency that gets read as "the app is broken".
 *
 * The override is a second, explicit tap. The first attempt always goes without
 * it, so a truck whose GPS is fine is verified normally and nothing gets flagged;
 * only a genuine refusal offers "confirmă oricum", and taking it stamps
 * `location_unverified` and raises an alert for admin review.
 */
export function useStartDepotUnload(args: {
  depotId: string | null;
  showModal: ShowModal;
  hideModal: () => void;
}) {
  const { depotId, showModal, hideModal } = args;
  const { t } = useI18n();
  const depotAction = useDepotAction();

  return useCallback(
    async (truck: DepotIncomingTruck) => {
      const send = async (locationUnverified: boolean) => {
        const res = await depotAction({
          tripId: truck.tripId,
          transition: 'start-depot-unload',
          body: {},
          offlineStatus: 'delivering',
          offlineFields: { depot_unload_started_at: new Date().toISOString() },
          locationUnverified,
          depotId,
        });

        if (res.ok) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return;
        }

        if (res.canOverride) {
          showModal({
            type: 'warning',
            title: t('depositTrips.overrideTitle'),
            message:
              res.distanceM != null
                ? t('depositTrips.overrideMessageDistance', {
                    distance: Math.round(res.distanceM),
                  })
                : t('depositTrips.overrideMessageNoGps'),
            confirmText: t('depositTrips.overrideConfirm'),
            cancelText: t('common.cancel'),
            onConfirm: () => {
              hideModal();
              void send(true);
            },
            onCancel: hideModal,
          });
          return;
        }

        showModal({
          type: 'error',
          title: t('depositTrips.startFailedTitle'),
          message: res.message ?? t('depositTrips.startFailedMessage'),
          onConfirm: hideModal,
        });
      };

      await send(false);
    },
    [depotAction, depotId, showModal, hideModal, t],
  );
}
