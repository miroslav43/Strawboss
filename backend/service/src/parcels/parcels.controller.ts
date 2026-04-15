import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  Inject,
} from '@nestjs/common';
import type { Logger as WinstonLogger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { ParcelsService } from './parcels.service';
import { Roles } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createParcelSchema, updateParcelSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';

@Controller('parcels')
export class ParcelsController {
  constructor(
    private readonly parcelsService: ParcelsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: WinstonLogger,
  ) {}

  @Get()
  list(
    @Query('municipality') municipality?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.parcelsService.list({
      municipality,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get(':id/bale-availability')
  getBaleAvailability(@Param('id') id: string) {
    return this.parcelsService.getBaleAvailability(id);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.parcelsService.findById(id);
  }

  @Post()
  @Roles('admin' as UserRole)
  create(
    @Body(new ZodValidationPipe(createParcelSchema)) dto: Record<string, unknown>,
  ) {
    return this.parcelsService.create(dto);
  }

  @Patch(':id')
  @Roles('admin' as UserRole)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateParcelSchema)) dto: Record<string, unknown>,
  ) {
    return this.parcelsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin' as UserRole)
  async softDelete(@Param('id') id: string, @Req() req: { user?: { id: string; role: string } }) {
    this.winston.info('DELETE parcel started', {
      context: 'ParcelsController',
      parcelId: id,
      userId: req.user?.id ?? null,
      role: req.user?.role ?? null,
    });
    try {
      const result = await this.parcelsService.softDelete(id);
      this.winston.info('DELETE parcel success', {
        context: 'ParcelsController',
        parcelId: id,
      });
      return result;
    } catch (err) {
      this.winston.error('DELETE parcel failed', {
        context: 'ParcelsController',
        parcelId: id,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  }
}
