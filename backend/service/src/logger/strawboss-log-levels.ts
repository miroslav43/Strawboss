/**
 * Custom Winston levels for Strawboss file routing.
 * Order: lower number = higher priority (Winston convention).
 */
export const STRAWBOSS_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  flow: 3,
  http: 4,
  debug: 5,
} as const;

export type StrawbossLogLevel = keyof typeof STRAWBOSS_LEVELS;

export const STRAWBOSS_LEVEL_COLORS: Record<string, string> = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  flow: 'cyan',
  http: 'magenta',
  debug: 'gray',
};
