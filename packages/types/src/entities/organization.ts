import type { Timestamps, SoftDelete } from '../common.js';
import type { FeatureOverrides } from '../features.js';
import type { CropType } from './parcel.js';

export interface Organization extends Timestamps, SoftDelete {
  id: string;
  slug: string;
  name: string;
  /** 4-digit code gating the public request portal (/<slug>/request). Null until set. */
  requestAccessCode: string | null;
  /** Subset of CropType the request portal offers; empty = portal not configured. */
  allowedCropTypes: CropType[];
}

export interface CreateOrganizationDto {
  slug: string;
  name: string;
}

/** Admin-editable request-portal settings for the caller's own organization. */
export interface OrgRequestSettings {
  requestAccessCode: string | null;
  allowedCropTypes: CropType[];
}

/**
 * Super-admin view of one organization's feature toggles.
 *
 * Deliberately NOT folded into `Organization`: `ORG_COLS` in
 * organizations.service.ts is a hardcoded projection that does not select these
 * columns, so declaring them on `Organization` would make every `list()` and
 * `findById()` response a type lie.
 */
export interface OrgFeatureSettings {
  /** SPARSE — only deviations from the registry defaults. Usually `{}`. */
  featureOverrides: FeatureOverrides;
  /** Which preset button was last pressed. Display only; no code branches on it. */
  planLabel: string | null;
  /**
   * Live count of non-deleted, active accounts per role, so the console can warn
   * "3 conturi active pe acest rol" before an operator switches a role off.
   * Role toggles are grandfathered — existing accounts keep working — but the
   * operator should still see what they are about to affect.
   */
  activeUsersByRole: Record<string, number>;
}

/** Payload for `PUT /super-admin/organizations/:orgId/features`. */
export interface UpdateOrgFeaturesDto {
  featureOverrides: FeatureOverrides;
  planLabel?: string | null;
  /** Mandatory audit note — `organizations` has no audit trigger. */
  reason: string;
}
