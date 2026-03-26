export interface ConflictInfo {
  table: string;
  recordId: string;
  localValue: unknown;
  serverValue: unknown;
  field: string;
}

/**
 * Resolve a field-level conflict between local and server values.
 *
 * Strategy: Field-level last-write-wins (LWW) with domain exceptions.
 * - Server always wins for status fields (authoritative state machine).
 * - Server always wins for aggregate counts (bale_count on trips).
 * - Server always wins for sync_version (monotonically increasing).
 * - Otherwise, default to server for safety.
 *
 * Future enhancement: compare updated_at timestamps for true LWW
 * on non-critical fields where local edits should be preserved.
 */
export function resolveConflict(conflict: ConflictInfo): 'local' | 'server' {
  // Server always wins for authoritative fields
  const serverWinsFields = [
    'status',
    'bale_count',
    'sync_version',
    'server_version',
    'completed_at',
    'cancelled_at',
    'cancellation_reason',
  ];

  if (serverWinsFields.includes(conflict.field)) {
    return 'server';
  }

  // Default to server for safety -- prevents data divergence
  return 'server';
}

/**
 * Apply conflict resolution to merge a server record with a local record.
 * Returns the merged record.
 */
export function mergeRecords(
  table: string,
  recordId: string,
  localRecord: Record<string, unknown>,
  serverRecord: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...localRecord };

  for (const [field, serverValue] of Object.entries(serverRecord)) {
    const localValue = localRecord[field];

    // If values are the same, no conflict
    if (JSON.stringify(localValue) === JSON.stringify(serverValue)) {
      continue;
    }

    const resolution = resolveConflict({
      table,
      recordId,
      localValue,
      serverValue,
      field,
    });

    if (resolution === 'server') {
      merged[field] = serverValue;
    }
    // 'local' keeps the existing value in merged
  }

  return merged;
}
