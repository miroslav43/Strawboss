import type { ApiClient } from '@strawboss/api';
import type { MobileLogEntryDto } from '@strawboss/validation';
import * as FileSystem from 'expo-file-system/legacy';
import { flushPending, mobileLogger } from '../lib/logger';
import { ensureDeviceId } from '../lib/device-checkin';

const ROOT = `${FileSystem.documentDirectory ?? ''}strawboss-logs`;

// Skip an upload if the last successful one was less than this long ago and
// nothing urgent (error/warn) has been logged since — a clean sync happens
// roughly once a minute per phone, and most cycles have nothing new to say.
const MIN_UPLOAD_INTERVAL_MS = 10 * 60 * 1000;
const LAST_UPLOAD_STAMP_PATH = `${ROOT}/.last-upload-at`;

// Module-level cache so we don't re-read the stamp file on every sync cycle
// within the same process lifetime. Persisted to disk (the idiom this file
// already uses for all its state — there is no SecureStore/AsyncStorage
// dependency here) so the gate survives app restarts too.
let cachedLastUploadAt: number | null = null;

async function readLastUploadAt(): Promise<number | null> {
  if (cachedLastUploadAt !== null) return cachedLastUploadAt;
  try {
    const info = await FileSystem.getInfoAsync(LAST_UPLOAD_STAMP_PATH);
    if (!info.exists) return null;
    const text = await FileSystem.readAsStringAsync(LAST_UPLOAD_STAMP_PATH);
    const parsed = Number(text.trim());
    cachedLastUploadAt = Number.isFinite(parsed) ? parsed : null;
    return cachedLastUploadAt;
  } catch {
    return null;
  }
}

async function writeLastUploadAt(timestampMs: number): Promise<void> {
  cachedLastUploadAt = timestampMs;
  try {
    await FileSystem.writeAsStringAsync(LAST_UPLOAD_STAMP_PATH, String(timestampMs));
  } catch {
    /* best-effort — in-memory cache still gates within this process lifetime */
  }
}

function pathFor(category: string, day: string): string {
  return `${ROOT}/${category}/${day}.log`;
}

export interface UploadTodayMobileLogsOptions {
  /**
   * Bypass the time/severity gate. Used by the remote `fetch_logs` fleet
   * command — an operator support request must upload immediately regardless
   * of how recently the last routine upload happened.
   */
  force?: boolean;
}

/**
 * Uploads today's `all/*.log` NDJSON to the API and removes local day files on success.
 *
 * Gated (unless `force`): a clean sync fires this once a minute per phone, but
 * most cycles have nothing worth shipping. Skips the upload unless at least
 * `MIN_UPLOAD_INTERVAL_MS` has passed since the last success OR today's
 * pending lines contain an `error`/`warn` entry (those should reach the
 * server promptly regardless of cadence).
 */
export async function uploadTodayMobileLogs(
  api: ApiClient,
  options?: UploadTodayMobileLogsOptions,
): Promise<void> {
  // Flush any pending log lines to disk before reading
  await flushPending();

  const day = new Date().toISOString().slice(0, 10);
  const allPath = pathFor('all', day);
  const info = await FileSystem.getInfoAsync(allPath);
  if (!info.exists) return;

  const text = await FileSystem.readAsStringAsync(allPath);
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return;

  const entries: MobileLogEntryDto[] = [];
  for (const line of lines) {
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      if (typeof o.level !== 'string' || typeof o.message !== 'string') continue;
      const level = o.level as MobileLogEntryDto['level'];
      if (
        level !== 'error' &&
        level !== 'warn' &&
        level !== 'info' &&
        level !== 'flow' &&
        level !== 'debug'
      ) {
        continue;
      }
      entries.push({
        level,
        message: o.message,
        context: typeof o.context === 'string' ? o.context : undefined,
        meta:
          o.meta !== null &&
          o.meta !== undefined &&
          typeof o.meta === 'object' &&
          !Array.isArray(o.meta)
            ? (o.meta as Record<string, unknown>)
            : undefined,
        recordedAt: typeof o.timestamp === 'string' ? o.timestamp : undefined,
      });
    } catch {
      /* skip malformed line */
    }
  }

  if (entries.length === 0) return;

  // Cheapest possible check — reuse the entries we already parsed above
  // instead of re-scanning the raw file for severity.
  const hasUrgentEntry = entries.some((e) => e.level === 'error' || e.level === 'warn');

  if (!options?.force && !hasUrgentEntry) {
    const lastUploadAt = await readLastUploadAt();
    const elapsed = lastUploadAt === null ? Infinity : Date.now() - lastUploadAt;
    if (elapsed < MIN_UPLOAD_INTERVAL_MS) {
      mobileLogger.debug('Mobile log upload skipped — gate not satisfied', {
        elapsedMs: elapsed,
        minIntervalMs: MIN_UPLOAD_INTERVAL_MS,
      });
      return;
    }
  }

  // Include the stable device UUID so pre-login logs are attributable per device.
  const { deviceUuid } = await ensureDeviceId().catch(() => ({ deviceUuid: undefined }));

  await api.post('/api/v1/logs/mobile', {
    entries,
    ...(deviceUuid ? { deviceId: deviceUuid } : {}),
  });

  const categories = ['all', 'error', 'warn', 'info', 'flow', 'debug'] as const;
  for (const cat of categories) {
    const p = pathFor(cat, day);
    const i = await FileSystem.getInfoAsync(p);
    if (i.exists) {
      await FileSystem.deleteAsync(p, { idempotent: true });
    }
  }

  await writeLastUploadAt(Date.now());
}
