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
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createMachineSchema, updateMachineSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';
import type { RequestUser } from '../auth/auth.guard';

@Controller('machines')
export class MachinesController {
  constructor(private readonly machinesService: MachinesService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('machineType') machineType?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.machinesService.list(user.organizationId, {
      machineType,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.machinesService.findById(id, user.organizationId);
  }

  @Post()
  @Roles('admin' as UserRole)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createMachineSchema)) dto: Record<string, unknown>,
  ) {
    return this.machinesService.create(user.organizationId, dto);
  }

  @Patch(':id')
  @Roles('admin' as UserRole)
  update(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateMachineSchema)) dto: Record<string, unknown>,
  ) {
    return this.machinesService.update(id, user.organizationId, dto);
  }

  @Delete(':id')
  @Roles('admin' as UserRole)
  softDelete(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.machinesService.softDelete(id, user.organizationId);
  }
}
