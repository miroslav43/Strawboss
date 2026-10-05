import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CurrentUser, Roles, type RequestUser } from '../../auth';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequireFeature } from '../../features/require-feature.decorator';
import {
  meteoAlertEvaluateQuerySchema,
  meteoAlertsQuerySchema,
  updateMeteoAlertSettingsSchema,
} from '@strawboss/validation';
import { UserRole } from '@strawboss/types';
import type { UpdateMeteoAlertSettingsDto } from '@strawboss/types';
import { MeteoAccessService, meteoJobsEnabled } from '../meteo-access.service';
import { QUEUE_METEO_ALERTS } from '../meteo.queues';
import { MeteoAlertsService } from './meteo-alerts.service';

/**
 * Weather alert feed + settings. Reads carry no feature gate (history stays
 * visible); every write has @RequireFeature('meteo.alerts') AND an org opt-in
 * check in the service.
 */
@Controller('meteo')
export class MeteoAlertsController {
  constructor(
    private readonly service: MeteoAlertsService,
    private readonly access: MeteoAccessService,
    @InjectQueue(QUEUE_METEO_ALERTS) private readonly queue: Queue,
  ) {}

  private requireOrg(user: RequestUser): string {
    if (!user.organizationId) throw new ForbiddenException('No organization');
    return user.organizationId;
  }

  @Get('alerts')
  @Roles(UserRole.admin, UserRole.dispatcher)
  list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(meteoAlertsQuerySchema)) query: { days?: number },
  ) {
    return this.service.list(this.requireOrg(user), query.days);
  }

  @Post('alerts/evaluate')
  @RequireFeature('meteo.alerts')
  @Roles(UserRole.admin)
  async evaluate(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(meteoAlertEvaluateQuerySchema)) query: { dryRun?: 'true' | 'false' },
  ) {
    const orgId = this.requireOrg(user);
    await this.access.assertOptedIn(orgId);
    if (query.dryRun === 'true') {
      const { candidates } = await this.service.evaluateOrg(orgId, { dryRun: true });
      return { candidates, queued: false };
    }
    if (!meteoJobsEnabled()) return { candidates: [], queued: false };
    await this.queue.add(
      'evaluate',
      { orgId },
      { jobId: `meteo-alerts-${orgId}`, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
    return { candidates: [], queued: true };
  }

  @Post('alerts/:id/ack')
  @RequireFeature('meteo.alerts')
  @Roles(UserRole.admin, UserRole.dispatcher)
  async ack(@CurrentUser() user: RequestUser, @Param('id', new ParseUUIDPipe()) id: string) {
    const orgId = this.requireOrg(user);
    await this.access.assertOptedIn(orgId);
    return this.service.ack(orgId, id, user.id);
  }

  @Get('alert-settings')
  @Roles(UserRole.admin, UserRole.dispatcher)
  settings(@CurrentUser() user: RequestUser) {
    return this.service.getSettings(this.requireOrg(user));
  }

  @Put('alert-settings')
  @RequireFeature('meteo.alerts')
  @Roles(UserRole.admin)
  updateSettings(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateMeteoAlertSettingsSchema)) dto: UpdateMeteoAlertSettingsDto,
  ) {
    return this.service.updateSettings(this.requireOrg(user), user.id, dto);
  }
}
