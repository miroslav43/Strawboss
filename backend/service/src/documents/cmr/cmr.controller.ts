import { Controller, Post, Param } from '@nestjs/common';
import { Roles } from '../../auth/roles.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { UserRole } from '@strawboss/types';
import type { RequestUser } from '../../auth/auth.guard';
import { CmrService } from './cmr.service';

@Controller('trips')
export class CmrController {
  constructor(private readonly cmrService: CmrService) {}

  @Post(':tripId/generate-cmr')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  generateCmr(
    @Param('tripId') tripId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.cmrService.generateCmr(tripId, user.organizationId!);
  }
}
