/**
 * Meteo BullMQ queue names. Kept inside the meteo module (instead of
 * jobs/queues.ts + jobs.module.ts) so the whole feature stays isolated; the
 * module registers them itself via BullModule.registerQueue().
 * No ':' in any queue name or job id (BullMQ restriction on custom ids).
 */
export const QUEUE_METEO_INGEST = 'meteo-ingest';
export const QUEUE_METEO_ENGINE = 'meteo-engine';
export const QUEUE_METEO_HOUSEKEEPING = 'meteo-housekeeping';
export const QUEUE_METEO_FINGERPRINT = 'meteo-fingerprint';
export const QUEUE_METEO_RETENTION = 'meteo-retention';

/** Debounce window for engine / targeted-ingest enqueues. */
export const METEO_ENQUEUE_DEBOUNCE_MS = 30_000;
