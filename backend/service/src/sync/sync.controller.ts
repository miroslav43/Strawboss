import { Controller, Post, Get, Body, Headers } from '@nestjs/common';
import { UserRole } from '@strawboss/types';
import { SyncService } from './sync.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import type { RequestUser } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { syncPushRequestSchema, syncPullRequestSchema } from '@strawboss/validation';
import type { SyncPushRequest, SyncPullRequest } from '@strawboss/types';

/**
 * Parses the `X-Sync-Caps` request header (comma-separated capability tokens)
 * and returns whether the caller declared support for tombstone deletions.
 * Old mobile binaries omit the header → returns false → server keeps today's
 * legacy response shape and behaviour.
 */
function callerSupportsTombstones(headerValue?: string): boolean {
  if (!headerValue) return false;
  return headerValue
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes('tombstones-v1');
}

// Operational (mobile) roles only — dispatch/ops staff who work inside a
// single organization's sync data. super_admin is deliberately excluded:
// per the roles.guard.ts convention it must not reach org-scoped operational
// endpoints. SyncService still carries an explicit super_admin check as a
// defense-in-depth layer in case this list ever regresses.
@Roles(
  UserRole.driver,
  UserRole.loader_operator,
  UserRole.baler_operator,
  UserRole.depot_manager,
  UserRole.dispatcher,
  UserRole.admin,
)
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  async push(
    @Body(new ZodValidationPipe(syncPushRequestSchema)) body: SyncPushRequest,
    @CurrentUser() user: RequestUser,
  ) {
    const results = await this.syncService.push(
      body.mutations,
      user.id,
      user.organizationId,
      user.role,
    );
    return {
      results,
      serverTime: new Date().toISOString(),
    };
  }

  @Post('pull')
  pull(
    @Body(new ZodValidationPipe(syncPullRequestSchema)) body: SyncPullRequest,
    @CurrentUser() user: RequestUser,
    @Headers('x-sync-caps') caps?: string,
  ) {
    return this.syncService.pull(
      body.tables,
      user.id,
      user.organizationId,
      callerSupportsTombstones(caps),
      user.role,
    );
  }

  @Get('status')
  status(@CurrentUser() user: RequestUser) {
    return this.syncService.status(user.id);
  }
}
