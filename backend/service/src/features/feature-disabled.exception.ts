import { ForbiddenException } from '@nestjs/common';
import type { FeatureKey } from '@strawboss/types';

/** Stable discriminator clients branch on. Never change this string. */
export const FEATURE_DISABLED_CODE = 'FEATURE_DISABLED';

/**
 * Thrown when an organization tries to WRITE through a feature it has switched
 * off. Reads are never gated — history and reports must keep working.
 *
 * The explicit `message` is load-bearing, not decoration: AllExceptionsFilter
 * replaces a missing message on any sub-500 response with the generic
 * 'Cerere invalidă.', which would leave an operator staring at "invalid
 * request" for a perfectly valid action. That filter also had to be taught to
 * hoist `code`/`feature`, since it assembles the reply from a fixed field set
 * and drops anything else.
 */
export class FeatureDisabledException extends ForbiddenException {
  constructor(feature: FeatureKey) {
    super({
      statusCode: 403,
      error: 'Forbidden',
      code: FEATURE_DISABLED_CODE,
      feature,
      message: `Funcționalitatea '${feature}' este dezactivată pentru această organizație.`,
    });
  }
}
