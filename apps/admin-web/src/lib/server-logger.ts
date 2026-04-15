import 'server-only';
import { join } from 'path';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

/** Mirrors backend `STRAWBOSS_LEVELS` for consistent log routing under `logs/web/`. */
const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  flow: 3,
  http: 4,
  debug: 5,
} as const;

const DATE_PATTERN = 'YYYY-MM-DD';
const MAX_FILES = '7d';

function resolveLogRoot(): string {
  const env = process.env.LOG_ROOT?.trim();
  if (env) return env;
  const cwd = process.cwd();
  // `next dev` cwd is usually `.../apps/admin-web` → repo-root `logs/`
  if (cwd.includes('admin-web')) {
    return join(cwd, '..', '..', 'logs');
  }
  // Next.js standalone image: cwd `/app` → `./logs` (volume mount)
  return join(cwd, 'logs');
}

function jsonFormat(): winston.Logform.Format {
  return winston.format.printf((info) => {
    const { timestamp, level, message, ...rest } = info;
    return JSON.stringify({ timestamp, level, message, ...rest });
  });
}

function levelOnlyFilter(level: string): winston.Logform.Format {
  return winston.format((info) => (info.level === level ? info : false))();
}

function categoryRotate(dirname: string, levelName: string): DailyRotateFile {
  return new DailyRotateFile({
    dirname,
    filename: '%DATE%.log',
    datePattern: DATE_PATTERN,
    maxFiles: MAX_FILES,
    zippedArchive: false,
    format: winston.format.combine(
      levelOnlyFilter(levelName),
      winston.format.timestamp(),
      jsonFormat(),
    ),
  });
}

function allRotate(dirname: string): DailyRotateFile {
  return new DailyRotateFile({
    dirname,
    filename: '%DATE%.log',
    datePattern: DATE_PATTERN,
    maxFiles: MAX_FILES,
    zippedArchive: false,
    format: winston.format.combine(
      winston.format.timestamp(),
      jsonFormat(),
    ),
  });
}

let cached: winston.Logger | null = null;

/**
 * Winston logger writing under `logs/web/` (same tree as the Nest backend).
 */
export function getAdminWebServerLogger(): winston.Logger {
  if (cached) return cached;

  const root = resolveLogRoot();
  const base = join(root, 'web');
  const isProd = process.env.NODE_ENV === 'production';

  const transports: winston.transport[] = [
    categoryRotate(join(base, 'error'), 'error'),
    categoryRotate(join(base, 'warn'), 'warn'),
    categoryRotate(join(base, 'info'), 'info'),
    categoryRotate(join(base, 'flow'), 'flow'),
    categoryRotate(join(base, 'http'), 'http'),
    allRotate(join(base, 'all')),
  ];
  if (!isProd) {
    transports.push(categoryRotate(join(base, 'debug'), 'debug'));
  }

  cached = winston.createLogger({
    levels: LEVELS,
    level: 'debug',
    transports,
  });

  return cached;
}
