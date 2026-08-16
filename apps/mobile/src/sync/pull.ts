import type { ApiClient } from '@strawboss/api';
import type { SyncPullRequest, SyncResponse, SyncResult, SyncTombstone } from '@strawboss/types';

export interface PullResult {
  count: number;
  errors: string[];
  updates: SyncResult[];
  /** Tombstones for soft-deleted rows. Empty when the server didn't emit them. */
  deletions: SyncTombstone[];
  serverTime: string | null;
  /**
   * The organization's current season, when the server reports one.
   *
   * Null both for an older backend and for an organization that has never
   * closed a season — the phone treats the two identically and does nothing,
   * which is the correct behaviour for both.
   */
  activeSeasonYear: number | null;
}

/**
 * Pull delta updates from the server.
 * Sends the last known version for each table and receives new/updated records.
 * When the server includes a `deletions[]` array (gated by the `X-Sync-Caps`
 * header on the request), we forward it so the SyncManager can delete the
 * matching local rows.
 */
export async function pullUpdates(
  lastVersions: Record<string, number>,
  apiClient: ApiClient,
): Promise<PullResult> {
  try {
    const request: SyncPullRequest = { tables: lastVersions };
    const response = await apiClient.post<SyncResponse>('/api/v1/sync/pull', request);

    return {
      count: response.results.length,
      errors: [],
      updates: response.results,
      deletions: response.deletions ?? [],
      serverTime: response.serverTime,
      activeSeasonYear: response.activeSeasonYear ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pull failed';
    return {
      count: 0,
      errors: [message],
      updates: [],
      deletions: [],
      serverTime: null,
      activeSeasonYear: null,
    };
  }
}
