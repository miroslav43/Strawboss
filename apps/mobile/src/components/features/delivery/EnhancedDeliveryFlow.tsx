import { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { WeightInput } from './WeightInput';
import { WeightTicketPhoto } from './WeightTicketPhoto';
import { SignatureStep } from './SignatureStep';
import { DeterioratedBalesInput } from './DeterioratedBalesInput';
import { CmrConfirmation } from './CmrConfirmation';
import { WhatsAppLink } from '@/components/shared/WhatsAppLink';
import { mobileApiClient } from '@/lib/api-client';
import { uploadReceipt } from '@/lib/receiptUpload';
import { mobileLogger } from '@/lib/logger';

const BACKGROUND = '#F3DED8';

interface EnhancedDeliveryFlowProps {
  tripId: string;
  tripNumber: string;
  baleCount: number;
  destinationName: string;
  receiverPhone?: string;
  onComplete: () => void;
  onCancel: () => void;
}

type Step = 0 | 1 | 2 | 3 | 4;

const STEP_TITLES: Record<Step, string> = {
  0: 'Greutate',
  1: 'Baloți deteriorați',
  2: 'Bon de cântar',
  3: 'Semnătură primitor',
  4: 'Confirmare livrare',
};

/**
 * POST a trip transition, tolerating the "transition not allowed from status"
 * error — that means a previous (partially-failed) attempt already performed
 * this step. Any other error (validation, network) is rethrown.
 */
async function postTolerant(url: string, body: unknown): Promise<void> {
  try {
    await mobileApiClient.post(url, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not allowed from status/i.test(message)) return;
    throw err;
  }
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
  const [deterioratedBales, setDeterioratedBales] = useState(0);
  const [ticketPhotoUri, setTicketPhotoUri] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState('');
  const [receiverSignature, setReceiverSignature] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { modalProps, showModal, hideModal } = useModal();

  const grossWeightKg = parseFloat(netWeightValue) || 0;

  const goToStep = useCallback((step: Step) => {
    setCurrentStep(step);
  }, []);

  const handleHeaderBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => (s - 1) as Step);
    } else {
      onCancel();
    }
  }, [currentStep, onCancel]);

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    mobileLogger.flow('Driver delivery: confirming', { tripId, tripNumber });
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

      // The state machine requires: arrived → delivering → delivered → completed.
      // start-delivery / confirm-delivery are tolerant so a retry after a
      // partial failure does not crash on an already-done step.
      await postTolerant(`/api/v1/trips/${tripId}/start-delivery`, {});
      await postTolerant(`/api/v1/trips/${tripId}/confirm-delivery`, {
        grossWeightKg,
        deterioratedBalesCount: deterioratedBales,
        weightTicketPhotoUrl: ticketUrl,
      });
      // complete is strict — real errors (e.g. missing data) surface here.
      await mobileApiClient.post(`/api/v1/trips/${tripId}/complete`, {
        receiverName: receiverName.trim(),
        receiverSignature: receiverSignature ?? '',
      });

      mobileLogger.flow('Driver delivery: completed', { tripId });
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
    deterioratedBales,
    ticketPhotoUri,
    receiverName,
    receiverSignature,
    tripId,
    tripNumber,
    onComplete,
    showModal,
    hideModal,
  ]);

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
              onConfirm={() => goToStep(1)}
            />
          </>
        );
      case 1:
        return (
          <DeterioratedBalesInput
            baleCount={deterioratedBales}
            onBaleCountChange={setDeterioratedBales}
            totalBales={baleCount}
            onNext={() => goToStep(2)}
            onBack={() => goToStep(0)}
          />
        );
      case 2:
        return (
          <WeightTicketPhoto
            onCapture={(uri) => {
              setTicketPhotoUri(uri);
              goToStep(3);
            }}
            onSkip={() => {
              setTicketPhotoUri(null);
              goToStep(3);
            }}
          />
        );
      case 3:
        return (
          <SignatureStep
            receiverName={receiverName}
            onReceiverNameChange={setReceiverName}
            receiverSignature={receiverSignature}
            onSign={setReceiverSignature}
            onComplete={() => goToStep(4)}
          />
        );
      case 4:
        return (
          <CmrConfirmation
            tripNumber={tripNumber}
            baleCount={baleCount}
            deterioratedBales={deterioratedBales}
            netWeightKg={grossWeightKg}
            receiverName={receiverName}
            destinationName={destinationName}
            hasTicketPhoto={ticketPhotoUri !== null}
            hasSignature={receiverSignature !== null}
            onConfirm={handleConfirm}
            onBack={() => goToStep(3)}
            loading={loading}
          />
        );
    }
  };

  return (
    <View style={styles.flow}>
      <ScreenHeader title={STEP_TITLES[currentStep]} onBack={handleHeaderBack} />
      <View style={styles.body}>{renderStep()}</View>
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
});
