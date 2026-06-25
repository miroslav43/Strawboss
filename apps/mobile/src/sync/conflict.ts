export interface ConflictInfo {
  table: string;
  recordId: string;
  localValue: unknown;
  serverValue: unknown;
  field: string;
}

/**
 * FM-3: Structured result from resolveConflict — which value wins and whether
 * the field had a meaningful divergence the user should be notified about.
 */
export interface ConflictResolution {
  winner: 'local' | 'server';
  /** True when the server overwrote a non-null local value with a different value. */
  diverged: boolean;
}

/**
 * Fields that are editable by the user on-device and whose overwrite is worth
 * notifying about (FM-3). Only fields where user input is meaningful.
 */
const USER_EDITABLE_FIELDS: ReadonlySet<string> = new Set([
  'bale_count',
  'parcel_id',
  'notes',
  'gross_weight_kg',
  'tare_weight_kg',
  'quantity',
  'quantity_liters',
  'avg_bale_weight_kg',
]);

/**
 * Fields where the local value should be kept when local is strictly newer
 * (comparing updated_at timestamps). Applied only for text/notes fields.
 */
const LWW_BY_TIMESTAMP_FIELDS: ReadonlySet<string> = new Set(['notes']);

/** Coerce a value to a finite number, or null if it isn't numeric. */
function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Numeric-aware equality. The API serializes Postgres NUMERIC columns as STRINGS
 * (e.g. "50.00") while the matching local SQLite REAL columns read back as NUMBERS
 * (50). A raw JSON.stringify compare therefore treated equal values (50 vs "50.00")
 * as a perpetual conflict — spamming a "server overwrote your value" notification on
 * EVERY sync. Compare numerically when both sides are numeric; else structurally.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const na = asFiniteNumber(a);
  const nb = asFiniteNumber(b);
  if (na !== null && nb !== null) return na === nb;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Resolve a field-level conflict between local and server values.
 *
 * Strategy: Field-level last-write-wins (LWW) with domain exceptions.
 * - Server always wins for status fields (authoritative state machine).
 * - Server always wins for aggregate counts & sync_version.
 * - For `notes` (text edited by user): compare updated_at; keep newer.
 * - Otherwise: server wins, but we record whether divergence occurred.
 *
 * Returns both the winner and a `diverged` flag used by FM-3 notifications.
 */
export function resolveConflict(
  conflict: ConflictInfo,
  localUpdatedAt?: string,
  serverUpdatedAt?: string,
): ConflictResolution {
  // Server always wins for authoritative state-machine / version fields.
  const serverWinsFields = [
    'status',
    'bale_count',
    'sync_version',
    'server_version',
    'completed_at',
    'cancelled_at',
    'cancellation_reason',
    'has_pending_transition',
    'delivery_step_progress',
    'delivery_draft_json',
    'acknowledged_at',
  ];

  if (serverWinsFields.includes(conflict.field)) {
    // bale_count is user-relevant — flag divergence so UI can notify.
    const diverged =
      conflict.field === 'bale_count' &&
      conflict.localValue != null &&
      conflict.serverValue != null &&
      !valuesEqual(conflict.localValue, conflict.serverValue);
    return { winner: 'server', diverged };
  }

  // For text fields with user-authored content (e.g. `notes`): if we have
  // updated_at timestamps, keep whichever was written most recently.
  if (LWW_BY_TIMESTAMP_FIELDS.has(conflict.field) && localUpdatedAt && serverUpdatedAt) {
    const localTs = Date.parse(localUpdatedAt);
    const serverTs = Date.parse(serverUpdatedAt);
    if (!isNaN(localTs) && !isNaN(serverTs) && localTs > serverTs) {
      return { winner: 'local', diverged: false };
    }
  }

  // For all user-editable fields, the server wins but we flag divergence.
  const diverged =
    USER_EDITABLE_FIELDS.has(conflict.field) &&
    conflict.localValue != null &&
    conflict.serverValue != null &&
    !valuesEqual(conflict.localValue, conflict.serverValue);

  return { winner: 'server', diverged };
}

/**
 * FM-3: A single field where the server value overwrote a user-entered local value.
 */
export interface DivergentField {
  field: string;
  localValue: unknown;
  serverValue: unknown;
}

/**
 * Apply conflict resolution to merge a server record with a local record.
 * Returns the merged record AND the list of fields where the server overwrote
 * a non-trivial local value (used by FM-3 to emit notifications).
 */
export function mergeRecords(
  table: string,
  recordId: string,
  localRecord: Record<string, unknown>,
  serverRecord: Record<string, unknown>,
): { merged: Record<string, unknown>; divergentFields: DivergentField[] } {
  const merged: Record<string, unknown> = { ...localRecord };
  const divergentFields: DivergentField[] = [];

  const localUpdatedAt =
    typeof localRecord['updated_at'] === 'string' ? localRecord['updated_at'] : undefined;
  const serverUpdatedAt =
    typeof serverRecord['updated_at'] === 'string' ? serverRecord['updated_at'] : undefined;

  for (const [field, serverValue] of Object.entries(serverRecord)) {
    const localValue = localRecord[field];

    // If values are equal (numeric-aware — the API sends NUMERIC as strings while
    // the local SQLite column stores a REAL number), there is no conflict.
    if (valuesEqual(localValue, serverValue)) {
      continue;
    }

    const resolution = resolveConflict(
      { table, recordId, localValue, serverValue, field },
      localUpdatedAt,
      serverUpdatedAt,
    );

    if (resolution.winner === 'server') {
      merged[field] = serverValue;
      if (resolution.diverged) {
        divergentFields.push({ field, localValue, serverValue });
      }
    }
    // 'local' keeps the existing value in merged
  }

  return { merged, divergentFields };
}
