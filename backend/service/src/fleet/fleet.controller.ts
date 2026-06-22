import { Controller, Post, Body } from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { deviceCheckinSchema, type DeviceCheckinInput } from '@strawboss/validation';
import { FleetService } from './fleet.service';

/**
 * Public check-in endpoint — no auth required.
 * Devices present a deviceToken (HMAC) to prove identity; first call registers.
 */
@Controller('fleet')
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  /** POST /api/v1/fleet/checkin */
  @Post('checkin')
  @Public()
  checkin(@Body(new ZodValidationPipe(deviceCheckinSchema)) dto: DeviceCheckinInput) {
    return this.fleetService.checkin(dto);
  }
}
