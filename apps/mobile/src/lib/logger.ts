import * as FileSystem from 'expo-file-system/legacy';

export type MobileLogLevel = 'error' | 'warn' | 'info' | 'flow' | 'debug';

interface LogRecord {
  timestamp: string;
  level: MobileLogLevel;
  message: string;
  context?: string;
  meta?: Record<string, unknown>;
}

const ROOT = `${FileSystem.documentDirectory ?? ''}strawboss-logs`;

function pathFor(category: string, day: string): string {
  return `${ROOT}/${category}/${day}.log`;
}

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

async function readIfExists(file: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(file);
  if (!info.exists) return '';
  return FileSystem.readAsStringAsync(file);
}

const pendingLines: Map<string, string[]> = new Map();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function appendLine(file: string, line: string): Promise<void> {
  const dir = file.slice(0, file.lastIndexOf('/'));
  await ensureDir(dir);

  const pending = pendingLines.get(file) ?? [];
  pending.push(line);
  pendingLines.set(file, pending);

  // Debounce: flush after 2 seconds of inactivity
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushPending, 2000);
}

export async function flushPending(): Promise<void> {
  for (const [file, lines] of pendingLines.entries()) {
    if (lines.length === 0) continue;
    const batch = lines.splice(0).join('\n');
    try {
      const prev = await readIfExists(file);
      await FileSystem.writeAsStringAsync(file, prev ? `${prev}\n${batch}` : batch);
    } catch { /* ignore write errors */ }
  }
}

async function writeRecord(
  level: MobileLogLevel,
  message: string,
  context?: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const record: LogRecord = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
    meta,
  };
  const line = JSON.stringify(record);
  const day = record.timestamp.slice(0, 10);
  const targets = [`all`, level] as const;
  for (const cat of targets) {
    await appendLine(pathFor(cat, day), line);
  }
}

function fireAndForget(p: Promise<void>): void {
  p.catch(() => {
    /* avoid recursive logging */
  });
}

/**
 * On-device structured logs under Document/strawboss-logs/{all|level}/YYYY-MM-DD.log
 * (7-day retention via {@link cleanupOldMobileLogFiles}).
 */
export const mobileLogger = {
  error(message: string, meta?: Record<string, unknown>) {
    fireAndForget(writeRecord('error', message, 'mobile', meta));
  },
  warn(message: string, meta?: Record<string, unknown>) {
    fireAndForget(writeRecord('warn', message, 'mobile', meta));
  },
  info(message: string, meta?: Record<string, unknown>) {
    fireAndForget(writeRecord('info', message, 'mobile', meta));
  },
  flow(message: string, meta?: Record<string, unknown>) {
    fireAndForget(writeRecord('flow', message, 'mobile', meta));
  },
  debug(message: string, meta?: Record<string, unknown>) {
    fireAndForget(writeRecord('debug', message, 'mobile', meta));
  },
};

/**
 * Deletes log files older than 7 days in every category folder.
 */
export async function cleanupOldMobileLogFiles(): Promise<void> {
  const categories = ['all', 'error', 'warn', 'info', 'flow', 'debug'] as const;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const cat of categories) {
    const dir = `${ROOT}/${cat}`;
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists || !info.isDirectory) continue;

    const files = await FileSystem.readDirectoryAsync(dir);
    for (const name of files) {
      const m = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
      if (!m) continue;
      const t = new Date(`${m[1]}T00:00:00.000Z`).getTime();
      if (Number.isFinite(t) && t < cutoff) {
        await FileSystem.deleteAsync(`${dir}/${name}`, { idempotent: true });
      }
    }
  }
}
