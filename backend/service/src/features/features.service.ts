import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  FEATURES,
  resolveDisabledFeatures,
  isFeatureEnabled,
  type FeatureKey,
  type FeatureOverrides,
  type OrgFeatureSettings,
  type UpdateOrgFeaturesDto,
} from '@strawboss/types';
import { DrizzleProvider } from '../database/drizzle.provider';
import { FeaturesCacheService } from './features-cache.service';
import { FeatureDisabledException } from './feature-disabled.exception';

/** Matches the repo convention for kill-switches: default ON, opt out with 'false'. */
const KILL_SWITCH_ENV = 'STRAWBOSS_ORG_FEATURE_FLAGS_ENABLED';

/** Per-org resolved-flag cache TTL, mirroring AuthGuard's user-context TTL. */
const ORG_CACHE_TTL_MS = 60_000;

interface ActorContext {
  userId: string | null;
  role: string | null;
}

@Injectable()
export class FeaturesService implements OnModuleInit {
  private readonly logger = new Logger(FeaturesService.name);

  /**
   * Resolved disabled-key lists for callers that have no `request.user` — the
   * device-token check-in path and the public portal routes. Requests that DO
   * carry a user get their flags from AuthGuard's context cache instead, at
   * zero extra queries.
   */
  private readonly orgCache = new Map<
    string,
    { at: number; gen: number; disabled: FeatureKey[] }
  >();

  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly featuresCache: FeaturesCacheService,
  ) {}

  onModuleInit() {
    // Answer "is the flag system actually on in this deploy?" from logs/web/
    // rather than by guessing. The env var must also be declared in
    // docker-stack.yml — a `docker service update --env-add` alone is silently
    // reverted by the next `docker stack deploy`.
    this.logger.log(
      `Per-org feature flags: ${this.enabled ? 'ENABLED' : 'DISABLED (kill-switch)'} (${KILL_SWITCH_ENV})`,
    );
  }

  /**
   * Master kill-switch. When off, every org resolves to zero disabled features —
   * i.e. the whole system degrades to "everything enabled", which is the state
   * that existed before this feature shipped. Never the reverse.
   */
  get enabled(): boolean {
    return process.env[KILL_SWITCH_ENV] !== 'false';
  }

  /** Generation token for cross-replica invalidation; see FeaturesCacheService. */
  cacheGeneration(): number {
    return this.featuresCache.currentGeneration();
  }

  /**
   * Registry defaults <- stored overrides <- dependency closure, with the
   * kill-switch short-circuit. AuthGuard calls this with the overrides it
   * already fetched in its existing users/organizations join.
   */
  resolve(overrides: FeatureOverrides | null | undefined): FeatureKey[] {
    if (!this.enabled) return [];
    return resolveDisabledFeatures(overrides ?? {});
  }

  /**
   * Disabled keys for an org, for callers with no authenticated user attached.
   * Cached per org with the same TTL + generation invalidation as AuthGuard, so
   * ~30 phones checking in every 60s do not each cost a query.
   */
  async getDisabledForOrg(orgId: string): Promise<FeatureKey[]> {
    if (!this.enabled) return [];

    const gen = this.featuresCache.currentGeneration();
    const now = Date.now();
    const cached = this.orgCache.get(orgId);
    if (cached && cached.gen === gen && now - cached.at < ORG_CACHE_TTL_MS) {
      return cached.disabled;
    }

    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT feature_overrides AS "featureOverrides"
          FROM organizations
          WHERE id = ${orgId}::uuid AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as { featureOverrides: FeatureOverrides | null }[];

    // A missing or soft-deleted org resolves to "nothing disabled" rather than
    // throwing: this runs on the public portal and check-in paths, where an
    // exception would break an unrelated flow. Those callers already validate
    // the org's existence for their own reasons.
    const disabled = resolveDisabledFeatures(rows[0]?.featureOverrides ?? {});
    this.orgCache.set(orgId, { at: now, gen, disabled });
    return disabled;
  }

  /**
   * Enforcement for routes the guard cannot cover: `@Public()` handlers never
   * get a `request.user`, so the org is only known once the service has
   * resolved it from a slug or a one-time token. Call this IMMEDIATELY after
   * that resolution and BEFORE any INSERT/UPDATE.
   */
  async assertEnabledForOrg(orgId: string, feature: FeatureKey): Promise<void> {
    const disabled = await this.getDisabledForOrg(orgId);
    if (!isFeatureEnabled(disabled, feature)) throw new FeatureDisabledException(feature);
  }

  /** Super-admin console read: raw overrides + plan label + role usage counts. */
  async getSettings(orgId: string): Promise<OrgFeatureSettings> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT feature_overrides AS "featureOverrides", plan_label AS "planLabel"
          FROM organizations
          WHERE id = ${orgId}::uuid AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as { featureOverrides: FeatureOverrides | null; planLabel: string | null }[];
    if (!rows.length) throw new NotFoundException('Organization not found');

    return {
      featureOverrides: rows[0].featureOverrides ?? {},
      planLabel: rows[0].planLabel ?? null,
      activeUsersByRole: await this.activeUsersByRole(orgId),
    };
  }

  /**
   * Live count of active accounts per role, so the console can warn before a
   * role is switched off. Role toggles are grandfathered — existing accounts
   * keep working — but the operator should still see the blast radius.
   *
   * `role::text` avoids `public.user_role()`, which still returns the stale
   * `user_role_old` enum and errors on the roles added after it.
   */
  private async activeUsersByRole(orgId: string): Promise<Record<string, number>> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT role::text AS role, count(*)::int AS count
          FROM users
          WHERE organization_id = ${orgId}::uuid
            AND deleted_at IS NULL
            AND is_active = true
          GROUP BY role`,
    )) as unknown as { role: string; count: number }[];

    const byRole: Record<string, number> = {};
    for (const row of rows) byRole[row.role] = Number(row.count) || 0;
    return byRole;
  }

  /**
   * Write the override set and its audit trail atomically, then invalidate
   * every replica.
   *
   * Storage is normalised to the sparse canonical form: an override equal to
   * the registry default carries no information, so it is dropped. An org left
   * on defaults therefore always reads back as exactly `{}`, which is what
   * makes the "0 orgs with non-empty overrides" deploy check meaningful.
   */
  async setOverrides(
    orgId: string,
    dto: UpdateOrgFeaturesDto,
    actor: ActorContext,
  ): Promise<OrgFeatureSettings> {
    const next = normalizeOverrides(dto.featureOverrides);
    let changes: ReturnType<typeof diffOverrides> = [];

    await this.drizzleProvider.db.transaction(async (tx) => {
      /*
       * Read the previous value INSIDE the transaction, holding a row lock.
       *
       * It used to be read before the transaction opened, and the UPDATE below
       * replaces the whole column with no condition on the prior value — so two
       * super-admins (or two browser tabs) saving at once both diffed against
       * the same snapshot and the later commit silently reverted the earlier
       * one. Worse, the audit rows are derived from that same snapshot, so the
       * reverted key produced NO row at all: the one trace a cross-tenant
       * kill-switch is supposed to leave was exactly the thing that went
       * missing. Every other service in this backend already locks this way
       * (trips, geofence, parcels, fleet).
       */
      const locked = (await tx.execute(
        sql`SELECT feature_overrides AS "featureOverrides", plan_label AS "planLabel"
            FROM organizations
            WHERE id = ${orgId}::uuid AND deleted_at IS NULL
            FOR UPDATE`,
      )) as unknown as { featureOverrides: FeatureOverrides | null; planLabel: string | null }[];
      if (!locked.length) throw new NotFoundException('Organization not found');

      changes = diffOverrides(locked[0].featureOverrides ?? {}, next);

      // `planLabel` omitted entirely means "leave it alone"; an explicit null
      // means "clear it". Without the distinction, any caller that sent only
      // featureOverrides wiped the plan label as a side effect.
      const nextPlanLabel = dto.planLabel === undefined ? locked[0].planLabel : dto.planLabel;

      const updated = (await tx.execute(
        sql`UPDATE organizations
            SET feature_overrides = ${JSON.stringify(next)}::jsonb,
                plan_label = ${nextPlanLabel},
                updated_at = NOW()
            WHERE id = ${orgId}::uuid AND deleted_at IS NULL
            RETURNING id`,
      )) as unknown as { id: string }[];
      if (!updated.length) throw new NotFoundException('Organization not found');

      for (const change of changes) {
        await tx.execute(
          sql`INSERT INTO organization_feature_changes
                (organization_id, feature_key, old_enabled, new_enabled,
                 actor_user_id, actor_role, reason)
              VALUES (${orgId}::uuid, ${change.key}, ${change.from}, ${change.to},
                      ${actor.userId}::uuid, ${actor.role}, ${dto.reason})`,
        );
      }
    });

    // After commit: a bump seen by another replica before the data landed would
    // make it re-read the OLD row and cache it under the NEW generation.
    await this.featuresCache.bump();
    this.orgCache.delete(orgId);

    this.logger.log(
      `Feature flags updated for org ${orgId} by ${actor.userId ?? 'unknown'}: ` +
        `${changes.length} change(s) [${changes.map((c) => `${c.key}=${c.to}`).join(', ')}]`,
    );

    return this.getSettings(orgId);
  }

  /** Audit history, newest first. */
  async listChanges(orgId: string, limit = 100) {
    return (await this.drizzleProvider.db.execute(
      sql`SELECT c.feature_key   AS "featureKey",
                 c.old_enabled   AS "oldEnabled",
                 c.new_enabled   AS "newEnabled",
                 c.actor_role    AS "actorRole",
                 c.reason        AS "reason",
                 c.created_at    AS "createdAt",
                 u.full_name     AS "actorName"
          FROM organization_feature_changes c
          LEFT JOIN users u ON u.id = c.actor_user_id
          WHERE c.organization_id = ${orgId}::uuid
          ORDER BY c.created_at DESC
          LIMIT ${limit}`,
    )) as unknown as {
      featureKey: string;
      oldEnabled: boolean | null;
      newEnabled: boolean;
      actorRole: string | null;
      reason: string;
      createdAt: string;
      actorName: string | null;
    }[];
  }
}

/**
 * Drop entries that match the registry default — they carry no information and
 * would make `{}` (pure defaults) indistinguishable from an explicit all-on
 * write in the deploy-safety check.
 */
function normalizeOverrides(overrides: FeatureOverrides): FeatureOverrides {
  const normalized: FeatureOverrides = {};
  for (const [key, value] of Object.entries(overrides) as [FeatureKey, boolean][]) {
    const def = FEATURES[key];
    if (!def || value === def.defaultEnabled) continue;
    normalized[key] = value;
  }
  return normalized;
}

/** One audit row per CHANGED key. `null` = the key had no override before. */
function diffOverrides(
  before: FeatureOverrides,
  after: FeatureOverrides,
): { key: FeatureKey; from: boolean | null; to: boolean }[] {
  const keys = new Set<FeatureKey>([
    ...(Object.keys(before) as FeatureKey[]),
    ...(Object.keys(after) as FeatureKey[]),
  ]);

  const changes: { key: FeatureKey; from: boolean | null; to: boolean }[] = [];
  for (const key of keys) {
    const from = before[key] ?? null;
    // Removing an override means reverting to the registry default.
    const to = after[key] ?? FEATURES[key]?.defaultEnabled ?? true;
    if (from === to) continue;
    changes.push({ key, from, to });
  }
  return changes;
}
