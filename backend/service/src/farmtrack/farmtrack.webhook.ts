import { Controller, Post, Body } from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Controller('farmtrack')
export class FarmTrackWebhookController {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  /**
   * Public webhook endpoint for FarmTrack to push events.
   * No auth required — FarmTrack sends events as they occur.
   */
  @Public()
  @Post('webhook')
  async receiveWebhook(@Body() payload: Record<string, unknown>) {
    const eventType = (payload.event_type as string) ?? 'unknown';
    const deviceId = (payload.device_id as string) ?? null;
    const timestamp = (payload.timestamp as string) ?? new Date().toISOString();

    await this.drizzleProvider.db.execute(
      sql`INSERT INTO farmtrack_events (
        event_type, device_id, payload, received_at
      ) VALUES (
        ${eventType}, ${deviceId},
        ${JSON.stringify(payload)}::jsonb, ${timestamp}
      )`,
    );

    return { status: 'received' };
  }
}
