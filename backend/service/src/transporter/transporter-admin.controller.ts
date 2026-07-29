import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  ParseUUIDPipe,
  ForbiddenException,
} from '@nestjs/common';
import { TransporterAssignmentsService } from './transporter-assignments.service';
import { Roles, CurrentUser, type RequestUser } from '../auth';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { UserRole } from '@strawboss/types';
import { setTransporterBeneficiariesSchema } from '@strawboss/validation';
import type { SetTransporterBeneficiariesInput } from '@strawboss/validation';
import { RequireFeature } from '../features/require-feature.decorator';

/**
 * Admin management of which beneficiaries a transporter account may act for.
 *
 * Lives on the `admin/users` surface (a second controller for that base path is
 * fine in Nest — routes never collide) so the admin API stays cohesive, while the
 * assignment logic stays in the transporter module (no AdminUsersModule coupling).
 * `@Roles(admin)` — the roles guard has no super_admin bypass, so super-admins do
 * not manage assignments here (deferred by design).
 */
@Controller('admin/users')
@Roles(UserRole.admin)
export class TransporterAdminController {
  constructor(private readonly assignments: TransporterAssignmentsService) {}

  private requireOrg(user: RequestUser): string {
    if (!user.organizationId) throw new ForbiddenException('No organization');
    return user.organizationId;
  }

  @Get(':id/beneficiaries')
  list(@CurrentUser() user: RequestUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.assignments.listBeneficiaryIds(this.requireOrg(user), id);
  }

  @Put(':id/beneficiaries')
  @RequireFeature('portals.transporter_role')
  async set(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(setTransporterBeneficiariesSchema))
    dto: SetTransporterBeneficiariesInput,
  ) {
    await this.assignments.setBeneficiaries(this.requireOrg(user), id, dto.beneficiaryIds);
    return { ok: true };
  }
}
