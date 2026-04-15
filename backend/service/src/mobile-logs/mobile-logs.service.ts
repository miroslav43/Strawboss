import { Injectable } from '@nestjs/common';
import type { MobileLogEntryDto } from '@strawboss/validation';
import { createMobileIngestLogger } from '../logger/winston-factory';

/**
 * Persists mobile app log batches under `logs/mobile/` (Winston daily rotate).
 */
@Injectable()
export class MobileLogsService {
  private readonly winston = createMobileIngestLogger();

  ingest(entries: MobileLogEntryDto[], userId: string): void {
    for (const e of entries) {
      const meta = {
        context: e.context ?? 'mobile',
        source: 'mobile',
        userId,
        recordedAt: e.recordedAt,
        ...(e.meta ?? {}),
      };
      switch (e.level) {
        case 'error':
          this.winston.error(e.message, meta);
          break;
        case 'warn':
          this.winston.warn(e.message, meta);
          break;
        case 'info':
          this.winston.info(e.message, meta);
          break;
        case 'flow':
          this.winston.log('flow', e.message, meta);
          break;
        case 'debug':
          this.winston.debug(e.message, meta);
          break;
        default:
          break;
      }
    }
  }
}
