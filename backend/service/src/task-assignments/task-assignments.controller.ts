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
import { TaskAssignmentsService } from './task-assignments.service';
import { Roles } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createTaskAssignmentSchema,
  updateAssignmentStatusSchema,
} from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';
import { z } from 'zod';

const bulkCreateSchema = z.array(createTaskAssignmentSchema);

@Controller('task-assignments')
export class TaskAssignmentsController {
  constructor(
    private readonly taskAssignmentsService: TaskAssignmentsService,
  ) {}

  @Get()
  list(
    @Query('assignmentDate') assignmentDate?: string,
    @Query('machineId') machineId?: string,
    @Query('assignedUserId') assignedUserId?: string,
    @Query('status') status?: string,
  ) {
    return this.taskAssignmentsService.list({
      assignmentDate,
      machineId,
      assignedUserId,
      status,
    });
  }

  @Get('board/:date')
  getBoard(@Param('date') date: string) {
    return this.taskAssignmentsService.getBoard(date);
  }

  @Get('daily-plan/:date')
  getDailyPlan(@Param('date') date: string) {
    return this.taskAssignmentsService.getDailyPlan(date);
  }

  @Get('by-machine-type/:date/:machineType')
  getByMachineType(
    @Param('date') date: string,
    @Param('machineType') machineType: string,
  ) {
    return this.taskAssignmentsService.getByMachineType(date, machineType);
  }

  @Post()
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  create(
    @Body(new ZodValidationPipe(createTaskAssignmentSchema))
    dto: Record<string, unknown>,
  ) {
    return this.taskAssignmentsService.create(dto);
  }

  @Post('bulk')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  bulkCreate(
    @Body(new ZodValidationPipe(bulkCreateSchema))
    dtos: Record<string, unknown>[],
  ) {
    return this.taskAssignmentsService.bulkCreate(dtos);
  }

  @Patch(':id/status')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  updateStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAssignmentStatusSchema))
    dto: { status: string },
  ) {
    return this.taskAssignmentsService.updateStatus(id, dto.status);
  }

  @Patch(':id')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  update(
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.taskAssignmentsService.update(id, dto);
  }

  @Post('auto-complete')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  autoComplete(@Body() dto: { beforeDate: string }) {
    return this.taskAssignmentsService.autoCompletePastAssignments(
      dto.beforeDate,
    );
  }

  @Delete(':id')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  softDelete(@Param('id') id: string) {
    return this.taskAssignmentsService.softDelete(id);
  }
}
