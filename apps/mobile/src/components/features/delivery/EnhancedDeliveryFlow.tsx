import { useState, useCallback, useRef, useEffect } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { PendingTransitionBadge } from '@/components/shared/PendingTransitionBadge';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { StepIndicator } from '@/components/ui/StepIndicator';
import { WeightInput } from './WeightInput';
import { WeightTicketPhoto } from './WeightTicketPhoto';
import { SignatureStep } from './SignatureStep';
import { CmrConfirmation } from './CmrConfirmation';
import { WhatsAppLink } from '@/components/shared/WhatsAppLink';
import { uploadReceipt } from '@/lib/receiptUpload';
import { uploadSignature } from '@/lib/signatureUpload';
import { mobileLogger } from '@/lib/logger';
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
  destinationName: string;
  receiverPhone?: string;
  onComplete: () => void;
  onCancel: () => void;
}

type Step = 0 | 1 | 2 | 3;

const TOTAL_STEPS = 4;
const LAST_STEP: Step = 3;

const STEP_TITLES: Record<Step, string> = {
  0: 'Greutate',
  1: 'Bon de cântar',
  2: 'Semnătură primitor',
  3: 'Confirmare livrare',
};

/**
 * FM-1: Delivery draft — persisted to SQLite so the flow can resume after a crash.
 */
interface DeliveryDraft {
  netWeightValue: string;
  ticketPhotoUri: string | null;
  ticketUrl: string | null;
  receiverName: string;
  receiverSignature: string | null;
}

