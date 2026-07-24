import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { BeneficiaryOrderSettings } from '@strawboss/types';
import type { BeneficiaryOrderSettingsInput } from '@strawboss/validation';

/** camelCase projection for beneficiary_order_settings. */
const ORDER_SETTINGS_COLS = sql`
  id,
  organization_id       AS "organizationId",
  beneficiary_id        AS "beneficiaryId",
  transport_value::float8 AS "transportValue",
  currency,
  payment_term_days     AS "paymentTermDays",
  bale_count            AS "baleCount",
  bale_dimensions       AS "baleDimensions",
  goods_name            AS "goodsName",
  truck_description     AS "truckDescription",
  loading_locality      AS "loadingLocality",
  loading_country       AS "loadingCountry",
  obs,
  order_counter         AS "orderCounter",
  created_at            AS "createdAt",
  updated_at            AS "updatedAt"
`;

/**
 * A beneficiary as shown to a transporter — deliberately PIN-FREE. The
 * beneficiary's `daily_pin` is a portal secret and must never reach a transporter
 * account (the transporter authenticates with their own session, not the PIN).
 */
export interface AssignedBeneficiary {
  id: string;
  slug: string;
  displayName: string;
  companyName: string;
  companyCui: string | null;
  companyAddress: string | null;
  email: string | null;
}

/**
 * Owns the transporter ↔ beneficiary assignment (transporter_beneficiaries).
 *
 * `assertAssigned` is the authenticated analogue of the public portal's daily-PIN
 * check: it is the single gate every transporter write goes through before it can
 * touch a beneficiary's saved records or submit a request on their behalf. The
 * backend bypasses RLS, so this service — not the DB policy — is the real boundary.
 */
