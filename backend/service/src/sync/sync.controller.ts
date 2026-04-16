import {
  Controller,
  Post,
  Get,
  Body,
} from '@nestjs/common';
import { SyncService } from './sync.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import type { SyncPushRequest, SyncPullRequest } from '@strawboss/types';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  async push(
    @Body() body: SyncPushRequest,
    @CurrentUser() user: RequestUser,
  ) {
    const results = await this.syncService.push(body.mutations, user.id);
    return {
      results,
      serverTime: new Date().toISOString(),
    };
  }

  @Post('pull')
  pull(
    @Body() body: SyncPullRequest,
    @CurrentUser() user: RequestUser,
  ) {
    return this.syncService.pull(body.tables, user.id);
  }

  @Get('status')
  status(@CurrentUser() user: RequestUser) {
    return this.syncService.status(user.id);
  }
}
