import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { isFeatureEnabled, type FeatureKey, type MeteoOrgSettings } from '@strawboss/types';
import { DrizzleProvider } from '../database/drizzle.provider';
import { FeaturesService } from '../features/features.service';
import { FeatureDisabledException } from '../features/feature-disabled.exception';
import { DEFAULT_METEO_SETTINGS } from './meteo.constants';

/** Whether the background jobs are allowed to run in THIS deployment. */
export function meteoJobsEnabled(): boolean {
  return process.env.METEO_JOBS_ENABLED === 'true';
}

/**
 * Per-organization gating: the real opt-in is `meteo_org_settings.enabled`
 * (feature-registry defaults are ON for every org by construction), combined
 * with the org's feature switches.
 */
@Injectable()
export class MeteoAccessService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly features: FeaturesService,
  ) {}

  /** Settings for an org, defaults when it has no row yet. */
  async getSettings(orgId: string): Promise<MeteoOrgSettings> {
    const rows = await this.drizzleProvider.db.execute(sql`
      SELECT
        enabled,
        to_char(enabled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "enabledAt",
        threshold_wb::float8        AS "thresholdWb",
        baleable_frac_min::float8   AS "baleableFracMin",
        rain_prob_max::float8       AS "rainProbMax",
        press_capacity_ha_h::float8 AS "pressCapacityHaH",
        min_window_h                AS "minWindowH",
        default_mc0_wb::float8      AS "defaultMc0Wb",
        active_days                 AS "activeDays",
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
      FROM meteo_org_settings
      WHERE organization_id = ${orgId}::uuid
      LIMIT 1
    `);
    const row = (rows as unknown as Array<Omit<MeteoOrgSettings, 'organizationId'>>)[0];
    return { organizationId: orgId, ...(row ?? DEFAULT_METEO_SETTINGS) };
  }

  async isOptedIn(orgId: string): Promise<boolean> {
    const rows = await this.drizzleProvider.db.execute(sql`
      SELECT enabled FROM meteo_org_settings WHERE organization_id = ${orgId}::uuid LIMIT 1
    `);
    return (rows as unknown as Array<{ enabled: boolean }>)[0]?.enabled === true;
  }

  /**
   * Writes: 403 FEATURE_DISABLED unless the org opted in. Call AFTER the route's
   * @RequireFeature and strictly BEFORE any INSERT/UPDATE.
   */
  async assertOptedIn(orgId: string): Promise<void> {
    if (!(await this.isOptedIn(orgId))) throw new FeatureDisabledException('meteo');
  }

  /** Opted in AND every given feature key enabled — for jobs (never throws). */
  async isActiveForOrg(orgId: string, ...keys: FeatureKey[]): Promise<boolean> {
    if (!(await this.isOptedIn(orgId))) return false;
    const disabled = await this.features.getDisabledForOrg(orgId);
    return ['meteo' as FeatureKey, ...keys].every((k) => isFeatureEnabled(disabled, k));
  }

  /** Orgs that opted in (jobs iterate these, then check features per org). */
  async listOptedInOrgIds(): Promise<string[]> {
    const rows = await this.drizzleProvider.db.execute(sql`
      SELECT organization_id::text AS id FROM meteo_org_settings WHERE enabled LIMIT 1000
    `);
    return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
  }
}
