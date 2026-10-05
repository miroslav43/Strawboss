import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import { MeteoAccessService, meteoJobsEnabled } from './meteo-access.service';
import { QUEUE_METEO_HOUSEKEEPING } from './meteo.queues';

/**
 * ONLY closes open drying clocks (never creates one — harvest_status tracks
 * baling, not the combine):
 *  - the parcel reached `harvested` or beyond (harvest_status_rank >= 4) -> 'baled'
 *  - the clock is older than the org's active_days                       -> 'expired'
 */
@Injectable()
@Processor(QUEUE_METEO_HOUSEKEEPING)
export class MeteoHousekeepingProcessor extends WorkerHost {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly access: MeteoAccessService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (!meteoJobsEnabled()) return;
    let baled = 0;
    let expired = 0;
    for (const orgId of await this.access.listOptedInOrgIds()) {
      try {
        // Same per-org check as every other meteo job: skip, never throw.
        if (!(await this.access.isActiveForOrg(orgId, 'meteo.window'))) continue;
        const db = this.drizzleProvider.db;
        const closedBaled = await db.execute(sql`
          UPDATE meteo_harvest_events e
          SET closed_at = now(), close_reason = 'baled'
          FROM parcels p
          WHERE p.id = e.parcel_id AND p.organization_id = e.organization_id
            AND e.organization_id = ${orgId}::uuid
            AND e.closed_at IS NULL AND e.deleted_at IS NULL
            AND harvest_status_rank(p.harvest_status) >= 4
          RETURNING e.id
        `);
        baled += closedBaled.length;
        const closedExpired = await db.execute(sql`
          UPDATE meteo_harvest_events e
          SET closed_at = now(), close_reason = 'expired'
          FROM meteo_org_settings s
          WHERE s.organization_id = e.organization_id
            AND e.organization_id = ${orgId}::uuid
            AND e.closed_at IS NULL AND e.deleted_at IS NULL
            AND e.harvested_at < now() - make_interval(days => s.active_days)
          RETURNING e.id
        `);
        expired += closedExpired.length;
      } catch (err) {
        this.winston.error('Meteo housekeeping failed for org', {
          context: 'MeteoHousekeepingProcessor',
          orgId,
          err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        });
      }
    }
    if (baled + expired > 0) {
      this.winston.log('flow', 'Meteo drying clocks closed', {
        context: 'MeteoHousekeepingProcessor',
        jobId: job.id,
        baled,
        expired,
      });
    }
  }
}
