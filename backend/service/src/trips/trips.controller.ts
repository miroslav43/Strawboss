import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
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
  completeSchema,
  cancelSchema,
  disputeSchema,
  resolveDisputeSchema,
  registerLoadSchema,
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
  CompleteDto,
  CancelDto,
  DisputeDto,
  ResolveDisputeDto,
  RegisterLoadDto,
} from '@strawboss/types';

@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('driverId') driverId?: string,
    @Query('truckId') truckId?: string,
    @Query('sourceParcelId') sourceParcelId?: string,
    @Query('loaderOperatorId') loaderOperatorId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.tripsService.list({
      status,
      driverId,
      truckId,
      sourceParcelId,
      loaderOperatorId,
      dateFrom,
      dateTo,
    });
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.tripsService.findById(id);
  }

  @Post()
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  create(
    @Body(new ZodValidationPipe(tripCreateDtoSchema)) dto: TripCreateDto,
  ) {
    return this.tripsService.create(dto);
  }

  @Delete(':id')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  softDelete(@Param('id') id: string) {
    return this.tripsService.softDelete(id);
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
    return this.tripsService.registerLoad(dto, user.id);
  }

  @Post(':id/start-loading')
  @Roles('admin' as UserRole, 'loader_operator' as UserRole)
  startLoading(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(startLoadingSchema)) dto: StartLoadingDto,
  ) {
    return this.tripsService.startLoading(id, dto);
  }

  @Post(':id/complete-loading')
  @Roles('admin' as UserRole, 'loader_operator' as UserRole)
  completeLoading(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeLoadingSchema)) dto: CompleteLoadingDto,
  ) {
    return this.tripsService.completeLoading(id, dto);
  }

  @Post(':id/depart')
  @Roles('admin' as UserRole, 'driver' as UserRole)
  depart(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(departSchema)) dto: DepartDto,
  ) {
    return this.tripsService.depart(id, dto);
  }

  @Post(':id/arrive')
  @Roles('admin' as UserRole, 'driver' as UserRole)
  arrive(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(arriveSchema)) dto: ArriveDto,
  ) {
    return this.tripsService.arrive(id, dto);
  }

  @Post(':id/start-delivery')
  @Roles('admin' as UserRole, 'driver' as UserRole)
  startDelivery(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(startDeliverySchema)) dto: StartDeliveryDto,
  ) {
    return this.tripsService.startDelivery(id, dto);
  }

  @Post(':id/confirm-delivery')
  @Roles('admin' as UserRole, 'driver' as UserRole)
  confirmDelivery(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmDeliverySchema)) dto: ConfirmDeliveryDto,
  ) {
    return this.tripsService.confirmDelivery(id, dto);
  }

  @Post(':id/complete')
  @Roles('admin' as UserRole, 'driver' as UserRole)
  complete(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeSchema)) dto: CompleteDto,
  ) {
    return this.tripsService.complete(id, dto);
  }

  @Post(':id/cancel')
  @Roles('admin' as UserRole)
  cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelSchema)) dto: CancelDto,
  ) {
    return this.tripsService.cancel(id, dto);
  }

  @Post(':id/dispute')
  @Roles('admin' as UserRole)
  dispute(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(disputeSchema)) dto: DisputeDto,
  ) {
    return this.tripsService.dispute(id, dto);
  }

  @Post(':id/resolve-dispute')
  @Roles('admin' as UserRole)
  resolveDispute(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveDisputeSchema)) dto: ResolveDisputeDto,
  ) {
    return this.tripsService.resolveDispute(id, dto);
  }
}
