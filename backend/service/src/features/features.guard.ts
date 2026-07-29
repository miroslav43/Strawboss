import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isFeatureEnabled, type FeatureKey } from '@strawboss/types';
import type { RequestUser } from '../auth/auth.guard';
import { REQUIRE_FEATURE_KEY } from './require-feature.decorator';
import { FeatureDisabledException } from './feature-disabled.exception';

/**
 * Third global guard, registered AFTER AuthGuard and RolesGuard.
 *
 * It is deliberately synchronous and injects only `Reflector`: the flags were
 * already resolved by AuthGuard, which folded `organizations.feature_overrides`
 * into the users/organizations join it runs on every authenticated request. So
 * this guard costs one array lookup and no I/O.
 *
 * It must not inject anything request-scoped — a request-scoped global guard is
 * appended after the static ones and would silently change the execution order
 * this guard depends on.
 */
@Injectable()
export class FeaturesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<FeatureKey[] | undefined>(
      REQUIRE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;

    /*
     * No user means an `@Public()` route: AuthGuard returns before setting
     * `request.user`, so the organization is simply not knowable here — it is
     * resolved later inside the service, from a slug or a one-time token.
     *
     * Fail OPEN rather than throwing, and enforce there instead via
     * `FeaturesService.assertEnabledForOrg`. Throwing here would break every
     * public route the moment someone added the decorator by reflex, while
     * still not actually gating the ones that matter.
     */
    if (!user) return true;

    /*
     * super_admin has `organizationId === null` and therefore no flags of its
     * own. It is confined to org-management endpoints by RolesGuard (which has
     * no super_admin bypass), so this is not a hole — it is what lets the
     * console keep working for an org that has switched things off.
     */
    if (user.role === 'super_admin') return true;

    const disabled = user.disabledFeatures ?? [];
    for (const feature of required) {
      if (!isFeatureEnabled(disabled, feature)) throw new FeatureDisabledException(feature);
    }
    return true;
  }
}
