import {
  Controller,
  Post,
  Get,
  Body,
  Query,
} from '@nestjs/common';
import { SyncService } from './sync.service';
import type { SyncPushRequest, SyncPullRequest } from '@strawboss/types';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  async push(@Body() body: SyncPushRequest) {
    const results = await this.syncService.push(body.mutations);
    return {
      results,
      serverTime: new Date().toISOString(),
    };
  }

  @Post('pull')
  pull(@Body() body: SyncPullRequest) {
    return this.syncService.pull(body.tables);
  }

  @Get('status')
  status(@Query('clientId') clientId: string) {
    return this.syncService.status(clientId);
  }
}