/**
 * FM-1: Enqueue a single trip transition to the sync queue.
 * Idempotency key: `trip_transition_${tripId}_${transition}` — stable across
 * retries, so a crash between two transitions doesn't create duplicate entries.
 *
 * Uses `enqueueOrUpdate` (not `enqueue`): the key is stable, so re-running the
 * confirm flow — after a resumed draft, a retry, or a server-reverted optimistic
 * status — must NOT hit the `idempotency_key` UNIQUE constraint. A plain INSERT
 * would throw "UNIQUE constraint failed" and leave the driver unable to finish
 * the delivery. enqueueOrUpdate refreshes a pending/failed row and leaves an
 * in-flight/completed one untouched (already sent), which is exactly the
 * idempotent behaviour we want here.
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
  destinationName,
  receiverPhone,
  onComplete,
  onCancel,
}: EnhancedDeliveryFlowProps) {
  const [currentStep, setCurrentStep] = useState<Step>(0);
  const [netWeightValue, setNetWeightValue] = useState('');
  const [ticketPhotoUri, setTicketPhotoUri] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState('');
  const [receiverSignature, setReceiverSignature] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const { modalProps, showModal, hideModal } = useModal();
  const slideAnim = useRef(new Animated.Value(0)).current;
  const prevStepRef = useRef<Step>(0);
  const { triggerSync } = useSync();
  const queryClient = useQueryClient();

  const grossWeightKg = parseFloat(netWeightValue) || 0;

  // FM-1: On mount, restore any persisted draft so the driver can resume.
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
          if (draft.netWeightValue != null) setNetWeightValue(draft.netWeightValue);
          if (draft.ticketPhotoUri != null) setTicketPhotoUri(draft.ticketPhotoUri);
          if (draft.receiverName != null) setReceiverName(draft.receiverName);
          if (draft.receiverSignature != null) setReceiverSignature(draft.receiverSignature);
          // Resume at the step after the last completed one, clamped to the
          // new total. Existing drafts written before the damaged-bales step
          // was removed may carry a step value of up to 4 — clamp to LAST_STEP.
          const resumeStep = Math.min(trip.delivery_step_progress + 1, LAST_STEP) as Step;
          setCurrentStep(resumeStep);
          prevStepRef.current = resumeStep;
          mobileLogger.flow('EnhancedDeliveryFlow: resumed from draft', {
            tripId,
            resumeStep,
          });
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

  /**
   * FM-1: Persist current draft to SQLite after each step advance so the
   * driver can resume if the app is killed before the final confirmation.
   */
  const persistDraft = useCallback(
    async (completedStep: number) => {
      const draft: DeliveryDraft = {
        netWeightValue,
        ticketPhotoUri,
        ticketUrl: null,
        receiverName,
        receiverSignature,
      };
      try {
        const db = await getDatabase();
        const tripsRepo = new TripsRepo(db);
        await tripsRepo.saveDeliveryDraft(tripId, completedStep, JSON.stringify(draft));
      } catch (err) {
        // Non-fatal — the flow continues; draft may not resume perfectly after crash.
        mobileLogger.warn('EnhancedDeliveryFlow: failed to persist draft', {
          tripId,
          completedStep,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [tripId, netWeightValue, ticketPhotoUri, receiverName, receiverSignature],
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
      // Upload the weigh-ticket photo (best-effort — empty URL if it fails).
      let ticketUrl = '';
      if (ticketPhotoUri) {
        try {
          const uploaded = await uploadReceipt(ticketPhotoUri, 'delivery');
          ticketUrl = uploaded.url;
        } catch {
          ticketUrl = '';
        }
      }

      // M9: Attempt binary upload of the receiver signature PNG before
      // enqueuing the transition.  Falls back to the raw base64 string if the
      // upload fails (offline / server error) — the backend accepts both.
      let receiverSignatureValue = receiverSignature ?? '';
      if (receiverSignature) {
        try {
          receiverSignatureValue = await uploadSignature(receiverSignature, 'receiver');
          mobileLogger.flow('EnhancedDeliveryFlow: receiver signature uploaded as binary', {
            tripId,
          });
        } catch {
          // Offline or upload error — fall back to base64 (backward-compatible).
          mobileLogger.info(
            'EnhancedDeliveryFlow: signature binary upload failed, falling back to base64',
            { tripId },
          );
        }
      }

      // FM-1: Apply transitions optimistically in local SQLite, then enqueue each.
      // Order matters — start-delivery → confirm-delivery → complete.
      // Idempotency keys are stable so retrying is safe.
      const db = await getDatabase();
      const tripsRepo = new TripsRepo(db);

      // 1. start-delivery: arrived → delivering
      await tripsRepo.applyTransitionLocally(tripId, 'delivering');
      await enqueueTripTransition(tripId, 'start-delivery', {});

      // 2. confirm-delivery: delivering → delivered
      await tripsRepo.applyTransitionLocally(tripId, 'delivered', {
        gross_weight_kg: grossWeightKg,
        delivered_at: new Date().toISOString(),
      });
      await enqueueTripTransition(tripId, 'confirm-delivery', {
        grossWeightKg,
        deterioratedBalesCount: null,
        weightTicketPhotoUrl: ticketUrl,
      });

      // 3. complete: delivered → completed
      await tripsRepo.applyTransitionLocally(tripId, 'completed', {
        receiver_name: receiverName.trim(),
        completed_at: new Date().toISOString(),
      });
      await enqueueTripTransition(tripId, 'complete', {
        receiverName: receiverName.trim(),
        receiverSignature: receiverSignatureValue,
      });

      // FM-1: Clear the delivery draft — flow completed successfully.
      await tripsRepo.clearDeliveryDraft(tripId);

      mobileLogger.flow('Driver delivery: all transitions enqueued offline-first', { tripId });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Invalidate queries so the driver index list reflects the new status.
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      void queryClient.invalidateQueries({ queryKey: ['my-trips'] });
      void queryClient.invalidateQueries({ queryKey: ['trip-alert', tripId] });

      // Best-effort sync.
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
    ticketPhotoUri,
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
            {receiverPhone !== undefined && receiverPhone.length > 0 && (
              <View style={styles.whatsappRow}>
                <WhatsAppLink phone={receiverPhone} />
              </View>
            )}
            <WeightInput
              value={netWeightValue}
              onChange={setNetWeightValue}
              onConfirm={() => {
                void persistDraft(0);
                goToStep(1);
              }}
            />
          </>
        );
      case 1:
        return (
          <WeightTicketPhoto
            onCapture={(uri) => {
              setTicketPhotoUri(uri);
              void persistDraft(1);
              goToStep(2);
            }}
            onSkip={() => {
              setTicketPhotoUri(null);
              void persistDraft(1);
              goToStep(2);
            }}
          />
        );
      case 2:
        return (
          <SignatureStep
            receiverName={receiverName}
            onReceiverNameChange={setReceiverName}
            receiverSignature={receiverSignature}
            onSign={setReceiverSignature}
            onComplete={() => {
              void persistDraft(2);
              goToStep(3);
            }}
          />
        );
      case 3:
        return (
          <>
            <View style={styles.pendingBadgeRow}>
              <PendingTransitionBadge />
            </View>
            <CmrConfirmation
              tripNumber={tripNumber}
              baleCount={baleCount}
              netWeightKg={grossWeightKg}
              receiverName={receiverName}
              destinationName={destinationName}
              hasTicketPhoto={ticketPhotoUri !== null}
              hasSignature={receiverSignature !== null}
              onConfirm={handleConfirm}
              onBack={() => goToStep(2)}
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
  resumeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#A5D6A7',
  },
  resumeText: {
    fontSize: 13,
    color: '#2E7D32',
    flex: 1,
  },
});
