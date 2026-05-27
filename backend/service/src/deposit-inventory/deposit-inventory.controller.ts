import { Controller, Get, Param } from '@nestjs/common';
import { DepositInventoryService } from './deposit-inventory.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';

@Controller('deposit-inventory')
export class DepositInventoryController {
  constructor(private readonly depositInventoryService: DepositInventoryService) {}

  /**
   * Plan C — depot list scoped to the caller's org. The mobile (deposit) tab
   * uses this to pick the depot when the user manages more than one.
   */
  @Get('depots')
  listDepots(@CurrentUser() user: RequestUser) {
    return this.depositInventoryService.listDepotsForOrg(
      user.organizationId,
      user.id,
      user.role,
    );
  }

  /**
   * Plan C — inventory + incoming trips for one depot.
   */
  @Get(':depotId')
  async getInventory(@Param('depotId') depotId: string, @CurrentUser() user: RequestUser) {
    await this.depositInventoryService.ensureUserCanAccessDepot(
      user.id,
      depotId,
      user.organizationId,
      user.role,
    );
    return this.depositInventoryService.getInventory(depotId, user.organizationId);
  }
}
