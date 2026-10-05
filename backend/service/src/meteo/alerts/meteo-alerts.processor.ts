import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { MeteoAccessService, meteoJobsEnabled } from '../meteo-access.service';
import { MeteoClient } from '../meteo-client';
import { QUEUE_METEO_ALERTS } from '../meteo.queues';
import { MeteoAlertNotifierService } from './meteo-alert-notifier.service';
import { MeteoAlertsService } from './meteo-alerts.service';

/**
 * Hourly (:40) evaluation of the farm forecast against each opted-in org's
 * thresholds, then push/email for what is new. A job may carry `{ orgId }` for
 * the admin "evaluate now" button (that org only). Per-org try/catch: one
 * org's failure never stops the others; a disabled feature is a quiet skip.
 */
@Injectable()
@Processor(QUEUE_METEO_ALERTS)
export class MeteoAlertsProcessor extends WorkerHost {
  constructor(
    private readonly access: MeteoAccessService,
    private readonly client: MeteoClient,
    private readonly alerts: MeteoAlertsService,
    private readonly notifier: MeteoAlertNotifierService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (!meteoJobsEnabled() || !this.client.configured) return;
    const only = (job.data as { orgId?: string } | undefined)?.orgId;
    const orgIds = only ? [only] : await this.access.listOptedInOrgIds();
    let evaluated = 0;
    for (const orgId of orgIds) {
      try {
        if (!(await this.access.isActiveForOrg(orgId, 'meteo.forecast', 'meteo.alerts'))) continue;
        if (!(await this.alerts.getSettings(orgId)).alertsEnabled) continue;
        await this.alerts.evaluateOrg(orgId, { dryRun: false });
        await this.notifier.flush(orgId);
        evaluated++;
      } catch (err) {
        this.winston.warn('Meteo alerts run failed for org', {
          context: 'MeteoAlertsProcessor',
          orgId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.winston.log('flow', 'Meteo alerts job completed', {
      context: 'MeteoAlertsProcessor',
      jobId: job.id,
      orgs: orgIds.length,
      evaluated,
    });
  }
}
