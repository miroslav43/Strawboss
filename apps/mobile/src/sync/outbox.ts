export interface OutboxEntry {
  entityType: string;
  entityId: string;
  action: string;
  payload: unknown;
  idempotencyKey: string;
}

/**
 * Create an outbox entry for the sync queue.
 * Each entry gets a unique idempotency key to prevent duplicate processing.
 */
export function createOutboxEntry(
  entityType: string,
  entityId: string,
  action: string,
  payload: unknown,
): OutboxEntry {
  return {
    entityType,
    entityId,
    action,
    payload,
    idempotencyKey: generateUUID(),
  };
}

/**
 * Simple UUID v4 generator.
 * Uses Math.random -- sufficient for idempotency keys on mobile.
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
