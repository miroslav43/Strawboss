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
import { MachinesService } from './machines.service';
import { Roles } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createMachineSchema, updateMachineSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';

@Controller('machines')
export class MachinesController {
  constructor(private readonly machinesService: MachinesService) {}

  @Get()
  list(
    @Query('machineType') machineType?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.machinesService.list({
      machineType,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.machinesService.findById(id);
  }

  @Post()
  @Roles('admin' as UserRole)
  create(
    @Body(new ZodValidationPipe(createMachineSchema)) dto: Record<string, unknown>,
  ) {
    return this.machinesService.create(dto);
  }

  @Patch(':id')
  @Roles('admin' as UserRole)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMachineSchema)) dto: Record<string, unknown>,
  ) {
    return this.machinesService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin' as UserRole)
  softDelete(@Param('id') id: string) {
    return this.machinesService.softDelete(id);
  }
}
