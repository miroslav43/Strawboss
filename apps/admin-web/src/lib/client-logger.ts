'use client';

type ClientLevel = 'error' | 'warn' | 'info' | 'flow';

export interface ClientLogEntry {
  level: ClientLevel;
  message: string;
  context?: string;
  meta?: Record<string, unknown>;
}

const MAX_BATCH = 10;
const DEBOUNCE_MS = 2000;

const queue: ClientLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function consoleFor(level: ClientLevel, message: string, meta?: Record<string, unknown>) {
  const line = meta ? `${message} ${JSON.stringify(meta)}` : message;
  switch (level) {
    case 'error':
      console.error(`[StrawBoss] ${line}`);
      break;
    case 'warn':
      console.warn(`[StrawBoss] ${line}`);
      break;
    case 'info':
      console.info(`[StrawBoss] ${line}`);
      break;
    case 'flow':
      console.debug(`[StrawBoss][flow] ${line}`);
      break;
    default:
      console.log(`[StrawBoss] ${line}`);
  }
}

async function postBatch(entries: ClientLogEntry[]): Promise<void> {
  try {
    await fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
  } catch {
    // Avoid recursive logging
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, DEBOUNCE_MS);
}

function flushNow(): Promise<void> {
  if (queue.length === 0) return Promise.resolve();
  const batch = queue.splice(0, MAX_BATCH);
  if (isProduction() && typeof window !== 'undefined') {
    return postBatch(batch);
  }
  return Promise.resolve();
}

function enqueue(entry: ClientLogEntry) {
  if (!isProduction()) {
    consoleFor(entry.level, entry.message, entry.meta);
    return;
  }
  if (typeof window === 'undefined') return;

  queue.push(entry);
  if (queue.length >= MAX_BATCH) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flushNow();
    return;
  }
  scheduleFlush();
}

export const clientLogger = {
  error(message: string, meta?: Record<string, unknown>) {
    enqueue({ level: 'error', message, context: 'admin-web', meta });
  },
  warn(message: string, meta?: Record<string, unknown>) {
    enqueue({ level: 'warn', message, context: 'admin-web', meta });
  },
  info(message: string, meta?: Record<string, unknown>) {
    enqueue({ level: 'info', message, context: 'admin-web', meta });
  },
  flow(message: string, meta?: Record<string, unknown>) {
    enqueue({ level: 'flow', message, context: 'admin-web', meta });
  },
};
