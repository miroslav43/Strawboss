import type { ApiClient } from '@strawboss/api';
import type { MobileLogEntryDto } from '@strawboss/validation';
import * as FileSystem from 'expo-file-system/legacy';

const ROOT = `${FileSystem.documentDirectory ?? ''}strawboss-logs`;

function pathFor(category: string, day: string): string {
  return `${ROOT}/${category}/${day}.log`;
}

/**
 * Uploads today's `all/*.log` NDJSON to the API and removes local day files on success.
 */
export async function uploadTodayMobileLogs(api: ApiClient): Promise<void> {
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
        recordedAt:
          typeof o.timestamp === 'string' ? o.timestamp : undefined,
      });
    } catch {
      /* skip malformed line */
    }
  }

  if (entries.length === 0) return;

  await api.post('/api/v1/logs/mobile', { entries });

  const categories = ['all', 'error', 'warn', 'info', 'flow', 'debug'] as const;
  for (const cat of categories) {
    const p = pathFor(cat, day);
    const i = await FileSystem.getInfoAsync(p);
    if (i.exists) {
      await FileSystem.deleteAsync(p, { idempotent: true });
    }
  }
}
