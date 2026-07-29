import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PinThrottleService } from './pin-throttle.service';

/**
 * Applied to the public arrival-CMR routes (`GET`/`POST /public/cmr/:token`).
 *
 * Its predecessor, `/public/sign/:token`, shipped with ZERO throttling despite
 * being a bearer-token URL in a place access logs and referrers can see it.
 * This closes that gap using the exact mechanism the beneficiary PIN portal
 * already has, rather than inventing a second one.
 *
 * `PinThrottleService`'s two string keys (`orgSlug`, `beneficiarySlug`) are
 * opaque Redis-key components, not semantically tied to those names, so a
 * fixed namespace + the token slot in unchanged. The per-IP counter
 * (`pin:ip:<ip>`) ends up SHARED with the PIN portal by consequence — both are
 * anonymous public surfaces, and a combined per-IP request budget across them
 * is a reasonable default, not a bug.
 */
@Injectable()
export class TokenThrottleGuard implements CanActivate {
  private static readonly NAMESPACE = 'cmr-token';

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
    // sent, so its *first* hop is attacker-controlled. Prefer X-Real-IP; fall
    // back to the *last* XFF hop (nginx's own append) only if it's absent.
    const realIp = req.headers?.['x-real-ip'];
    const xff = req.headers?.['x-forwarded-for'];
    const xffLastHop = typeof xff === 'string' ? xff.split(',').pop()?.trim() : undefined;
    const ip =
      (typeof realIp === 'string' ? realIp.trim() : undefined) || xffLastHop || req.ip || 'unknown';
    await this.throttle.assertAllowed(TokenThrottleGuard.NAMESPACE, params.token ?? '', ip);
    return true;
  }
}
