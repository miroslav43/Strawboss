import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { dateLocaleFor, useI18n } from '@/lib/i18n';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDeliveryDestinations } from '@strawboss/api';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import {
  PendingTransitionBadge,
  type PendingTransitionStatus,
} from '@/components/shared/PendingTransitionBadge';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { StepIndicator } from '@/components/ui/StepIndicator';
import { WeightInput } from './WeightInput';
import { CmrConfirmation } from './CmrConfirmation';
import { mobileLogger } from '@/lib/logger';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import { TripsRepo } from '@/db/trips-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { useSync } from '@/hooks/useSync';
import { useQueryClient } from '@tanstack/react-query';
import { colors } from '@strawboss/ui-tokens';
import type { TripTransitionPayload } from '@/sync/push';

const BACKGROUND = '#F3DED8';
const SCREEN_WIDTH = Dimensions.get('window').width;

interface EnhancedDeliveryFlowProps {
  tripId: string;
  tripNumber: string;
  baleCount: number;
  destinationId?: string | null;
  destinationName: string;
  destinationAddress?: string | null;
  /**
   * Plan C: when truthy, the destination depot has an assigned operator who
   * will confirm the delivery from their side. The driver must NOT submit
   * weights or a signature — the UI switches to a read-only waiting state.
   */
  destinationHasOperator?: boolean;
  /** Confirmed bale count from the depot operator (shown in the completed state). */
  depotConfirmedBaleCount?: number | null;
  /** Set once the operator pressed "Începe descărcarea" — drives the middle state. */
  depotUnloadStartedAt?: string | null;
  /** Who is unloading, so the driver can chase them instead of guessing. */
  depotOperatorName?: string | null;
  depotOperatorPhone?: string | null;
  onComplete: () => void;
  onCancel: () => void;
}

// Receiver signature step was removed entirely (see EnhancedDeliveryFlow's
// git history) — a failed signature upload used to strand the trip forever
// retrying an unfixable "Invalid signature URL" error in the sync queue.
// Weighing now goes straight to the CMR confirmation.
type Step = 0 | 1;

const TOTAL_STEPS = 2;
const LAST_STEP: Step = 1;

const STEP_TITLE_KEYS: Record<Step, string> = {
  0: 'delivery.enhancedFlow.step.weighing',
  1: 'delivery.enhancedFlow.step.confirmation',
};

/** Delivery draft — persisted to SQLite so the flow can resume after a crash. */
interface DeliveryDraft {
  grossWeightValue: string;
  tareWeightValue: string;
  /** Driver chose "Livrează fără cântărire" — depot scale is unavailable. */
  scaleBroken?: boolean;
}

/**
 * Enqueue a single trip transition. Uses `enqueueOrUpdate` (stable idempotency
 * key) so re-running the confirm flow can't hit the UNIQUE constraint.
 */
async function enqueueTripTransition(
  tripId: string,
  transition: string,
  body: Record<string, unknown>,
): Promise<void> {
  const db = await getDatabase();
  const syncQueueRepo = new SyncQueueRepo(db);
  const payload: TripTransitionPayload = { transition, tripId, body };
  await syncQueueRepo.enqueueOrUpdate({
    entityType: 'trip_transition',
    entityId: tripId,
    action: 'update',
    payload,
    idempotencyKey: `trip_transition_${tripId}_${transition}`,
  });
}

