import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ParcelsService } from './parcels.service';
import { Roles } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createParcelSchema, updateParcelSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';

@Controller('parcels')
export class ParcelsController {
  constructor(private readonly parcelsService: ParcelsService) {}

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

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.parcelsService.findById(id);
  }

  @Post()
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  create(
    @Body(new ZodValidationPipe(createParcelSchema)) dto: Record<string, unknown>,
  ) {
    return this.parcelsService.create(dto);
  }

  @Patch(':id')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateParcelSchema)) dto: Record<string, unknown>,
  ) {
    return this.parcelsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin' as UserRole)
  softDelete(@Param('id') id: string) {
    return this.parcelsService.softDelete(id);
  }
}
