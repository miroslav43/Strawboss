import type { FeatureKey } from '../features.js';
import type { User } from '../entities/user.js';

/**
 * What `GET /api/v1/profile` returns.
 *
 * Deliberately a separate interface rather than widening `User`: the `User`
 * shape is reused by the admin-users and super-admin-users list projections,
 * which select fewer columns and know nothing about features. Widening it there
 * would be a type lie on every one of those endpoints.
 */
export interface ProfileResponse extends User {
  features: ResolvedFeatures;
}

/**
 * The DISABLED keys only — never the full effective map.
 *
 * Three reasons this is the wire format:
 *   1. Tiny. Almost always `[]`, and bounded by how much an org actually
 *      switched off rather than by how big the registry has grown.
 *   2. Fail-open is structural: a client that never received this (offline cold
 *      boot, a request that failed) sees `[]` and behaves fully enabled. There
 *      is no "assume enabled" branch anyone can forget to write.
 *   3. Forward compatible: an APK from three releases ago simply does not
 *      recognise newer keys, and `isFeatureEnabled` treats unknown as enabled.
 */
export interface ResolvedFeatures {
  disabled: FeatureKey[];
}
