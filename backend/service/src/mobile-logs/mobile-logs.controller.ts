import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  mobileLogIngestSchema,
  type MobileLogIngestDto,
} from '@strawboss/validation';
import { MobileLogsService } from './mobile-logs.service';

@Controller('logs')
export class MobileLogsController {
  constructor(private readonly mobileLogsService: MobileLogsService) {}

  /**
   * POST /api/v1/logs/mobile — authenticated clients upload batched NDJSON-derived entries.
   */
  @Post('mobile')
  ingest(
    @Body(new ZodValidationPipe(mobileLogIngestSchema)) body: MobileLogIngestDto,
    @CurrentUser() user: RequestUser,
  ): { ok: true } {
    this.mobileLogsService.ingest(body.entries, user.id);
    return { ok: true };
  }
}
