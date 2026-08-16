import { Controller, Get, Param } from '@nestjs/common';
import { DepositInventoryService } from './deposit-inventory.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '@strawboss/types';
import { SeasonsService } from '../seasons/seasons.service';

@Controller('deposit-inventory')
export class DepositInventoryController {
  constructor(
    private readonly depositInventoryService: DepositInventoryService,
    private readonly seasons: SeasonsService,
  ) {}

  /**
   * Plan C — depot list scoped to the caller's org. The mobile (deposit) tab
   * uses this to pick the depot when the user manages more than one.
   */
  @Get('depots')
  @Roles(UserRole.admin, UserRole.dispatcher, UserRole.depot_manager, UserRole.driver)
  listDepots(@CurrentUser() user: RequestUser) {
    return this.depositInventoryService.listDepotsForOrg(user.organizationId, user.id, user.role);
  }

  /**
   * Plan C — inventory + incoming trips for one depot.
   */
  @Get(':depotId')
  @Roles(UserRole.admin, UserRole.dispatcher, UserRole.depot_manager, UserRole.driver)
  async getInventory(@Param('depotId') depotId: string, @CurrentUser() user: RequestUser) {
    await this.depositInventoryService.ensureUserCanAccessDepot(
      user.id,
      depotId,
      user.organizationId,
      user.role,
    );
    // Deliberately the ACTIVE season, never a caller-supplied one: this is the
    // depot operator's working screen, not a report. The season selector is an
    // admin reporting affordance and must not be able to change what the person
    // standing in the depot sees.
    return this.depositInventoryService.getInventory(
      depotId,
      user.organizationId,
      this.seasons.resolveYear(user.organizationId, user.activeSeasonYear),
    );
  }
}
