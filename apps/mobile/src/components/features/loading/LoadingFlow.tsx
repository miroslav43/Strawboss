import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { QRScanner } from '../../shared/QRScanner';
import { BaleCountInput } from './BaleCountInput';
import { LoadConfirmation } from './LoadConfirmation';
import { getDatabase } from '@/lib/storage';
import { TripsRepo } from '@/db/trips-repo';
import { OperationsRepo } from '@/db/operations-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { mobileLogger } from '@/lib/logger';

interface LoadingFlowProps {
  tripId: string;
  onComplete: () => void;
}

type LoadingStep = 'scan' | 'count' | 'confirm';

export function LoadingFlow({ tripId, onComplete }: LoadingFlowProps) {
  const [step, setStep] = useState<LoadingStep>('scan');
  const [machineData, setMachineData] = useState<string | null>(null);
  const [baleCount, setBaleCount] = useState('');

  const handleConfirm = useCallback(async () => {
    const count = parseInt(baleCount, 10);
    mobileLogger.flow('Loading flow: completing load', {
      tripId,
      baleCount: count,
    });
    try {
      const db = await getDatabase();
      const tripsRepo = new TripsRepo(db);
      const opsRepo = new OperationsRepo(db);
      const syncQueue = new SyncQueueRepo(db);

      const operationId = `op_load_${tripId}`;

      await opsRepo.create({
        id: operationId,
        type: 'loading',
        tripId,
        machineId: machineData ?? undefined,
      });

      await opsRepo.update(operationId, {
        status: 'completed',
        bale_count: count,
      });

      await tripsRepo.update(tripId, {
        status: 'loaded',
        bale_count: count,
        loading_completed_at: new Date().toISOString(),
      });

      await syncQueue.enqueue({
        entityType: 'trip',
        entityId: tripId,
        action: 'update_status',
        payload: {
          status: 'loaded',
          bale_count: count,
          machine_code: machineData,
          loading_completed_at: new Date().toISOString(),
        },
        idempotencyKey: `load_${tripId}`,
      });

      mobileLogger.flow('Loading flow: saved and sync enqueued', { tripId });
      onComplete();
    } catch (err) {
      mobileLogger.error('Loading flow: save failed', {
        tripId,
        err:
          err instanceof Error
            ? { message: err.message, stack: err.stack }
            : err,
      });
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to save loading data',
      );
    }
  }, [tripId, baleCount, machineData, onComplete]);

  switch (step) {
    case 'scan':
      return (
        <QRScanner
          onScan={(data) => {
            setMachineData(data);
            setStep('count');
          }}
          instruction="Scan machine QR code"
        />
      );
    case 'count':
      return (
        <BaleCountInput
          value={baleCount}
          onChange={setBaleCount}
          onConfirm={() => setStep('confirm')}
        />
      );
    case 'confirm':
      return (
        <LoadConfirmation
          baleCount={parseInt(baleCount, 10)}
          machineCode={machineData ?? 'Unknown'}
          onConfirm={handleConfirm}
          onBack={() => setStep('count')}
        />
      );
  }
}
