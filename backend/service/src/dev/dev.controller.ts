import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { DevService, type SimulateInput, type SimulateEvent, type SimulateTarget } from './dev.service';
import { Roles } from '../auth/roles.guard';
import type { UserRole } from '@strawboss/types';

const VALID_EVENTS: ReadonlySet<SimulateEvent> = new Set([
  'field_entry',
  'deposit_entry',
  'truck_arrived_at_loader',
  'trip_loaded',
  'trip_departed',
  'trip_arrived',
  'trip_completed',
  'trip_disputed',
  'broadcast',
]);

interface RawSimulateBody {
  event?: unknown;
  target?: unknown;
  vars?: unknown;
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object') return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
}

/**
 * Dev-only mock event simulator. Disabled in production unless
 * STRAWBOSS_ENABLE_DEV=1 is set explicitly. Admin role required.
 *
 * POST /api/v1/dev/notifications/simulate
 *   { event: '<MobileNotificationType value>',
 *     target: { userId? | role? | machineId? },
 *     vars?: { plate?, parcel?, warehouse?, title?, body? } }
 */
@Controller('dev/notifications')
export class DevController {
  constructor(private readonly devService: DevService) {}

  @Post('simulate')
  @Roles('admin' as UserRole)
  async simulate(@Body() body: RawSimulateBody) {
    if (!isString(body.event) || !VALID_EVENTS.has(body.event as SimulateEvent)) {
      throw new BadRequestException(
        `event must be one of: ${[...VALID_EVENTS].join(', ')}`,
      );
    }
    if (!body.target || typeof body.target !== 'object') {
      throw new BadRequestException('target object is required');
    }

    const t = body.target as Record<string, unknown>;
    const target: SimulateTarget = {};
    if (t.userId !== undefined) {
      if (!isString(t.userId)) throw new BadRequestException('target.userId must be a string');
      target.userId = t.userId;
    }
    if (t.role !== undefined) {
      if (!isString(t.role)) throw new BadRequestException('target.role must be a string');
      target.role = t.role;
    }
    if (t.machineId !== undefined) {
      if (!isString(t.machineId)) throw new BadRequestException('target.machineId must be a string');
      target.machineId = t.machineId;
    }
    if (!target.userId && !target.role && !target.machineId) {
      throw new BadRequestException('target must specify userId, role, or machineId');
    }

    const vars: Record<string, string> | undefined =
      body.vars === undefined
        ? undefined
        : isStringRecord(body.vars)
          ? body.vars
          : (() => {
              throw new BadRequestException('vars must be a flat object of strings');
            })();

    const input: SimulateInput = {
      event: body.event as SimulateEvent,
      target,
      vars,
    };

    return this.devService.simulate(input);
  }
}
