import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Logger,
  Req,
} from '@nestjs/common';
import { ParcelsService } from './parcels.service';
import { Roles } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createParcelSchema, updateParcelSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';

@Controller('parcels')
export class ParcelsController {
  private readonly logger = new Logger(ParcelsController.name);

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
  @Roles('admin' as UserRole)
  create(
    @Body(new ZodValidationPipe(createParcelSchema)) dto: Record<string, unknown>,
  ) {
    return this.parcelsService.create(dto);
  }

  @Patch(':id')
  @Roles('admin' as UserRole)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateParcelSchema)) dto: Record<string, unknown>,
  ) {
    return this.parcelsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin' as UserRole)
  async softDelete(@Param('id') id: string, @Req() req: { user?: { id: string; role: string } }) {
    this.logger.log(`DELETE /parcels/${id} — user: ${req.user?.id ?? 'anonymous'}, role: ${req.user?.role ?? 'none'}`);
    try {
      const result = await this.parcelsService.softDelete(id);
      this.logger.log(`DELETE /parcels/${id} — success`);
      return result;
    } catch (err) {
      this.logger.error(`DELETE /parcels/${id} — failed: ${(err as Error)?.message}`);
      throw err;
    }
  }
}
