import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { UserRole, type OrgFeatureSettings, type UpdateOrgFeaturesDto } from '@strawboss/types';
import { updateOrgFeaturesSchema } from '@strawboss/validation';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { OrganizationsService } from '../organizations/organizations.service';
import { FeaturesService } from './features.service';

/**
 * Super-admin control surface for one organization's feature toggles.
 *
 * ── WHY A DEDICATED CONTROLLER ────────────────────────────────────────────
 *
 * `RolesGuard` treats an endpoint with NO `@Roles` as open to every
 * authenticated role, and `OrganizationsController` carries no class-level
 * decorator — every method declares its own. Adding these two routes there
 * would put a cross-tenant kill-switch one forgotten decorator away from being
 * callable by any driver on any fleet phone. A dedicated controller with a
 * class-level `@Roles(super_admin)` makes that impossible to get wrong.
 *
 * ── WHY :orgId COMES FROM THE URL ─────────────────────────────────────────
 *
 * A super_admin has `organizationId === null` in its session — it lives outside
 * every org, and RolesGuard has no super_admin bypass onto org-scoped routes.
 * So the target org must be named explicitly in the path, exactly as
 * `SuperAdminUsersController` does. A `me/features` route could never work.
 */
@Controller('super-admin/organizations/:orgId/features')
@Roles(UserRole.super_admin)
export class SuperAdminFeaturesController {
  constructor(
    private readonly featuresService: FeaturesService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  /**
   * GET /api/v1/super-admin/organizations/:orgId/features
   *
   * Returns the RAW overrides, not the resolved set: the console renders the
   * registry tree and computes the closure client-side so the operator sees a
   * live preview of what a switch cascades to before saving.
   */
  @Get()
  async get(
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
  ): Promise<OrgFeatureSettings & { changes: unknown[] }> {
    // 404 on an unknown or soft-deleted org before touching anything else.
    await this.organizationsService.findById(orgId);
    const settings = await this.featuresService.getSettings(orgId);
    return { ...settings, changes: await this.featuresService.listChanges(orgId) };
  }

  /** PUT /api/v1/super-admin/organizations/:orgId/features */
  @Put()
  async update(
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Body(new ZodValidationPipe(updateOrgFeaturesSchema)) dto: UpdateOrgFeaturesDto,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<OrgFeatureSettings> {
    await this.organizationsService.findById(orgId);
    return this.featuresService.setOverrides(orgId, dto, {
      userId: currentUser.id,
      role: currentUser.role,
    });
  }
}
