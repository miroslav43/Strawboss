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
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { upsertParcelDailyStatusSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';

@Controller('parcel-daily-status')
export class ParcelDailyStatusController {
  constructor(
    private readonly parcelDailyStatusService: ParcelDailyStatusService,
  ) {}

  @Get()
  listByDate(@Query('date') date: string) {
    return this.parcelDailyStatusService.listByDate(date);
  }

  @Put()
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  upsert(
    @Body(new ZodValidationPipe(upsertParcelDailyStatusSchema))
    dto: { parcelId: string; statusDate: string; isDone: boolean; notes?: string | null },
  ) {
    return this.parcelDailyStatusService.upsert(dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  async remove(
    @Query('parcelId') parcelId?: string,
    @Query('date') date?: string,
  ) {
    if (!parcelId?.trim() || !date?.trim()) {
      throw new BadRequestException('parcelId and date query parameters are required');
    }
    await this.parcelDailyStatusService.removeForDate(parcelId.trim(), date.trim());
  }
}