@Injectable()
export class TransporterAssignmentsService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  /** The beneficiaries a transporter may act for (PIN-free), for their own form. */
  async listAssignedBeneficiaries(orgId: string, userId: string): Promise<AssignedBeneficiary[]> {
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT
            b.id,
            b.slug,
            b.display_name    AS "displayName",
            b.company_name    AS "companyName",
            b.company_cui     AS "companyCui",
            b.company_address AS "companyAddress",
            b.email
          FROM transporter_beneficiaries tb
          JOIN beneficiaries b
            ON b.id = tb.beneficiary_id
           AND b.organization_id = tb.organization_id
          WHERE tb.organization_id = ${orgId}::uuid
            AND tb.transporter_user_id = ${userId}::uuid
            AND b.deleted_at IS NULL
            AND b.is_active = TRUE
          ORDER BY b.display_name ASC`,
    );
    return rows as unknown as AssignedBeneficiary[];
  }

  /** The raw beneficiary ids assigned to a transporter — for the admin modal. */
  async listBeneficiaryIds(orgId: string, userId: string): Promise<string[]> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT beneficiary_id AS "beneficiaryId"
          FROM transporter_beneficiaries
          WHERE organization_id = ${orgId}::uuid
            AND transporter_user_id = ${userId}::uuid`,
    )) as unknown as { beneficiaryId: string }[];
    return rows.map((r) => r.beneficiaryId);
  }

  /** Throws unless the transporter is assigned to this beneficiary (same org). */
  async assertAssigned(orgId: string, userId: string, beneficiaryId: string): Promise<void> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT 1 FROM transporter_beneficiaries
          WHERE organization_id = ${orgId}::uuid
            AND transporter_user_id = ${userId}::uuid
            AND beneficiary_id = ${beneficiaryId}::uuid
          LIMIT 1`,
    )) as unknown as unknown[];
    if (!rows.length) {
      throw new ForbiddenException('Nu aveți acces la acest beneficiar.');
    }
  }

  /**
   * Replace the whole assignment set for a transporter (admin action). Validates
   * the target is a transportator in this org and that every beneficiary belongs
   * to it, then swaps the rows atomically (hard delete → bulk insert).
   */
  async setBeneficiaries(orgId: string, userId: string, beneficiaryIds: string[]): Promise<void> {
    // Target must be a transportator account in the caller's org.
    const userRows = (await this.drizzleProvider.db.execute(
      sql`SELECT 1 FROM users
          WHERE id = ${userId}::uuid
            AND organization_id = ${orgId}::uuid
            AND role = 'transportator'::user_role
            AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as unknown[];
    if (!userRows.length) {
      throw new NotFoundException('Cont de transportator inexistent.');
    }

    // De-dup and (if any) verify every beneficiary belongs to this org.
    const ids = Array.from(new Set(beneficiaryIds));
    if (ids.length) {
      const countRows = (await this.drizzleProvider.db.execute(
        sql`SELECT count(*)::int AS n FROM beneficiaries
            WHERE organization_id = ${orgId}::uuid
              AND deleted_at IS NULL
              AND id IN (${sql.join(
                ids.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`,
      )) as unknown as { n: number }[];
      if ((countRows[0]?.n ?? 0) !== ids.length) {
        throw new BadRequestException('Beneficiar invalid.');
      }
    }

    // Set-replace, atomically: an INSERT failure must not leave the set half-wiped.
    await this.drizzleProvider.db.transaction(async (tx) => {
      await tx.execute(
        sql`DELETE FROM transporter_beneficiaries
            WHERE organization_id = ${orgId}::uuid
              AND transporter_user_id = ${userId}::uuid`,
      );
      if (ids.length) {
        const values = sql.join(
          ids.map((id) => sql`(${orgId}::uuid, ${userId}::uuid, ${id}::uuid)`),
          sql`, `,
        );
        await tx.execute(
          sql`INSERT INTO transporter_beneficiaries (organization_id, transporter_user_id, beneficiary_id)
              VALUES ${values}`,
        );
      }
    });

    this.winston.log('flow', `Transporter assignments set: user=${userId} count=${ids.length}`, {
      context: 'TransporterAssignmentsService',
      orgId,
      transporterUserId: userId,
      count: ids.length,
    });
  }

  // ── Per-beneficiary comandă (order) settings ───────────────────────────────

  /** The order settings for a beneficiary, or null if none configured yet. */
  async getOrderSettings(
    orgId: string,
    beneficiaryId: string,
  ): Promise<BeneficiaryOrderSettings | null> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT ${ORDER_SETTINGS_COLS} FROM beneficiary_order_settings
          WHERE organization_id = ${orgId}::uuid
            AND beneficiary_id = ${beneficiaryId}::uuid
          LIMIT 1`,
    )) as unknown as BeneficiaryOrderSettings[];
    return rows[0] ?? null;
  }

  /**
   * Set-replace the order settings for a beneficiary (the form always sends the
   * full set). Never touches `order_counter`, so the running comandă number is
   * preserved across edits.
   */
  async upsertOrderSettings(
    orgId: string,
    beneficiaryId: string,
    dto: BeneficiaryOrderSettingsInput,
  ): Promise<BeneficiaryOrderSettings> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`INSERT INTO beneficiary_order_settings (
            organization_id, beneficiary_id,
            transport_value, currency, payment_term_days,
            bale_count, bale_dimensions, goods_name, truck_description,
            loading_locality, loading_country, obs, updated_at
          ) VALUES (
            ${orgId}::uuid, ${beneficiaryId}::uuid,
            ${dto.transportValue ?? null}, ${dto.currency ?? 'EUR'}, ${dto.paymentTermDays ?? 30},
            ${dto.baleCount ?? null}, ${dto.baleDimensions ?? null}, ${dto.goodsName ?? null}, ${dto.truckDescription ?? null},
            ${dto.loadingLocality ?? null}, ${dto.loadingCountry ?? null}, ${dto.obs ?? null}, now()
          )
          ON CONFLICT (organization_id, beneficiary_id) DO UPDATE SET
            transport_value   = EXCLUDED.transport_value,
            currency          = EXCLUDED.currency,
            payment_term_days = EXCLUDED.payment_term_days,
            bale_count        = EXCLUDED.bale_count,
            bale_dimensions   = EXCLUDED.bale_dimensions,
            goods_name        = EXCLUDED.goods_name,
            truck_description = EXCLUDED.truck_description,
            loading_locality  = EXCLUDED.loading_locality,
            loading_country   = EXCLUDED.loading_country,
            obs               = EXCLUDED.obs,
            updated_at        = now()
          RETURNING ${ORDER_SETTINGS_COLS}`,
    )) as unknown as BeneficiaryOrderSettings[];
    return rows[0];
  }
}
