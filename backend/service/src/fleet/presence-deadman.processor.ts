import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { QUEUE_PRESENCE_DEADMAN } from '../jobs/queues';
import { FleetService } from './fleet.service';

/**
 * Presence dead-man worker. Runs ~every 2 min (seeded by JobSchedulerService).
 * Delegates to FleetService.wakeStaleDeviceOwners, which FCM-wakes any
 * device-owner phone whose last_checkin_at has gone stale — the external safety
 * net for the always-on anchor (a frozen phone can't self-recover, but a
 * high-priority FCM wake restarts its process → onCreate → PresenceService).
 */
@Processor(QUEUE_PRESENCE_DEADMAN)
export class PresenceDeadmanProcessor extends WorkerHost {
  constructor(
    private readonly fleetService: FleetService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    try {
      const { scanned, woken } = await this.fleetService.wakeStaleDeviceOwners(4);
      if (woken > 0) {
        this.winston.log('flow', 'Presence dead-man scan', {
          context: 'PresenceDeadmanProcessor',
          scanned,
          woken,
        });
      }
    } catch (err) {
      this.winston.error('Presence dead-man scan failed', {
        context: 'PresenceDeadmanProcessor',
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
