import { z } from 'zod';
import { FEATURE_KEYS, FEATURES, type FeatureKey } from '@strawboss/types';

/**
 * Validation for the super-admin feature-toggle write path.
 *
 * ── WHY `z.enum` IS SAFE HERE AND NOWHERE ELSE ────────────────────────────
 *
 * This schema guards `PUT /super-admin/organizations/:orgId/features`, whose
 * only caller is the super-admin console served from the same deploy. Strict
 * key validation is exactly right there: a typo'd key would otherwise be stored
 * forever as a silently-inert override.
 *
 * It must NOT be reused on anything a CLIENT sends. A phone running an older
 * APK, or a backend that got rolled back one release, would hold a different
 * FEATURE_KEYS list — and `ZodValidationPipe` turns an unknown key into a 400,
 * i.e. a hard failure at precisely the boundary that is supposed to degrade
 * gracefully. Read paths ship `disabled: string[]` and tolerate the unknown.
 */
export const featureKeySchema = z.enum(FEATURE_KEYS);

/**
 * Sparse override map. `.partial()`-style by construction: absent key = use the
 * registry default. Callers may send `true` explicitly; the service normalises
 * such entries away so storage stays canonical (`{}` = pure defaults).
 */
export const featureOverridesSchema = z.record(featureKeySchema, z.boolean());

export const updateOrgFeaturesSchema = z
  .object({
    featureOverrides: featureOverridesSchema,
    /**
     * Which preset button was pressed, for display in the org list. Nullable to
     * clear it after a manual edit that no longer matches any preset.
     */
    planLabel: z.string().max(64).nullable().optional(),
    /**
     * Mandatory. `organizations` is not covered by the audit trigger and the
     * audit interceptor is never bound, so without this the only record of a
     * cross-tenant kill-switch is the row we write in
     * `organization_feature_changes`.
     */
    reason: z.string().trim().min(3).max(500),
  })
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value.featureOverrides) as FeatureKey[]) {
      // `roles` exists only as a dependency anchor. A master switch there would
      // read as "no new accounts of any kind", which is never what an operator
      // means — and because every roles.* leaf depends on it, flipping it would
      // block account creation platform-wide for that org in one click.
      if (!FEATURES[key].uiSwitch) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['featureOverrides', key],
          message: `Feature '${key}' is not switchable`,
        });
        continue;
      }

      // Refuse to store an override nothing consumes yet. A toggle that
      // silently does nothing is worse than an absent one — the operator
      // switches something off, sees no effect, and stops trusting the whole
      // console. Drop this check per key as each module gets wired.
      if (!FEATURES[key].wired) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['featureOverrides', key],
          message: `Feature '${key}' is not implemented yet`,
        });
      }
    }
  });

export type UpdateOrgFeaturesInput = z.infer<typeof updateOrgFeaturesSchema>;
