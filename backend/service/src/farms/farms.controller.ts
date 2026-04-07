import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { FarmsService } from './farms.service';
import { Roles } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createFarmSchema, updateFarmSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';

@Controller('farms')
export class FarmsController {
  constructor(private readonly farmsService: FarmsService) {}

  @Get()
  list() {
    return this.farmsService.list();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.farmsService.findById(id);
  }

  @Post()
  @Roles('admin' as UserRole)
  create(
    @Body(new ZodValidationPipe(createFarmSchema)) dto: Record<string, unknown>,
  ) {
    return this.farmsService.create(dto);
  }

  @Patch(':id')
  @Roles('admin' as UserRole)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFarmSchema)) dto: Record<string, unknown>,
  ) {
    return this.farmsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin' as UserRole)
  softDelete(@Param('id') id: string) {
    return this.farmsService.softDelete(id);
  }
}
