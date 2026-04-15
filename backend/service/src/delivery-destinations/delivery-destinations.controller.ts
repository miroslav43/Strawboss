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
import { DeliveryDestinationsService } from './delivery-destinations.service';
import { Roles } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createDeliveryDestinationSchema,
  updateDeliveryDestinationSchema,
} from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';

@Controller('delivery-destinations')
export class DeliveryDestinationsController {
  constructor(private readonly service: DeliveryDestinationsService) {}

  @Get()
  list(@Query('isActive') isActive?: string) {
    const filters: { isActive?: boolean } = {};
    if (isActive === 'true') filters.isActive = true;
    if (isActive === 'false') filters.isActive = false;
    return this.service.list(filters);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin' as UserRole)
  create(
    @Body(new ZodValidationPipe(createDeliveryDestinationSchema))
    dto: Record<string, unknown>,
  ) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin' as UserRole)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDeliveryDestinationSchema))
    dto: Record<string, unknown>,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin' as UserRole)
  softDelete(@Param('id') id: string) {
    return this.service.softDelete(id);
  }
}
