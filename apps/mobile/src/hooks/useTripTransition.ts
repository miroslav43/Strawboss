import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getDatabase } from '../lib/storage';
import { TripsRepo } from '../db/trips-repo';
import { SyncQueueRepo } from '../db/sync-queue-repo';
import { mobileLogger } from '../lib/logger';
import { useSync } from './useSync';
import type { TripTransitionPayload } from '../sync/push';

/**
 * Status-to-next-status map for the driver-facing transitions.
 * Mirrors the XState machine in @strawboss/domain without importing it
 * (domain is not in the mobile deps).  Only the driver transitions are
 * listed here; other transitions (loader, etc.) are not triggered from
 * the mobile client directly.
 */
const TRANSITION_TARGET: Record<string, string> = {
  depart: 'in_transit',
  arrive: 'arrived',
  'start-delivery': 'delivering',
  'confirm-delivery': 'delivered',
  complete: 'completed',
  'set-destination': '', // metadata-only, no status change
};

/**
 * Valid transitions per current trip status (driver perspective).
 * Used for local pre-validation before enqueueing.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  loaded: ['depart', 'set-destination'],
  in_transit: ['arrive'],
  arrived: ['start-delivery'],
  delivering: ['confirm-delivery'],
  delivered: ['complete'],
};

export interface EnqueueTransitionOptions {
  /** Trip UUID. */
  tripId: string;
  /** Current local status — used to validate the transition is legal. */
  currentStatus: string;
  /** Transition name matching the REST path segment (e.g. "depart", "arrive"). */
  transition: string;
  /** Body to send to the endpoint (weights, signatures, …). */
  body: Record<string, unknown>;
  /**
   * Local SQLite fields to optimistically update alongside the status change.
   * e.g. { departure_at: new Date().toISOString() }
   */
  localMeta?: Partial<import('../db/trips-repo').LocalTrip>;
}

export interface UseTripTransitionResult {
  enqueueTransition: (opts: EnqueueTransitionOptions) => Promise<void>;
}

/**
 * FM-1: Hook for offline-first driver trip transitions.
 *
 * Calling `enqueueTransition` will:
 *   1. Validate locally that the transition is legal for the current status.
 *   2. Apply the new status (and optional metadata) optimistically in SQLite.
 *   3. Enqueue a `trip_transition` entry in the sync queue.
 *   4. Trigger a debounced sync so the server is updated as soon as possible.
 *
 * The UI receives the updated local state immediately and shows a
 * "va fi trimis la reconectare" badge (has_pending_transition = 1) until
 * the sync cycle confirms the transition server-side.
 *
 * The idempotency key is derived from `tripId + transition` so that retrying
 * after a crash produces the same queue entry, not a duplicate.
 */
export function useTripTransition(): UseTripTransitionResult {
  const { triggerSync } = useSync();
  const queryClient = useQueryClient();

  const enqueueTransition = useCallback(
    async (opts: EnqueueTransitionOptions) => {
      const { tripId, currentStatus, transition, body, localMeta } = opts;

      // --- Local pre-validation -----------------------------------------------
      const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
      if (!allowed.includes(transition)) {
        const msg = `Tranziția "${transition}" nu este permisă din starea "${currentStatus}".`;
        mobileLogger.warn('useTripTransition: illegal transition attempted', {
          tripId,
          currentStatus,
          transition,
        });
        throw new Error(msg);
      }

      const newStatus = TRANSITION_TARGET[transition];

      // --- Optimistic local write ----------------------------------------------
      const db = await getDatabase();
      const tripsRepo = new TripsRepo(db);
      const syncQueueRepo = new SyncQueueRepo(db);

      if (newStatus) {
        await tripsRepo.applyTransitionLocally(tripId, newStatus, localMeta);
        mobileLogger.flow('useTripTransition: applied locally', {
          tripId,
          transition,
          newStatus,
        });
      } else if (localMeta) {
        // set-destination: no status change, just update metadata
        await tripsRepo.update(tripId, localMeta);
      }

      // --- Enqueue for sync ----------------------------------------------------
      const idempotencyKey = `trip_transition_${tripId}_${transition}`;
      const payload: TripTransitionPayload = { transition, tripId, body };

      // enqueueOrUpdate: if a previous attempt failed with bad data (e.g. wrong
      // weight), an operator-side retry should supersede the queued payload
      // instead of colliding with the UNIQUE idempotency_key constraint.
      await syncQueueRepo.enqueueOrUpdate({
        entityType: 'trip_transition',
        entityId: tripId,
        action: 'update',
        payload,
        idempotencyKey,
      });

      mobileLogger.flow('useTripTransition: enqueued', {
        tripId,
        transition,
        idempotencyKey,
      });

      // Invalidate local queries so the UI re-reads from SQLite immediately.
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      void queryClient.invalidateQueries({ queryKey: ['my-trips'] });
      void queryClient.invalidateQueries({ queryKey: ['trip-alert', tripId] });

      // Best-effort sync — do not await, caller's UI should already be updated.
      void triggerSync().catch(() => {});
    },
    [triggerSync, queryClient],
  );

  return { enqueueTransition };
}
