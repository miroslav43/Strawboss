import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PinThrottleService } from './pin-throttle.service';

/**
 * Applied to the public beneficiary PIN routes (verify + submit). Rejects with 429
 * when the beneficiary is locked out or the caller's IP is over its request cap,
 * before the handler ever reads the PIN.
 */
@Injectable()
export class PinThrottleGuard implements CanActivate {
  constructor(private readonly throttle: PinThrottleService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      params?: Record<string, string>;
      ip?: string;
      headers?: Record<string, unknown>;
    }>();
    const params = req.params ?? {};
    // Behind nginx the socket IP is the proxy. X-Real-IP is always set to
    // $remote_addr by nginx and is never client-controlled; X-Forwarded-For is
    // $proxy_add_x_forwarded_for, which APPENDS to whatever the client already
    // sent, so its *first* hop is attacker-controlled and could otherwise be
    // spoofed to reset this per-IP PIN throttle. Prefer X-Real-IP; fall back to
    // the *last* XFF hop (nginx's own append) only if it's absent.
    const realIp = req.headers?.['x-real-ip'];
    const xff = req.headers?.['x-forwarded-for'];
    const xffLastHop = typeof xff === 'string' ? xff.split(',').pop()?.trim() : undefined;
    const ip =
      (typeof realIp === 'string' ? realIp.trim() : undefined) || xffLastHop || req.ip || 'unknown';
    await this.throttle.assertAllowed(params.slug ?? '', params.beneficiarySlug ?? '', ip);
    return true;
  }
}
