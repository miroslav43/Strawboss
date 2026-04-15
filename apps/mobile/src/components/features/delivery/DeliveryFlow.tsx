import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { WeightInput } from './WeightInput';
import { WeightTicketPhoto } from './WeightTicketPhoto';
import { SignatureStep } from './SignatureStep';
import { getDatabase } from '@/lib/storage';
import { TripsRepo } from '@/db/trips-repo';
import { OperationsRepo } from '@/db/operations-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { mobileLogger } from '@/lib/logger';

interface DeliveryFlowProps {
  tripId: string;
  onComplete: () => void;
}

type DeliveryStep = 'weight' | 'photo' | 'signatures';

interface Signatures {
  driver?: string;
  receiver?: string;
  witness?: string;
}

export function DeliveryFlow({ tripId, onComplete }: DeliveryFlowProps) {
  const [step, setStep] = useState<DeliveryStep>('weight');
  const [weight, setWeight] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<Signatures>({});

  const handleComplete = useCallback(async () => {
    const grossWeight = parseFloat(weight);
    mobileLogger.flow('Delivery flow: completing local delivery', {
      tripId,
      grossWeightKg: grossWeight,
    });
    try {
      const db = await getDatabase();
      const tripsRepo = new TripsRepo(db);
      const opsRepo = new OperationsRepo(db);
      const syncQueue = new SyncQueueRepo(db);

      const operationId = `op_deliver_${tripId}_${Date.now()}`;

      await opsRepo.create({
        id: operationId,
        type: 'delivery',
        tripId,
      });

      await opsRepo.update(operationId, {
        status: 'completed',
        weight_kg: grossWeight,
        photo_uri: photoUri,
        signatures: JSON.stringify(signatures),
      });

      await tripsRepo.update(tripId, {
        status: 'delivered',
        gross_weight_kg: grossWeight,
        delivered_at: new Date().toISOString(),
      });

      await syncQueue.enqueue({
        entityType: 'trip',
        entityId: tripId,
        action: 'update_status',
        payload: {
          status: 'delivered',
          gross_weight_kg: grossWeight,
          photo_uri: photoUri,
          signatures,
          delivered_at: new Date().toISOString(),
        },
        idempotencyKey: `deliver_${tripId}_${Date.now()}`,
      });

      mobileLogger.flow('Delivery flow: saved and sync enqueued', { tripId });
      onComplete();
    } catch (err) {
      mobileLogger.error('Delivery flow: save failed', {
        tripId,
        err:
          err instanceof Error
            ? { message: err.message, stack: err.stack }
            : err,
      });
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to save delivery data',
      );
    }
  }, [tripId, weight, photoUri, signatures, onComplete]);

  switch (step) {
    case 'weight':
      return (
        <WeightInput
          value={weight}
          onChange={setWeight}
          onConfirm={() => setStep('photo')}
        />
      );
    case 'photo':
      return (
        <WeightTicketPhoto
          onCapture={(uri) => {
            setPhotoUri(uri);
            setStep('signatures');
          }}
        />
      );
    case 'signatures':
      return (
        <SignatureStep
          signatures={signatures}
          onSign={(role, sig) =>
            setSignatures((prev) => ({ ...prev, [role]: sig }))
          }
          onComplete={handleComplete}
        />
      );
  }
}
