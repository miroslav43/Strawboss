import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@strawboss/api';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import { TripsRepo } from '@/db/trips-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { mobileLogger } from '@/lib/logger';
import { generateUuid } from '@/lib/uuid';
import { useSync } from '@/hooks/useSync';
import type { TripTransitionPayload } from '@/sync/push';

/**
 * The two depot-operator transitions, submitted the same way.
 *
 * **Online-first, queue only as a fallback** — the same shape `register_load`
 * uses. The previous flow always went through the sync queue and optimistically
 * wrote `completed` locally, so a server rejection (`outside_geofence`,
 * `gps_stale`, `no_destination`) left the operator looking at a green tick over a
 * trip that never closed, while the entry retried forever and the driver stayed
 * stuck on his waiting screen. Going straight to the server puts the real error —
 * including the distance and radius — in front of the person who can act on it,
 * and the override exists precisely so he can.
 *
 * Offline still works: the write is queued and applied locally, exactly as before.
 */

export type DepotTransition = 'start-depot-unload' | 'confirm-depot-delivery';

export interface DepotActionResult {
  ok: boolean;
  /** Machine-readable server code, when the server refused. */
  errorCode?: string;
  message?: string;
  /** Present on `outside_geofence`. */
  distanceM?: number;
  radiusM?: number;
  /** The server says this refusal can be retried with locationUnverified. */
  canOverride?: boolean;
  /** True when the write was parked in the sync queue instead of sent. */
  queued?: boolean;
}

/** Server codes that mean "your GPS evidence is missing", not "your data is wrong". */
const GEOFENCE_CODES = new Set(['gps_stale', 'outside_geofence']);

function readApiError(err: unknown): {
  code?: string;
  message?: string;
  distanceM?: number;
  radiusM?: number;
  canOverride?: boolean;
} {
  if (!(err instanceof ApiError)) return {};
  const data = (err.data ?? {}) as Record<string, unknown>;
  return {
    code: typeof data.error === 'string' ? data.error : undefined,
    message: typeof data.message === 'string' ? data.message : err.message,
    distanceM: typeof data.distanceM === 'number' ? data.distanceM : undefined,
    radiusM: typeof data.radiusM === 'number' ? data.radiusM : undefined,
    canOverride: data.canOverride === true,
  };
}

/**
 * A network fault (timeout / no connectivity) is the ONLY thing that may fall
 * back to the queue. A 4xx is the server saying no — queueing it would just
 * reproduce the silent-divergence bug through a different door.
 */
function isOffline(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0;
}

export function useDepotAction() {
  const queryClient = useQueryClient();
  const { triggerSync } = useSync();

  return useCallback(
    async (args: {
      tripId: string;
      transition: DepotTransition;
      body: Record<string, unknown>;
      /** Optimistic local status when the write has to be queued offline. */
      offlineStatus: 'delivering' | 'completed';
      offlineFields?: Record<string, string | number | null>;
      locationUnverified?: boolean;
      depotId?: string | null;
    }): Promise<DepotActionResult> => {
      const { tripId, transition, offlineStatus, depotId } = args;
      const idempotencyKey = generateUuid();
      const body: Record<string, unknown> = { ...args.body, idempotencyKey };
      if (args.locationUnverified) body.locationUnverified = true;

      const invalidate = () => {
        void queryClient.invalidateQueries({ queryKey: ['trips'] });
        void queryClient.invalidateQueries({ queryKey: ['my-trips'] });
        void queryClient.invalidateQueries({ queryKey: ['deposit-inventory'] });
        if (depotId) {
          void queryClient.invalidateQueries({ queryKey: ['deposit-inventory', depotId] });
        }
      };

      try {
        await mobileApiClient.post(`/api/v1/trips/${tripId}/${transition}`, body);
        mobileLogger.flow('DepotAction: applied online', { tripId, transition });
        invalidate();
        // Pull the authoritative row back rather than guessing it locally.
        void triggerSync().catch(() => {});
        return { ok: true };
      } catch (err) {
        const parsed = readApiError(err);

        if (!isOffline(err)) {
          mobileLogger.warn('DepotAction: server refused', {
            tripId,
            transition,
            code: parsed.code,
          });
          return {
            ok: false,
            errorCode: parsed.code,
            message: parsed.message,
            distanceM: parsed.distanceM,
            radiusM: parsed.radiusM,
            // The server marks a refusal overridable; a geofence code without the
            // flag (an unlinked trip) is deliberately final.
            canOverride: parsed.canOverride === true && GEOFENCE_CODES.has(parsed.code ?? ''),
          };
        }

        // Genuinely offline — queue it and mirror the result locally.
        try {
          const db = await getDatabase();
          const tripsRepo = new TripsRepo(db);
          const syncQueueRepo = new SyncQueueRepo(db);
          const payload: TripTransitionPayload = { transition, tripId, body };
          // One entry per (trip, transition): a correct-and-resubmit supersedes
          // the pending row instead of appending a second one.
          await syncQueueRepo.enqueueOrUpdate({
            entityType: 'trip_transition',
            entityId: tripId,
            action: 'update',
            payload,
            idempotencyKey: `${transition}::${tripId}`,
          });
          await tripsRepo.applyTransitionLocally(tripId, offlineStatus, args.offlineFields ?? {});
          mobileLogger.flow('DepotAction: queued offline', { tripId, transition });
          invalidate();
          return { ok: true, queued: true };
        } catch (queueErr) {
          mobileLogger.error('DepotAction: could not queue', {
            tripId,
            transition,
            err: queueErr instanceof Error ? { message: queueErr.message } : queueErr,
          });
          return { ok: false, message: parsed.message };
        }
      }
    },
    [queryClient, triggerSync],
  );
}
