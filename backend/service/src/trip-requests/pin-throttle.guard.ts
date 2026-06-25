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
    // Behind nginx the socket IP is the proxy; use the first X-Forwarded-For hop
    // (same convention as logging.interceptor / audit.interceptor).
    const xff = req.headers?.['x-forwarded-for'];
    const ip =
      (typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined) || req.ip || 'unknown';
    await this.throttle.assertAllowed(params.slug ?? '', params.beneficiarySlug ?? '', ip);
    return true;
  }
}
