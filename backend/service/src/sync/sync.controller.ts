import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
} from '@nestjs/common';
import { SyncService } from './sync.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
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

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  async push(
    @Body() body: SyncPushRequest,
    @CurrentUser() user: RequestUser,
  ) {
    const results = await this.syncService.push(body.mutations, user.id, user.organizationId);
    return {
      results,
      serverTime: new Date().toISOString(),
    };
  }

  @Post('pull')
  pull(
    @Body() body: SyncPullRequest,
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
