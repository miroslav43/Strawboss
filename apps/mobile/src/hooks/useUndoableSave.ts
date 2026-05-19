import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '@/lib/storage';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { mobileLogger } from '@/lib/logger';

export interface UndoRecord {
  /** The UUID of the locally-created entity. */
  entityId: string;
  /** The idempotency key used when the entry was enqueued (e.g. `bale_productions_<id>`). */
  idempotencyKey: string;
  /** Human-readable label shown in the toast (e.g. "Înregistrat — 42 baloți"). */
  label: string;
}

export interface UndoToastState {
  /** Whether the toast should be visible. */
  visible: boolean;
  /** The label to display. */
  label: string;
  /** Remaining seconds on the countdown (for display only). */
  secondsLeft: number;
  /** Whether the sync queue entry is still pending (undo is still possible). */
  canUndo: boolean;
  /** Call this to execute the undo. */
  onUndo: () => void;
}

interface UseUndoableSaveOptions {
  /** How many seconds to show the undo toast (default: 5). */
  durationSeconds?: number;
  /**
   * Called with the entity id to delete from its repo.
   * The hook itself handles the sync queue deletion.
   */
  onDeleteLocal: (entityId: string) => Promise<void>;
  /**
   * Optional: called after a successful undo so the caller can refresh
   * query caches, reset UI state, etc.
   */
  onUndone?: (entityId: string) => void;
}

/**
 * FM-4 — Undo de 5 secunde pe înregistrări.
 *
 * After `showUndo()` is called the component renders a toast via `toastState`.
 * The toast stays visible for `durationSeconds`. While the sync queue entry
 * is still `pending`, the user can tap "Anulează" to delete both the local
 * SQLite row and the queue entry atomically. If the entry is already
 * in_flight or completed, `canUndo` flips to false and the button is
 * disabled/hidden.
 */
export function useUndoableSave({
  durationSeconds = 5,
  onDeleteLocal,
  onUndone,
}: UseUndoableSaveOptions) {
  const [toastState, setToastState] = useState<UndoToastState>({
    visible: false,
    label: '',
    secondsLeft: durationSeconds,
    canUndo: false,
    onUndo: () => {},
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRecordRef = useRef<UndoRecord | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const dismiss = useCallback(() => {
    clearTimers();
    currentRecordRef.current = null;
    setToastState((prev) => ({ ...prev, visible: false }));
  }, [clearTimers]);

  const handleUndo = useCallback(async () => {
    const record = currentRecordRef.current;
    if (!record) return;

    clearTimers();

    try {
      const db = await getDatabase();
      const syncQueue = new SyncQueueRepo(db);

      // Delete queue entry first — if still pending; if not, abort.
      const deleted = await syncQueue.deletePendingEntry(record.idempotencyKey);
      if (!deleted) {
        // Already dispatched — undo not possible.
        mobileLogger.warn('useUndoableSave: undo skipped — entry no longer pending', {
          idempotencyKey: record.idempotencyKey,
        });
        dismiss();
        return;
      }

      // Delete the local SQLite row via the caller-supplied callback.
      await onDeleteLocal(record.entityId);

      mobileLogger.flow('useUndoableSave: undo successful', {
        entityId: record.entityId,
        idempotencyKey: record.idempotencyKey,
      });

      onUndone?.(record.entityId);
    } catch (err) {
      mobileLogger.error('useUndoableSave: undo failed', {
        entityId: record?.entityId,
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      dismiss();
    }
  }, [clearTimers, onDeleteLocal, onUndone, dismiss]);

  /**
   * Show the undo toast for `record`. Call this immediately after a
   * successful local write + enqueue.
   */
  const showUndo = useCallback(
    (record: UndoRecord) => {
      clearTimers();
      currentRecordRef.current = record;

      setToastState({
        visible: true,
        label: record.label,
        secondsLeft: durationSeconds,
        canUndo: true,
        onUndo: () => void handleUndo(),
      });

      // Countdown tick every second
      let remaining = durationSeconds;
      timerRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearTimers();
          setToastState((prev) => ({ ...prev, visible: false }));
          currentRecordRef.current = null;
          return;
        }

        // Re-check whether entry is still pending so the button stays accurate
        void (async () => {
          try {
            const db = await getDatabase();
            const syncQueue = new SyncQueueRepo(db);
            const still = await syncQueue.isEntryPending(record.idempotencyKey);
            setToastState((prev) => ({
              ...prev,
              secondsLeft: remaining,
              canUndo: still,
            }));
          } catch {
            setToastState((prev) => ({ ...prev, secondsLeft: remaining }));
          }
        })();
      }, 1000);
    },
    [durationSeconds, clearTimers, handleUndo],
  );

  return { showUndo, toastState, dismissUndo: dismiss };
}
