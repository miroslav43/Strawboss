import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { NotificationsService } from '../notifications/notifications.service';

export type SimulateEvent =
  | 'field_entry'
  | 'deposit_entry'
  | 'truck_arrived_at_loader'
  | 'trip_loaded'
  | 'trip_departed'
  | 'trip_arrived'
  | 'trip_completed'
  | 'trip_disputed'
  | 'broadcast';

export interface SimulateTarget {
  userId?: string;
  role?: string;
  machineId?: string;
}

export interface SimulateInput {
  event: SimulateEvent;
  target: SimulateTarget;
  vars?: Record<string, string>;
}

interface EventTemplate {
  title: (vars: Record<string, string>) => string;
  body: (vars: Record<string, string>) => string;
}

const EVENT_TEMPLATES: Record<SimulateEvent, EventTemplate> = {
  field_entry: {
    title: () => 'Ai intrat pe câmp',
    body: (v) => `Ai ajuns la ${v.parcel ?? 'câmpul asignat'}.`,
  },
  deposit_entry: {
    title: () => 'Ai ajuns la depozit',
    body: () => 'Ești în zona de livrare.',
  },
  truck_arrived_at_loader: {
    title: () => 'A sosit un camion',
    body: (v) => `Camionul ${v.plate ?? 'demo'} a ajuns la ${v.parcel ?? 'câmpul tău'}.`,
  },
  trip_loaded: {
    title: () => 'Transport pregătit',
    body: () => 'Baloții au fost încărcați. Poți pleca.',
  },
  trip_departed: {
    title: () => 'Drum bun',
    body: (v) => `Cursa este în drum spre ${v.warehouse ?? 'destinație'}.`,
  },
  trip_arrived: {
    title: () => 'Ai ajuns la destinație',
    body: () => 'Confirmă livrarea când ești gata.',
  },
  trip_completed: {
    title: () => 'Transport finalizat',
    body: () => 'Transportul a fost completat cu succes.',
  },
  trip_disputed: {
    title: () => 'Dispută transport',
    body: () => 'Transportul tău a intrat în dispută. Contactează dispeceratul.',
  },
  broadcast: {
    title: (v) => v.title ?? 'Anunț',
    body: (v) => v.body ?? 'Mesaj de la dispecerat.',
  },
};

@Injectable()
export class DevService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly notificationsService: NotificationsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  /**
   * Simulate a notification event by calling NotificationsService directly,
   * skipping geofence/trip workflow. Used by mock test scripts.
   */
  async simulate(input: SimulateInput): Promise<{ targetedUserIds: string[]; sentCount: number }> {
    if (!EVENT_TEMPLATES[input.event]) {
      throw new BadRequestException(`Unknown event: ${input.event}`);
    }

    const userIds = await this.resolveTargetUserIds(input.target);
    if (userIds.length === 0) {
      this.winston.warn('Dev simulate: no target users resolved', {
        context: 'DevService',
        event: input.event,
        target: input.target,
      });
      return { targetedUserIds: [], sentCount: 0 };
    }

    const template = EVENT_TEMPLATES[input.event];
    const vars = input.vars ?? {};
    const title = template.title(vars);
    const body = template.body(vars);
    const data = { type: input.event, ...vars, simulated: 'true' };

    let sent = 0;
    await Promise.all(
      userIds.map(async (uid) => {
        try {
          await this.notificationsService.sendPush(uid, title, body, data);
          sent += 1;
        } catch (err) {
          this.winston.warn(`Dev simulate sendPush failed for user ${uid}`, {
            context: 'DevService',
            userId: uid,
            err: err instanceof Error ? { message: err.message } : err,
          });
        }
      }),
    );

    this.winston.log(
      'flow',
      `Dev simulate '${input.event}' → ${sent}/${userIds.length} push(es)`,
      {
        context: 'DevService',
        event: input.event,
        target: input.target,
        targetedUsers: userIds.length,
        sentCount: sent,
      },
    );

    return { targetedUserIds: userIds, sentCount: sent };
  }

  private async resolveTargetUserIds(target: SimulateTarget): Promise<string[]> {
    if (target.userId) {
      return [target.userId];
    }
    if (target.machineId) {
      const rows = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM users
        WHERE assigned_machine_id = ${target.machineId}::uuid
          AND deleted_at IS NULL
      `)) as unknown as { id: string }[];
      return rows.map((r) => r.id);
    }
    if (target.role) {
      const rows = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM users
        WHERE role = ${target.role}::user_role
          AND deleted_at IS NULL
          AND is_active = true
      `)) as unknown as { id: string }[];
      return rows.map((r) => r.id);
    }
    throw new BadRequestException(
      'target must specify at least one of: userId, role, machineId',
    );
  }
}
