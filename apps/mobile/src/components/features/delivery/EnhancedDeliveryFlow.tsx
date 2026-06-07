import { useState, useCallback, useRef, useEffect } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useDeliveryDestinations } from '@strawboss/api';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { PendingTransitionBadge } from '@/components/shared/PendingTransitionBadge';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { StepIndicator } from '@/components/ui/StepIndicator';
import { WeightInput } from './WeightInput';
import { SignatureStep } from './SignatureStep';
import { CmrConfirmation } from './CmrConfirmation';
import { WhatsAppLink } from '@/components/shared/WhatsAppLink';
import { uploadSignature } from '@/lib/signatureUpload';
import { mobileLogger } from '@/lib/logger';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import { TripsRepo } from '@/db/trips-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { useSync } from '@/hooks/useSync';
import { useQueryClient } from '@tanstack/react-query';
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
  onComplete: () => void;
  onCancel: () => void;
}

type Step = 0 | 1 | 2;

const TOTAL_STEPS = 3;
const LAST_STEP: Step = 2;

const STEP_TITLES: Record<Step, string> = {
  0: 'Cântărire',
  1: 'Semnătură primitor',
  2: 'Confirmare livrare',
};

/** Delivery draft — persisted to SQLite so the flow can resume after a crash. */
interface DeliveryDraft {
  grossWeightValue: string;
  tareWeightValue: string;
  receiverSignature: string | null;
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
  onComplete,
  onCancel,
}: EnhancedDeliveryFlowProps) {
  const [currentStep, setCurrentStep] = useState<Step>(0);
  const [grossWeightValue, setGrossWeightValue] = useState('');
  const [tareWeightValue, setTareWeightValue] = useState('');
  const [receiverSignature, setReceiverSignature] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const { modalProps, showModal, hideModal } = useModal();
  const slideAnim = useRef(new Animated.Value(0)).current;
  const prevStepRef = useRef<Step>(0);
  const { triggerSync } = useSync();
  const queryClient = useQueryClient();

  // Receiver = the depot's contact person. Resolve from the destinations list;
  // fall back to the depot name so `complete` always has a non-empty name.
  const { data: depots } = useDeliveryDestinations(mobileApiClient);
  const depot = destinationId ? (depots ?? []).find((d) => d.id === destinationId) : undefined;
  const receiverName = (depot?.contactName?.trim() || destinationName || 'Primitor').trim();
  const contactPhone = depot?.contactPhone ?? undefined;

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
          if (draft.receiverSignature != null) setReceiverSignature(draft.receiverSignature);
          // Resume after the last completed step, clamped to the new total
          // (older drafts may carry a higher step from the previous flow).
          const resumeStep = Math.min(trip.delivery_step_progress + 1, LAST_STEP) as Step;
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
        receiverSignature,
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
    [tripId, grossWeightValue, tareWeightValue, receiverSignature],
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
      // Upload the receiver signature PNG (falls back to base64 on failure).
      let receiverSignatureValue = receiverSignature ?? '';
      if (receiverSignature) {
        try {
          receiverSignatureValue = await uploadSignature(receiverSignature, 'receiver');
        } catch {
          mobileLogger.info('EnhancedDeliveryFlow: signature upload failed, using base64', {
            tripId,
          });
        }
      }

      const db = await getDatabase();
      const tripsRepo = new TripsRepo(db);

      // start-delivery: arrived → delivering
      await tripsRepo.applyTransitionLocally(tripId, 'delivering');
      await enqueueTripTransition(tripId, 'start-delivery', {});

      // confirm-delivery: delivering → delivered (gross + tare; net = gross - tare server-side)
      await tripsRepo.applyTransitionLocally(tripId, 'delivered', {
        gross_weight_kg: grossWeightKg,
        tare_weight_kg: tareWeightKg,
        delivered_at: new Date().toISOString(),
      });
      await enqueueTripTransition(tripId, 'confirm-delivery', {
        grossWeightKg,
        tareWeightKg,
        deterioratedBalesCount: null,
      });

      // complete: delivered → completed (receiver = depot contact, signature only)
      await tripsRepo.applyTransitionLocally(tripId, 'completed', {
        receiver_name: receiverName,
        completed_at: new Date().toISOString(),
      });
      await enqueueTripTransition(tripId, 'complete', {
        receiverName,
        receiverSignature: receiverSignatureValue,
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
        title: 'Eroare',
        message: err instanceof Error ? err.message : 'Nu s-a putut confirma livrarea.',
        onConfirm: hideModal,
      });
    } finally {
      setLoading(false);
    }
  }, [
    grossWeightKg,
    tareWeightKg,
    receiverName,
    receiverSignature,
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

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <>
            {contactPhone ? (
              <View style={styles.whatsappRow}>
                <WhatsAppLink phone={contactPhone} />
              </View>
            ) : null}
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
          </>
        );
      case 1:
        return (
          <SignatureStep
            receiverName={receiverName}
            receiverSignature={receiverSignature}
            onSign={setReceiverSignature}
            onComplete={() => {
              void persistDraft(1);
              goToStep(2);
            }}
          />
        );
      case 2:
        return (
          <>
            <View style={styles.pendingBadgeRow}>
              <PendingTransitionBadge />
            </View>
            <CmrConfirmation
              tripNumber={tripNumber}
              baleCount={baleCount}
              grossWeightKg={grossWeightKg}
              tareWeightKg={tareWeightKg}
              netWeightKg={netWeightKg}
              receiverName={receiverName}
              destinationName={destinationName}
              destinationAddress={destinationAddress}
              hasSignature={receiverSignature !== null}
              onConfirm={handleConfirm}
              onBack={() => goToStep(1)}
              loading={loading}
            />
          </>
        );
    }
  };

  return (
    <View style={styles.flow}>
      <ScreenHeader title={STEP_TITLES[currentStep]} onBack={handleHeaderBack} />
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
  whatsappRow: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 4,
  },
  pendingBadgeRow: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 4,
  },
});
