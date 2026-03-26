import { Controller, Post, Param } from '@nestjs/common';
import { Roles } from '../../auth/roles.guard';
import type { UserRole } from '@strawboss/types';
import { CmrService } from './cmr.service';

@Controller('trips')
export class CmrController {
  constructor(private readonly cmrService: CmrService) {}

  @Post(':tripId/generate-cmr')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  generateCmr(@Param('tripId') tripId: string) {
    return this.cmrService.generateCmr(tripId);
  }
}
