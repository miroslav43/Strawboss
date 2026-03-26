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
import { createTaskAssignmentSchema } from '@strawboss/validation';
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
  ) {
    return this.taskAssignmentsService.list({
      assignmentDate,
      machineId,
      assignedUserId,
    });
  }

  @Get('board/:date')
  getBoard(@Param('date') date: string) {
    return this.taskAssignmentsService.getBoard(date);
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

  @Patch(':id')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  update(
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.taskAssignmentsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  softDelete(@Param('id') id: string) {
    return this.taskAssignmentsService.softDelete(id);
  }
}
