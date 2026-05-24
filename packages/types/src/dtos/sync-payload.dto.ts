export interface SyncMutation {
  table: string;
  recordId: string;
  action: "insert" | "update" | "delete";
  data: Record<string, unknown>;
  clientId: string;
  clientVersion: number;
  idempotencyKey: string;
}

export interface SyncPushRequest {
  mutations: SyncMutation[];
}

export interface SyncPullRequest {
  tables: Record<string, number>;
}

export interface SyncResult {
  table: string;
  recordId: string;
  status: "applied" | "conflict" | "skipped" | "failed";
  serverVersion: number;
  data: Record<string, unknown> | null;
  /** Optional human-readable error, present when status === "failed". */
  error?: string;
}

/**
 * Soft-delete tombstone the server emits when a row was deleted (deleted_at IS NOT NULL).
 * Mobile clients translate each entry into a local `DELETE FROM <table> WHERE id = ?`
 * so the offline cache converges with the server.
 */
export interface SyncTombstone {
  table: string;
  recordId: string;
  serverVersion: number;
  /** ISO timestamp; informational only — clients only need (table, recordId). */
  deletedAt: string;
}

export interface SyncResponse {
  results: SyncResult[];
  serverTime: string;
  /**
   * Present only when the client advertised the `tombstones-v1` capability
   * via the `X-Sync-Caps` request header. Older clients (no header) receive
   * the legacy response without this field and continue to behave as before.
   */
  deletions?: SyncTombstone[];
}
