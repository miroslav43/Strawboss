import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Query,
} from '@nestjs/common';
import { ParcelDailyStatusService } from './parcel-daily-status.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { upsertParcelDailyStatusSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';
import { RequireFeature } from '../features/require-feature.decorator';

@Controller('parcel-daily-status')
export class ParcelDailyStatusController {
  constructor(
    private readonly parcelDailyStatusService: ParcelDailyStatusService,
  ) {}

  @Get()
  listByDate(
    @CurrentUser() user: RequestUser,
    @Query('date') date: string,
  ) {
    return this.parcelDailyStatusService.listByDate(date, user.organizationId);
  }

  @Put()
  @RequireFeature('bales.parcel_daily_status')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  upsert(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(upsertParcelDailyStatusSchema))
    dto: { parcelId: string; statusDate: string; isDone: boolean; notes?: string | null },
  ) {
    return this.parcelDailyStatusService.upsert(user.organizationId, dto);
  }

  @Delete()
  @RequireFeature('bales.parcel_daily_status')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  async remove(
    @CurrentUser() user: RequestUser,
    @Query('parcelId') parcelId?: string,
    @Query('date') date?: string,
  ) {
    if (!parcelId?.trim() || !date?.trim()) {
      throw new BadRequestException('parcelId and date query parameters are required');
    }
    await this.parcelDailyStatusService.removeForDate(parcelId.trim(), date.trim(), user.organizationId);
  }
}
