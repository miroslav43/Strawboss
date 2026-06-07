import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { AlertDraft } from '@strawboss/domain';

/** All alert columns aliased to camelCase so the API is consistent. */
const ALERT_COLS = sql`
  id,
  category,
  severity,
  title,
  description,
  related_table        AS "relatedTable",
  related_record_id    AS "relatedRecordId",
  trip_id              AS "tripId",
  machine_id           AS "machineId",
  data,
  is_acknowledged      AS "isAcknowledged",
  acknowledged_by      AS "acknowledgedBy",
  acknowledged_at      AS "acknowledgedAt",
  resolution_notes     AS "resolutionNotes",
  organization_id      AS "organizationId",
  created_at           AS "createdAt",
  updated_at           AS "updatedAt"
`;

@Injectable()
export class AlertsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(
    orgId: string | null,
    filters?: {
      category?: string;
      severity?: string;
      isAcknowledged?: string;
    },
  ) {
    const conditions: ReturnType<typeof sql>[] = [];

    if (orgId) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    if (filters?.category) {
      conditions.push(sql`category = ${filters.category}`);
    }
    if (filters?.severity) {
      conditions.push(sql`severity = ${filters.severity}`);
    }
    if (filters?.isAcknowledged !== undefined) {
      const ack = filters.isAcknowledged === 'true';
      conditions.push(sql`is_acknowledged = ${ack}`);
    }

    if (conditions.length === 0) {
      const result = await this.drizzleProvider.db.execute(
        sql`SELECT ${ALERT_COLS} FROM alerts ORDER BY created_at DESC LIMIT 100`,
      );
      return result;
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${ALERT_COLS} FROM alerts WHERE ${where} ORDER BY created_at DESC LIMIT 100`,
    );
    return result;
  }

  async listUnacknowledged(orgId: string | null) {
    if (orgId) {
      const result = await this.drizzleProvider.db.execute(
        sql`SELECT ${ALERT_COLS} FROM alerts WHERE is_acknowledged = false AND organization_id = ${orgId}::uuid ORDER BY created_at DESC`,
      );
      return result;
    }
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${ALERT_COLS} FROM alerts WHERE is_acknowledged = false ORDER BY created_at DESC`,
    );
    return result;
  }

  async acknowledge(id: string, userId: string, orgId: string | null) {
    const conditions: ReturnType<typeof sql>[] = [sql`id = ${id}`];
    if (orgId) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(conditions, sql` AND `);

    const existing = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM alerts WHERE ${where} LIMIT 1`,
    );
    const rows = existing as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Alert ${id} not found`);
    }

    const updateConditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`];
    if (orgId !== null) updateConditions.push(sql`organization_id = ${orgId}::uuid`);
    const updateWhere = sql.join(updateConditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(sql`
      UPDATE alerts
      SET is_acknowledged = true,
          acknowledged_at = NOW(),
          acknowledged_by = ${userId}::uuid,
          updated_at = NOW()
      WHERE ${updateWhere}
      RETURNING ${ALERT_COLS}
    `);
    const updated = result as unknown as Record<string, unknown>[];
    return updated[0];
  }

  async create(orgId: string | null, dto: Record<string, unknown>) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO alerts (id, category, severity, title, description, machine_id, organization_id, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        ${dto.category},
        ${(dto.severity as string) || 'medium'},
        ${dto.title},
        ${dto.description},
        ${(dto.machineId as string) || null},
        ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
        NOW(), NOW()
      )
      RETURNING ${ALERT_COLS}`,
    );
    const created = result as unknown as Record<string, unknown>[];
    return created[0];
  }

  /**
   * Plan C — factory for `truck_idle` system alerts (one per truck per idle
   * window). Caller (TruckIdleProcessor) already dedups by checking for an
   * unacknowledged alert in the last 60 min; this method just inserts.
   */
  async createTruckIdleAlert(args: {
    truckId: string;
    truckCode: string;
    idleMinutes: number;
    completedAt: string;
    orgId: string | null;
    /** 'idle_timeout' = periodic scan; 'loader_declined' = loader released it. */
    reason?: 'idle_timeout' | 'loader_declined';
  }) {
    const reason = args.reason ?? 'idle_timeout';
    const title = reason === 'loader_declined' ? 'Camion eliberat' : 'Camion inactiv';
    const description =
      reason === 'loader_declined'
        ? `Loaderul a refuzat rechemarea — camionul ${args.truckCode} e liber.`
        : `Camionul ${args.truckCode} stă inactiv de ${args.idleMinutes} min.`;
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO alerts (
        category, severity, title, description,
        machine_id, data, is_acknowledged, organization_id
      ) VALUES (
        'system'::alert_category, 'medium'::alert_severity,
        ${title},
        ${description},
        ${args.truckId}::uuid,
        jsonb_build_object(
          'kind', 'truck_idle',
          'reason', ${reason}::text,
          'idleMinutes', ${args.idleMinutes},
          'completedAt', ${args.completedAt}
        ),
        false,
        ${args.orgId ? sql`${args.orgId}::uuid` : sql`NULL`}
      ) RETURNING ${ALERT_COLS}`,
    );
    const created = result as unknown as Record<string, unknown>[];
    return created[0];
  }

  /**
   * Anomaly alert raised when a loader confirms a field is done but fewer bales
   * were loaded than the baler produced. Deduped per parcel: skip if an
   * unacknowledged mismatch alert for the same parcel already exists, so a
   * re-visit does not spam duplicates.
   */
  async createParcelMismatchAlert(args: {
    parcelId: string;
    parcelName?: string | null;
    produced: number;
    loaded: number;
    orgId: string;
  }) {
    const existing = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM alerts
          WHERE related_table = 'parcels'
            AND related_record_id = ${args.parcelId}::uuid
            AND category = 'anomaly'
            AND is_acknowledged = false
            AND organization_id = ${args.orgId}::uuid
          LIMIT 1`,
    );
    if ((existing as unknown as Record<string, unknown>[]).length > 0) {
      return (existing as unknown as Record<string, unknown>[])[0];
    }
    const missing = Math.max(0, args.produced - args.loaded);
    const lossPct = args.produced > 0 ? (missing / args.produced) * 100 : 0;
    const severity = lossPct > 10 ? 'high' : 'medium';
    const label = args.parcelName ?? args.parcelId;
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO alerts (
        category, severity, title, description,
        related_table, related_record_id, data, is_acknowledged, organization_id
      ) VALUES (
        'anomaly'::alert_category, ${severity}::alert_severity,
        'Câmp neîncărcat complet',
        ${`Parcela ${label}: produși ${args.produced}, încărcați ${args.loaded}, lipsă ${missing}.`},
        'parcels', ${args.parcelId}::uuid,
        jsonb_build_object(
          'kind', 'parcel_load_mismatch',
          'parcelId', ${args.parcelId}::text,
          'produced', ${args.produced},
          'loaded', ${args.loaded},
          'missing', ${missing}
        ),
        false,
        ${args.orgId}::uuid
      ) RETURNING ${ALERT_COLS}`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }

  async createFromDraft(draft: AlertDraft, orgId: string) {
    // Skip insert if an unacknowledged alert with the same (trip_id, category)
    // already exists — the evaluation job runs every 15 minutes and would
    // otherwise spam duplicates for the same persistent anomaly.
    if (draft.tripId) {
      const existing = await this.drizzleProvider.db.execute(
        sql`SELECT id FROM alerts
            WHERE trip_id = ${draft.tripId}::uuid
              AND category = ${draft.category}
              AND is_acknowledged = false
              AND organization_id = ${orgId}::uuid
            LIMIT 1`,
      );
      if ((existing as unknown as Record<string, unknown>[]).length > 0) {
        return existing;
      }
    }
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO alerts (
        category, severity, title, description,
        trip_id, machine_id, data, is_acknowledged,
        organization_id
      ) VALUES (
        ${draft.category}, ${draft.severity}, ${draft.title}, ${draft.description},
        ${draft.tripId}, ${draft.machineId},
        ${JSON.stringify(draft.data)}::jsonb, false,
        ${orgId}::uuid
      ) RETURNING *`,
    );
    return result;
  }
}
