import { join } from 'path';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import {
  STRAWBOSS_LEVELS,
  STRAWBOSS_LEVEL_COLORS,
} from './strawboss-log-levels';

winston.addColors(STRAWBOSS_LEVEL_COLORS);

const DATE_PATTERN = 'YYYY-MM-DD';
const MAX_FILES = '7d';

function resolveDefaultLogRoot(): string {
  const env = process.env.LOG_ROOT?.trim();
  if (env) return env;
  // dist/logger → ../../../.. = monorepo root (backend/service is 3 levels below root from service folder... from dist/logger: .. dist, .. service, .. backend, .. repo)
  return join(__dirname, '..', '..', '..', '..', 'logs');
}

export function getLogRoot(): string {
  return resolveDefaultLogRoot();
}

function jsonFormat(): winston.Logform.Format {
  return winston.format.printf((info) => {
    const { timestamp, level, message, ...rest } = info;
    return JSON.stringify({
      timestamp,
      level,
      message,
      ...rest,
    });
  });
}

function levelOnlyFilter(level: string): winston.Logform.Format {
  return winston.format((info) =>
    info.level === level ? info : false,
  )();
}

function createCategoryRotate(
  dirname: string,
  levelName: string,
): DailyRotateFile {
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

function createAllRotate(dirname: string): DailyRotateFile {
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

export interface StrawbossTransportOptions {
  /** When true, keep a `debug/` daily file even in production (e.g. mobile log ingest). */
  includeDebugInProduction?: boolean;
}

/**
 * Builds Winston transports for one tree: e.g. web/ or mobile/ under LOG_ROOT.
 */
export function createStrawbossFileTransports(
  subdir: 'web' | 'mobile',
  options?: StrawbossTransportOptions,
): winston.transport[] {
  const root = getLogRoot();
  const base = join(root, subdir);
  const isProd = process.env.NODE_ENV === 'production';

  const transports: winston.transport[] = [
    createCategoryRotate(join(base, 'error'), 'error'),
    createCategoryRotate(join(base, 'warn'), 'warn'),
    createCategoryRotate(join(base, 'info'), 'info'),
    createCategoryRotate(join(base, 'flow'), 'flow'),
    createCategoryRotate(join(base, 'http'), 'http'),
    createAllRotate(join(base, 'all')),
  ];

  if (!isProd || options?.includeDebugInProduction) {
    transports.push(createCategoryRotate(join(base, 'debug'), 'debug'));
  }

  return transports;
}

function consoleTransport(): winston.transport {
  return new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.timestamp(),
      winston.format.printf((info) => {
        const ctx = info.context ? ` [${String(info.context)}]` : '';
        return `${info.timestamp} ${info.level}:${ctx} ${info.message}`;
      }),
    ),
  });
}

export function createApplicationWinstonOptions(): winston.LoggerOptions {
  const fileTransports = createStrawbossFileTransports('web');
  const isProd = process.env.NODE_ENV === 'production';
  const transports: winston.transport[] = [...fileTransports];
  if (!isProd) {
    transports.push(consoleTransport());
  }

  return {
    levels: STRAWBOSS_LEVELS,
    // Must be `debug` so flow/http/debug reach category transports (Winston filters by numeric level first).
    level: 'debug',
    transports,
  };
}

/**
 * Separate Winston logger writing only under logs/mobile/ (used by mobile-logs controller).
 */
export function createMobileIngestLogger(): winston.Logger {
  return winston.createLogger({
    levels: STRAWBOSS_LEVELS,
    level: 'debug',
    transports: createStrawbossFileTransports('mobile', {
      includeDebugInProduction: true,
    }),
  });
}
