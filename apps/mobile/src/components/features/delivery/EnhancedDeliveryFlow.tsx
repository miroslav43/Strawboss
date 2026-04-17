import { useState, useCallback } from 'react';
import { Alert, View, StyleSheet } from 'react-native';
import { WeightInput } from './WeightInput';
import { WeightTicketPhoto } from './WeightTicketPhoto';
import { SignatureStep } from './SignatureStep';
import { DeterioratedBalesInput } from './DeterioratedBalesInput';
import { CmrConfirmation } from './CmrConfirmation';
import { WhatsAppLink } from '@/components/shared/WhatsAppLink';
import { mobileApiClient } from '@/lib/api-client';
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

interface Signatures {
  driver?: string;
  receiver?: string;
  witness?: string;
}

interface ConfirmDeliveryPayload {
  netWeightKg: number;
  deterioratedBales: number;
  weightTicketPhotoUrl: string;
  receiverName: string;
  receiverSignatureUrl: string;
  deliveredAt: string;
}

type Step = 0 | 1 | 2 | 3 | 4;

export function EnhancedDeliveryFlow({
  tripId,
  tripNumber,
  baleCount,
  destinationName,
  receiverPhone,
  onComplete,
  // onCancel is part of the public prop contract but not consumed yet;
  // kept here so callers can keep wiring it up without breaking changes.
  onCancel: _onCancel,
}: EnhancedDeliveryFlowProps) {
  const [currentStep, setCurrentStep] = useState<Step>(0);
  const [netWeightValue, setNetWeightValue] = useState('');
  const [deterioratedBales, setDeterioratedBales] = useState(0);
  const [ticketPhotoUri, setTicketPhotoUri] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState('');
  const [signatures, setSignatures] = useState<Signatures>({});
  const [loading, setLoading] = useState(false);

  const netWeightKg = parseFloat(netWeightValue) || 0;
  const signatureUri = signatures.receiver ?? null;

  const goToStep = useCallback((step: Step) => {
    setCurrentStep(step);
  }, []);

  const handleSignatureSign = useCallback(
    (role: 'driver' | 'receiver' | 'witness', sig: string) => {
      setSignatures((prev) => ({ ...prev, [role]: sig }));
    },
    [],
  );

  const handleSignaturesComplete = useCallback(() => {
    const name = signatures.receiver
      ? 'Client semnat'
      : 'Client';
    setReceiverName(name);
    goToStep(4);
  }, [signatures.receiver, goToStep]);

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    mobileLogger.flow('Driver enhanced delivery: POST confirm-delivery', {
      tripId,
      tripNumber,
    });
    try {
      const payload: ConfirmDeliveryPayload = {
        netWeightKg,
        deterioratedBales,
        weightTicketPhotoUrl: ticketPhotoUri ?? '',
        receiverName,
        receiverSignatureUrl: signatureUri ?? '',
        deliveredAt: new Date().toISOString(),
      };
      await mobileApiClient.post(
        `/api/v1/trips/${tripId}/confirm-delivery`,
        payload,
      );
      mobileLogger.flow('Driver enhanced delivery: confirm-delivery success', {
        tripId,
      });
      onComplete();
    } catch (err) {
      mobileLogger.error('Driver enhanced delivery: confirm-delivery failed', {
        tripId,
        err:
          err instanceof Error
            ? { message: err.message, stack: err.stack }
            : err,
      });
      Alert.alert(
        'Eroare',
        err instanceof Error ? err.message : 'Nu s-a putut confirma livrarea.',
      );
    } finally {
      setLoading(false);
    }
  }, [
    netWeightKg,
    deterioratedBales,
    ticketPhotoUri,
    receiverName,
    signatureUri,
    tripId,
    tripNumber,
    onComplete,
  ]);

  switch (currentStep) {
    case 0:
      return (
        <View style={styles.stepContainer}>
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
        </View>
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
        />
      );

    case 3:
      return (
        <SignatureStep
          signatures={signatures}
          onSign={handleSignatureSign}
          onComplete={handleSignaturesComplete}
        />
      );

    case 4:
      return (
        <CmrConfirmation
          tripNumber={tripNumber}
          baleCount={baleCount}
          deterioratedBales={deterioratedBales}
          netWeightKg={netWeightKg}
          receiverName={receiverName}
          destinationName={destinationName}
          hasTicketPhoto={ticketPhotoUri !== null}
          hasSignature={signatureUri !== null}
          onConfirm={handleConfirm}
          onBack={() => goToStep(3)}
          loading={loading}
        />
      );
  }
}

const styles = StyleSheet.create({
  stepContainer: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  whatsappRow: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 4,
  },
});
