import { Controller, Get, Post, Delete, Param, Body, Query } from '@nestjs/common';
import { z } from 'zod';
import { TripsService } from './trips.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  tripCreateDtoSchema,
  startLoadingSchema,
  completeLoadingSchema,
  departSchema,
  arriveSchema,
  startDeliverySchema,
  confirmDeliverySchema,
  confirmDepotDeliverySchema,
  completeSchema,
  cancelSchema,
  forceStatusSchema,
  disputeSchema,
  resolveDisputeSchema,
  registerLoadSchema,
  nextIterationDtoSchema,
} from '@strawboss/validation';
import type {
  UserRole,
  TripCreateDto,
  StartLoadingDto,
  CompleteLoadingDto,
  DepartDto,
  ArriveDto,
  StartDeliveryDto,
  ConfirmDeliveryDto,
  ConfirmDepotDeliveryDto,
  CompleteDto,
  CancelDto,
  ForceStatusDto,
  DisputeDto,
  ResolveDisputeDto,
  RegisterLoadDto,
} from '@strawboss/types';

@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('driverId') driverId?: string,
    @Query('truckId') truckId?: string,
    @Query('sourceParcelId') sourceParcelId?: string,
    @Query('loaderOperatorId') loaderOperatorId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    // Opt-in enrichment (?include=refs) — see TripsService.list() doc comment.
    // Not zod-validated: this endpoint has no query-schema today (all filters
    // are plain optional strings); `include` is treated the same way and is
    // only ever compared with strict equality against the literal 'refs'.
    @Query('include') include?: string,
  ) {
    return this.tripsService.list(user.organizationId, {
      status,
      driverId,
      truckId,
      sourceParcelId,
      loaderOperatorId,
      dateFrom,
      dateTo,
      include,
    });
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.tripsService.findById(id, user.organizationId);
  }

  @Post()
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(tripCreateDtoSchema)) dto: TripCreateDto,
  ) {
    return this.tripsService.create(user.organizationId, dto);
  }

  @Delete(':id')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  softDelete(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.tripsService.softDelete(id, user.organizationId, user.role as UserRole);
  }

  /**
   * Atomic loader entry point ("Camion plin" / register-load):
   * find or create the trip for (truck, today), insert a bale_load, and
   * transition the trip to `loaded`. Idempotent on `idempotencyKey`.
   */
  @Post('register-load')
  @Roles('admin' as UserRole, 'loader_operator' as UserRole)
  registerLoad(
    @Body(new ZodValidationPipe(registerLoadSchema)) dto: RegisterLoadDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tripsService.registerLoad(dto, user.id, user.organizationId);
  }

  /**
   * Auxiliary (external) trucks assigned to this loader, regardless of GPS/
   * distance. Rendered as loadable "AUX" cards in the mobile loader app.
   */
  @Get('auxiliary/at-loader/:loaderMachineId')
  @Roles('admin' as UserRole, 'loader_operator' as UserRole)
  auxiliaryAtLoader(
    @Param('loaderMachineId') loaderMachineId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tripsService.listAuxiliaryForLoader(loaderMachineId, user.organizationId);
  }

  @Post(':id/start-loading')
  @Roles('admin' as UserRole, 'loader_operator' as UserRole)
  startLoading(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(startLoadingSchema)) dto: StartLoadingDto,
  ) {
    return this.tripsService.startLoading(id, user.organizationId, dto);
  }

  @Post(':id/complete-loading')
  @Roles('admin' as UserRole, 'loader_operator' as UserRole)
  completeLoading(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(completeLoadingSchema)) dto: CompleteLoadingDto,
  ) {
    return this.tripsService.completeLoading(id, user.organizationId, dto);
  }

  @Post(':id/depart')
  @Roles('admin' as UserRole, 'driver' as UserRole)
  depart(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(departSchema)) dto: DepartDto,
  ) {
    return this.tripsService.depart(id, user.organizationId, dto);
  }

  @Post(':id/arrive')
  @Roles('admin' as UserRole, 'driver' as UserRole)
  arrive(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(arriveSchema)) dto: ArriveDto,
  ) {
    return this.tripsService.arrive(id, user.organizationId, dto);
  }

  @Post(':id/start-delivery')
  @Roles('admin' as UserRole, 'driver' as UserRole)
  startDelivery(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(startDeliverySchema)) dto: StartDeliveryDto,
  ) {
    return this.tripsService.startDelivery(id, user.organizationId, dto);
  }

  @Post(':id/confirm-delivery')
  @Roles('admin' as UserRole, 'driver' as UserRole)
  confirmDelivery(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(confirmDeliverySchema)) dto: ConfirmDeliveryDto,
  ) {
    return this.tripsService.confirmDelivery(id, user.organizationId, dto);
  }

  @Post(':id/confirm-depot-delivery')
  @Roles('admin' as UserRole, 'depot_manager' as UserRole)
  confirmDepotDelivery(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(confirmDepotDeliverySchema)) dto: ConfirmDepotDeliveryDto,
  ) {
    return this.tripsService.confirmDepotDelivery(id, user, dto);
  }

  @Post(':id/complete')
  @Roles('admin' as UserRole, 'driver' as UserRole)
  complete(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(completeSchema)) dto: CompleteDto,
  ) {
    return this.tripsService.complete(id, user.organizationId, dto);
  }

  @Post(':id/cancel')
  @Roles('admin' as UserRole)
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(cancelSchema)) dto: CancelDto,
  ) {
    return this.tripsService.cancel(id, user.organizationId, dto);
  }

  // Admin-only manual status override — bypasses the state machine.
  @Post(':id/force-status')
  @Roles('admin' as UserRole)
  forceStatus(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(forceStatusSchema)) dto: ForceStatusDto,
  ) {
    return this.tripsService.forceStatus(id, user.organizationId, dto);
  }

  @Post(':id/dispute')
  @Roles('admin' as UserRole)
  dispute(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(disputeSchema)) dto: DisputeDto,
  ) {
    return this.tripsService.dispute(id, user.organizationId, dto);
  }

  @Post(':id/set-destination')
  @Roles('admin' as UserRole, 'driver' as UserRole)
  setDestination(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(z.object({ destinationId: z.string().uuid() })))
    dto: { destinationId: string },
  ) {
    return this.tripsService.setDestination(id, user.organizationId, user.id, dto);
  }

  @Post(':id/resolve-dispute')
  @Roles('admin' as UserRole)
  resolveDispute(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(resolveDisputeSchema)) dto: ResolveDisputeDto,
  ) {
    return this.tripsService.resolveDispute(id, user.organizationId, dto);
  }

  /**
   * Plan C — create the next iteration of a multi-trip course.
   * Same parcel / truck / driver / loader; iteration_index auto-increments.
   * `recall=true` pushes the new trip to the driver.
   *
   * Admin-only manual override. Loaders answer the recall prompt via
   * POST /notifications/loader-recall-response, which enforces trip ownership
   * (loader_operator_id === caller) and idempotency before delegating here —
   * this route must not be reachable by loader_operator directly, or any
   * loader could fork someone else's trip regardless of status/ownership.
   */
  @Post(':id/next-iteration')
  @Roles('admin' as UserRole)
  nextIteration(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(nextIterationDtoSchema))
    dto: { recall: boolean; truckId?: string },
  ) {
    return this.tripsService.createNextIteration(id, user.organizationId, dto.recall);
  }
}
