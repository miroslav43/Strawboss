/**
 * Lightweight persisted timestamps for the self-health report. Written at the
 * success points of check-in / heartbeat / sync so the diagnostic can show how
 * fresh each subsystem is (and why a device looks offline). Best-effort: every
 * read/write is guarded so it never affects the path it's instrumenting.
 */
import * as SecureStore from 'expo-secure-store';

const KEY_LAST_CHECKIN = 'strawboss.health.last_checkin_at';
const KEY_LAST_HEARTBEAT = 'strawboss.health.last_heartbeat_at';
const KEY_LAST_SYNC = 'strawboss.health.last_sync_at';
const KEY_LAST_SYNC_ERROR = 'strawboss.health.last_sync_error';

async function stampNow(key: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, new Date().toISOString());
  } catch {
    /* best-effort */
  }
}

async function read(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export const markCheckinSuccess = (): Promise<void> => stampNow(KEY_LAST_CHECKIN);
export const markHeartbeatSuccess = (): Promise<void> => stampNow(KEY_LAST_HEARTBEAT);

/** Record a sync cycle: stamp the time and store (or clear) the last error summary. */
export async function markSyncResult(error: string | null): Promise<void> {
  await stampNow(KEY_LAST_SYNC);
  try {
    if (error) await SecureStore.setItemAsync(KEY_LAST_SYNC_ERROR, error.slice(0, 300));
    else await SecureStore.deleteItemAsync(KEY_LAST_SYNC_ERROR);
  } catch {
    /* best-effort */
  }
}

export interface HealthTimestamps {
  lastCheckinAt: string | null;
  lastHeartbeatAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export async function readHealthTimestamps(): Promise<HealthTimestamps> {
  return {
    lastCheckinAt: await read(KEY_LAST_CHECKIN),
    lastHeartbeatAt: await read(KEY_LAST_HEARTBEAT),
    lastSyncAt: await read(KEY_LAST_SYNC),
    lastSyncError: await read(KEY_LAST_SYNC_ERROR),
  };
}
