import { Controller, Get, Post, Param, Query, ForbiddenException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { Roles, CurrentUser, type RequestUser } from '../auth';
import { UserRole } from '@strawboss/types';

@Controller('messages')
export class MessagesController {
  constructor(private readonly service: MessagesService) {}

  private requireOrg(user: RequestUser): string {
    if (!user.organizationId) throw new ForbiddenException('No organization');
    return user.organizationId;
  }

  @Get()
  @Roles(UserRole.admin, UserRole.dispatcher)
  list(
    @CurrentUser() user: RequestUser,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list(this.requireOrg(user), { channel, status });
  }

  @Post(':id/retry')
  @Roles(UserRole.admin, UserRole.dispatcher)
  retry(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.retry(this.requireOrg(user), id);
  }
}