export function EnhancedDeliveryFlow({
  tripId,
  tripNumber,
  baleCount,
  destinationId,
  destinationName,
  destinationAddress,
  destinationHasOperator = false,
  depotConfirmedBaleCount,
  depotUnloadStartedAt,
  depotOperatorName,
  depotOperatorPhone,
  onComplete,
  onCancel,
}: EnhancedDeliveryFlowProps) {
  const [currentStep, setCurrentStep] = useState<Step>(0);
  const [grossWeightValue, setGrossWeightValue] = useState('');
  const [tareWeightValue, setTareWeightValue] = useState('');
  const [scaleBroken, setScaleBroken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  // M11 — real sync_queue status for this trip's pending transition (e.g. a
  // resumed-after-failure delivery), so the confirm step's badge distinguishes
  // `failed` (needs a tap to retry) from `pending`/`in_flight`.
  const [transitionStatus, setTransitionStatus] = useState<{
    id: number;
    status: PendingTransitionStatus;
  } | null>(null);
  const { modalProps, showModal, hideModal } = useModal();
  const slideAnim = useRef(new Animated.Value(0)).current;
  const prevStepRef = useRef<Step>(0);
  const { triggerSync } = useSync();
  const queryClient = useQueryClient();

  // Receiver = the depot's contact person. Resolve from the destinations list;
  // fall back to the depot name so `complete` always has a non-empty name.
  const { t, locale } = useI18n();
  const { data: depots } = useDeliveryDestinations(mobileApiClient);
  const depot = destinationId ? (depots ?? []).find((d) => d.id === destinationId) : undefined;
  const receiverName = (
    depot?.contactName?.trim() ||
    destinationName ||
    t('delivery.enhancedFlow.receiverFallback')
  ).trim();

  const grossWeightKg = parseFloat(grossWeightValue) || 0;
  const tareWeightKg = parseFloat(tareWeightValue) || 0;
  const netWeightKg = Math.max(0, grossWeightKg - tareWeightKg);

  // On mount, restore any persisted draft so the driver can resume.
  useEffect(() => {
    void (async () => {
      try {
        const db = await getDatabase();
        const tripsRepo = new TripsRepo(db);
        const trip = await tripsRepo.findById(tripId);
        if (
          trip?.delivery_draft_json &&
          trip.delivery_step_progress != null &&
          trip.delivery_step_progress >= 0
        ) {
          const draft = JSON.parse(trip.delivery_draft_json) as Partial<DeliveryDraft>;
          if (draft.grossWeightValue != null) setGrossWeightValue(draft.grossWeightValue);
          if (draft.tareWeightValue != null) setTareWeightValue(draft.tareWeightValue);
          if (draft.scaleBroken != null) setScaleBroken(draft.scaleBroken);
          // Resume after the last completed step, clamped to the new total.
          // Pre-redesign drafts (single weight + photo) carry no gross/tare — if
          // weight data is missing, force step 0 so the driver re-enters it
          // instead of landing on the confirm step with 0 kg.
          const hasWeightData = draft.grossWeightValue != null || draft.tareWeightValue != null;
          const resumeStep = (
            hasWeightData ? Math.min(trip.delivery_step_progress + 1, LAST_STEP) : 0
          ) as Step;
          setCurrentStep(resumeStep);
          prevStepRef.current = resumeStep;
          mobileLogger.flow('EnhancedDeliveryFlow: resumed from draft', { tripId, resumeStep });
        }
      } catch (err) {
        mobileLogger.warn('EnhancedDeliveryFlow: failed to restore draft', {
          tripId,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setDraftLoaded(true);
      }
    })();
  }, [tripId]);

  const persistDraft = useCallback(
    async (completedStep: number) => {
      const draft: DeliveryDraft = {
        grossWeightValue,
        tareWeightValue,
        scaleBroken,
      };
      try {
        const db = await getDatabase();
        const tripsRepo = new TripsRepo(db);
        await tripsRepo.saveDeliveryDraft(tripId, completedStep, JSON.stringify(draft));
      } catch (err) {
        mobileLogger.warn('EnhancedDeliveryFlow: failed to persist draft', {
          tripId,
          completedStep,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [tripId, grossWeightValue, tareWeightValue, scaleBroken],
  );

  const goToStep = useCallback(
    (step: Step) => {
      const forward = step >= prevStepRef.current;
      slideAnim.setValue(forward ? SCREEN_WIDTH : -SCREEN_WIDTH);
      setCurrentStep(step);
      prevStepRef.current = step;
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    },
    [slideAnim],
  );

  // Depot has no working scale — skip weighing entirely (mirrors the depot
  // operator's own "scaleBroken" confirm path, see confirmDepotDeliverySchema).
  const handleDeliverWithoutWeighing = useCallback(() => {
    showModal({
      type: 'confirm',
      title: t('delivery.enhancedFlow.deliverWithoutWeighing.confirmTitle'),
      message: t('delivery.enhancedFlow.deliverWithoutWeighing.confirmMessage'),
      confirmText: t('delivery.enhancedFlow.deliverWithoutWeighing.confirmAction'),
      onConfirm: () => {
        hideModal();
        setScaleBroken(true);
        setGrossWeightValue('');
        setTareWeightValue('');
        void persistDraft(0);
        goToStep(1);
      },
      onCancel: hideModal,
    });
  }, [showModal, hideModal, t, persistDraft, goToStep]);

  // M11 — refresh the real transition status whenever the confirm step is
  // shown (covers resuming a delivery whose previous confirm attempt failed).
  const refreshTransitionStatus = useCallback(async () => {
    try {
      const db = await getDatabase();
      const syncQueueRepo = new SyncQueueRepo(db);
      setTransitionStatus(await syncQueueRepo.getTransitionStatusForTrip(tripId));
    } catch {
      // Non-critical — badge falls back to the default `pending` look.
    }
  }, [tripId]);

  useEffect(() => {
    if (currentStep === LAST_STEP) {
      void refreshTransitionStatus();
    }
  }, [currentStep, refreshTransitionStatus]);

  const handleRetryTransition = useCallback(async () => {
    if (!transitionStatus) return;
    try {
      const db = await getDatabase();
      const syncQueueRepo = new SyncQueueRepo(db);
      await syncQueueRepo.retry(transitionStatus.id);
      await refreshTransitionStatus();
      void triggerSync().catch(() => {});
    } catch (err) {
      mobileLogger.error('EnhancedDeliveryFlow: retry transition failed', {
        tripId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
    }
  }, [transitionStatus, refreshTransitionStatus, triggerSync, tripId]);

  const handleHeaderBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => (s - 1) as Step);
    } else {
      onCancel();
    }
  }, [currentStep, onCancel]);

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    mobileLogger.flow('Driver delivery: confirming offline-first', { tripId, tripNumber });
    try {
      const db = await getDatabase();
      const tripsRepo = new TripsRepo(db);

      // start-delivery: arrived → delivering
      await tripsRepo.applyTransitionLocally(tripId, 'delivering');
      await enqueueTripTransition(tripId, 'start-delivery', {});

      // confirm-delivery: delivering → delivered (gross + tare; net = gross - tare server-side).
      // scaleBroken (depot has no working scale) keeps both weights NULL.
      await tripsRepo.applyTransitionLocally(tripId, 'delivered', {
        gross_weight_kg: scaleBroken ? null : grossWeightKg,
        tare_weight_kg: scaleBroken ? null : tareWeightKg,
        scale_broken: scaleBroken ? 1 : 0,
        delivered_at: new Date().toISOString(),
      });
      await enqueueTripTransition(tripId, 'confirm-delivery', {
        grossWeightKg: scaleBroken ? null : grossWeightKg,
        tareWeightKg: scaleBroken ? null : tareWeightKg,
        deterioratedBalesCount: null,
        scaleBroken,
      });

      // complete: delivered → completed (receiver = depot contact, no signature)
      await tripsRepo.applyTransitionLocally(tripId, 'completed', {
        receiver_name: receiverName,
        completed_at: new Date().toISOString(),
      });
      await enqueueTripTransition(tripId, 'complete', {
        receiverName,
      });

      await tripsRepo.clearDeliveryDraft(tripId);

      mobileLogger.flow('Driver delivery: all transitions enqueued offline-first', { tripId });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      void queryClient.invalidateQueries({ queryKey: ['my-trips'] });
      void queryClient.invalidateQueries({ queryKey: ['trip-alert', tripId] });

      void triggerSync().catch(() => {});

      onComplete();
    } catch (err) {
      mobileLogger.error('Driver delivery: confirmation failed', {
        tripId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      showModal({
        type: 'error',
        title: t('delivery.enhancedFlow.error.title'),
        message:
          err instanceof Error ? err.message : t('delivery.enhancedFlow.error.confirmFailed'),
        onConfirm: hideModal,
      });
    } finally {
      setLoading(false);
    }
  }, [
    grossWeightKg,
    tareWeightKg,
    scaleBroken,
    receiverName,
    tripId,
    tripNumber,
    onComplete,
    triggerSync,
    queryClient,
    showModal,
    hideModal,
  ]);

  // Don't render until draft restoration is complete (avoids step flicker).
  if (!draftLoaded) return null;

  /*
   * Plan C: when the destination has an assigned depot operator, the driver must
   * not enter weights or sign — confirmation comes from the operator's side.
   *
   * Three states, not two. This screen used to be a mute hourglass that flipped
   * straight to "confirmed": from the cab there was no way to tell whether the
   * operator had seen the truck, was mid-unload, or had gone home. It now tracks
   * the operator's actual progress and, while waiting, offers the one thing a
   * stuck driver actually needs — a way to ring the person at the ramp.
   */
  if (destinationHasOperator) {
    const isConfirmed = depotConfirmedBaleCount != null && depotConfirmedBaleCount > 0;
    const isUnloading = !isConfirmed && depotUnloadStartedAt != null;
    const startedAtLabel = depotUnloadStartedAt
      ? new Date(depotUnloadStartedAt).toLocaleTimeString(dateLocaleFor(locale), {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

    const icon = isConfirmed ? 'check-circle' : isUnloading ? 'forklift' : 'clock-outline';
    const iconColor = isConfirmed ? colors.primary : isUnloading ? '#1D4ED8' : '#B7791F';
    const title = isConfirmed
      ? t('delivery.enhancedFlow.operatorWait.confirmedTitle')
      : isUnloading
        ? t('delivery.enhancedFlow.operatorWait.unloadingTitle')
        : t('delivery.enhancedFlow.operatorWait.pendingTitle');
    const subtitle = isConfirmed
      ? t('delivery.enhancedFlow.operatorWait.confirmedSubtitle').replace(
          '{count}',
          String(depotConfirmedBaleCount),
        )
      : isUnloading && startedAtLabel
        ? t('delivery.enhancedFlow.operatorWait.unloadingSubtitle', { time: startedAtLabel })
        : t('delivery.enhancedFlow.operatorWait.pendingSubtitle');

    return (
      <View style={styles.flow}>
        <ScreenHeader title={t('delivery.enhancedFlow.operatorWait.title')} onBack={onCancel} />
        <View style={styles.operatorWaitBody}>
          <MaterialCommunityIcons name={icon} size={64} color={iconColor} />
          <Text style={styles.operatorWaitTitle}>{title}</Text>
          <Text style={styles.operatorWaitSubtitle}>{subtitle}</Text>

          {isConfirmed ? (
            <View style={styles.operatorConfirmedRow}>
              <MaterialCommunityIcons name="grain" size={20} color={colors.primary} />
              <Text style={styles.operatorConfirmedValue}>{depotConfirmedBaleCount} baloți</Text>
              <Text style={styles.operatorConfirmedLabel}>
                {t('delivery.enhancedFlow.operatorWait.confirmedByDepot')}
              </Text>
            </View>
          ) : depotOperatorName ? (
            <View style={styles.operatorContactCard}>
              <MaterialCommunityIcons name="account-hard-hat" size={20} color={colors.primary} />
              <Text style={styles.operatorContactName} numberOfLines={1}>
                {depotOperatorName}
              </Text>
              {depotOperatorPhone ? (
                <TouchableOpacity
                  style={styles.operatorCallButton}
                  onPress={() => {
                    void Linking.openURL(`tel:${depotOperatorPhone}`).catch(() => {});
                  }}
                >
                  <MaterialCommunityIcons name="phone" size={16} color="#FFFFFF" />
                  <Text style={styles.operatorCallText}>
                    {t('delivery.enhancedFlow.operatorWait.callOperator')}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>
        <AppModal {...modalProps} />
      </View>
    );
  }

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <ScrollView
            style={styles.stepScroll}
            contentContainerStyle={styles.stepScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.skipWeighingRow}>
              <TouchableOpacity
                style={styles.skipWeighingButton}
                activeOpacity={0.7}
                onPress={handleDeliverWithoutWeighing}
                accessibilityRole="button"
                accessibilityLabel={t('delivery.enhancedFlow.deliverWithoutWeighing.action')}
              >
                <MaterialCommunityIcons name="scale-off" size={20} color={colors.white} />
                <Text style={styles.skipWeighingLabel}>
                  {t('delivery.enhancedFlow.deliverWithoutWeighing.action')}
                </Text>
              </TouchableOpacity>
            </View>
            <WeightInput
              grossValue={grossWeightValue}
              onGrossChange={setGrossWeightValue}
              tareValue={tareWeightValue}
              onTareChange={setTareWeightValue}
              onConfirm={() => {
                void persistDraft(0);
                goToStep(1);
              }}
            />
          </ScrollView>
        );
      case 1:
        return (
          <>
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
            <CmrConfirmation
              tripNumber={tripNumber}
              baleCount={baleCount}
              grossWeightKg={grossWeightKg}
              tareWeightKg={tareWeightKg}
              netWeightKg={netWeightKg}
              scaleBroken={scaleBroken}
              receiverName={receiverName}
              destinationName={destinationName}
              destinationAddress={destinationAddress}
              onConfirm={handleConfirm}
              onBack={() => goToStep(0)}
              loading={loading}
            />
          </>
        );
    }
  };

  return (
    <View style={styles.flow}>
      <ScreenHeader title={t(STEP_TITLE_KEYS[currentStep])} onBack={handleHeaderBack} />
      <StepIndicator totalSteps={TOTAL_STEPS} currentStep={currentStep} />
      <Animated.View style={[styles.body, { transform: [{ translateX: slideAnim }] }]}>
        {renderStep()}
      </Animated.View>
      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  flow: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  body: {
    flex: 1,
  },
  stepScroll: {
    flex: 1,
  },
  stepScrollContent: {
    flexGrow: 1,
  },
  skipWeighingRow: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 4,
  },
  skipWeighingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B7791F',
    borderRadius: 12,
    height: 48,
    gap: 8,
    paddingHorizontal: 16,
  },
  skipWeighingLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },
  pendingBadgeRow: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 4,
  },
  // Plan C: destination_has_operator read-only waiting state
  operatorWaitBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  operatorWaitTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    textAlign: 'center',
  },
  operatorWaitSubtitle: {
    fontSize: 14,
    color: '#5D4037',
    textAlign: 'center',
    lineHeight: 20,
  },
  operatorConfirmedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    marginTop: 8,
  },
  operatorConfirmedValue: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.primary,
  },
  operatorContactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  operatorContactName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#374151' },
  operatorCallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0A5C36',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  operatorCallText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  operatorConfirmedLabel: {
    fontSize: 13,
    color: '#5D4037',
  },
});
