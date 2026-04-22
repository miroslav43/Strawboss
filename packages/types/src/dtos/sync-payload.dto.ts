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

export interface SyncResponse {
  results: SyncResult[];
  serverTime: string;
}
