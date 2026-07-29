import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '@strawboss/types';

export const REQUIRE_FEATURE_KEY = 'requireFeature';

/**
 * Gate a WRITE endpoint behind one or more feature keys.
 *
 * Same `SetMetadata` + `Reflector.getAllAndOverride` shape as `@Roles`/`@Public`
 * so it composes with them and can be applied per-method or per-controller.
 *
 * ── RULES ─────────────────────────────────────────────────────────────────
 *
 * 1. WRITES ONLY (`@Post`/`@Put`/`@Patch`/`@Delete`). Gating a `@Get` would
 *    make historical data unreachable and break aggregate reports for an org
 *    that merely stopped using a feature.
 *
 * 2. Gate by the endpoint's REAL PATH, not by which module conceptually owns
 *    the data. `register_load`, for instance, is served by TripsController at
 *    `POST /trips/register-load`, not by BaleLoadsController — decorating the
 *    latter alone would leave every phone in the fleet writing freely while the
 *    admin UI showed the feature as off.
 *
 * 3. `FeatureKey` is a union, so a typo here is a compile error rather than an
 *    endpoint that is silently always enabled.
 *
 * Coverage is enforced mechanically: a test enumerates every write route and
 * asserts it is either decorated or on an explicit CORE allowlist.
 */
export const RequireFeature = (...features: FeatureKey[]) =>
  SetMetadata(REQUIRE_FEATURE_KEY, features);
