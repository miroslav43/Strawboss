import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { TaskAssignmentsService } from './task-assignments.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createTaskAssignmentSchema,
  updateAssignmentStatusSchema,
  updateTaskAssignmentSchema,
} from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';
import { z } from 'zod';
import { todayInRomania } from '../common/date';

/** Query params for GET /my-tasks */
const myTasksQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});

const bulkCreateSchema = z.array(createTaskAssignmentSchema);

/** Body for POST /task-assignments/auto-complete */
const autoCompleteSchema = z.object({
  beforeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'beforeDate must be YYYY-MM-DD'),
});

@Controller('task-assignments')
export class TaskAssignmentsController {
  constructor(private readonly taskAssignmentsService: TaskAssignmentsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('assignmentDate') assignmentDate?: string,
    @Query('machineId') machineId?: string,
    @Query('assignedUserId') assignedUserId?: string,
    @Query('status') status?: string,
  ) {
    return this.taskAssignmentsService.list(user.organizationId, {
      assignmentDate,
      machineId,
      assignedUserId,
      status,
    });
  }

  @Get('board/:date')
  getBoard(@CurrentUser() user: RequestUser, @Param('date') date: string) {
    return this.taskAssignmentsService.getBoard(user.organizationId, date);
  }

  @Get('daily-plan/:date')
  getDailyPlan(@CurrentUser() user: RequestUser, @Param('date') date: string) {
    return this.taskAssignmentsService.getDailyPlan(user.organizationId, date);
  }

  @Get('by-machine-type/:date/:machineType')
  getByMachineType(
    @CurrentUser() user: RequestUser,
    @Param('date') date: string,
    @Param('machineType') machineType: string,
  ) {
    return this.taskAssignmentsService.getByMachineType(user.organizationId, date, machineType);
  }

  /**
   * Returns ONLY the task assignments for the authenticated operator on a given
   * date — filtered server-side by `assigned_user_id` OR by the machine
   * permanently linked to that user (`users.assigned_machine_id`).
   *
   * Query param: `date` (YYYY-MM-DD). Defaults to today in Romania's timezone.
   *
   * Response: flat array of task assignment rows with the same JOINed fields
   * (machineCode, machineType, parcelName, destinationName, …) that the mobile
   * `useMyTasks` hook already consumes from the daily-plan endpoint, so the
   * hook can switch to this endpoint with a trivial change.
   */
  @Get('my-tasks')
  @Roles(
    'admin' as UserRole,
    'dispatcher' as UserRole,
    'driver' as UserRole,
    'loader_operator' as UserRole,
    'baler_operator' as UserRole,
    'geofence_maker' as UserRole,
  )
  getMyTasks(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(myTasksQuerySchema)) query: { date?: string },
  ) {
    const date = query.date ?? todayInRomania();
    return this.taskAssignmentsService.getMyTasks(user.organizationId, user.id, date);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.taskAssignmentsService.findById(id, user.organizationId);
  }

  @Post()
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createTaskAssignmentSchema))
    dto: Record<string, unknown>,
  ) {
    return this.taskAssignmentsService.create(user.organizationId, dto);
  }

  @Post('bulk')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  bulkCreate(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(bulkCreateSchema))
    dtos: Record<string, unknown>[],
  ) {
    return this.taskAssignmentsService.bulkCreate(user.organizationId, dtos);
  }

  @Patch(':id/status')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateAssignmentStatusSchema))
    dto: { status: string },
  ) {
    return this.taskAssignmentsService.updateStatus(id, dto.status, user.organizationId);
  }

  /**
   * Operator-friendly: any operator (loader/baler/driver) can mark
   * THEIR OWN assignment as `in_progress`. Used by the loader app's
   * "Începe lucru pe parcela X" prompt.
   */
  @Post(':id/start')
  @Roles(
    'admin' as UserRole,
    'loader_operator' as UserRole,
    'baler_operator' as UserRole,
    'driver' as UserRole,
  )
  startByOperator(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.taskAssignmentsService.startByOperator(id, user.id, user.organizationId);
  }

  @Patch(':id')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  update(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateTaskAssignmentSchema))
    dto: Record<string, unknown>,
  ) {
    return this.taskAssignmentsService.update(id, user.organizationId, dto);
  }

  @Post('auto-complete')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  autoComplete(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(autoCompleteSchema)) dto: { beforeDate: string },
  ) {
    return this.taskAssignmentsService.autoCompletePastAssignments(
      user.organizationId,
      dto.beforeDate,
    );
  }

  @Delete(':id')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  softDelete(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.taskAssignmentsService.softDelete(id, user.organizationId);
  }
}
