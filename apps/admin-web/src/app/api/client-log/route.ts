import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminWebServerLogger } from '@/lib/server-logger';

const entrySchema = z.object({
  level: z.enum(['error', 'warn', 'info', 'flow']),
  message: z.string().min(1).max(4000),
  context: z.string().max(200).optional(),
  meta: z.record(z.unknown()).optional(),
});

const bodySchema = z.object({
  entries: z.array(entrySchema).min(1).max(10),
});

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 50;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function allowRateLimit(ip: string): boolean {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    rateBuckets.set(ip, b);
  }
  b.count += 1;
  if (b.count > MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  return true;
}

/** POST batched browser logs → `logs/web/` via Winston. */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!allowRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const logger = getAdminWebServerLogger();
  for (const e of parsed.data.entries) {
    const meta = {
      context: e.context ?? 'admin-web-client',
      source: 'browser',
      clientIp: ip,
      ...(e.meta ?? {}),
    };
    switch (e.level) {
      case 'error':
        logger.error(e.message, meta);
        break;
      case 'warn':
        logger.warn(e.message, meta);
        break;
      case 'info':
        logger.info(e.message, meta);
        break;
      case 'flow':
        logger.log('flow', e.message, meta);
        break;
      default:
        break;
    }
  }

  return NextResponse.json({ ok: true });
}
