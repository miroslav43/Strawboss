import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { Beneficiary, CreateBeneficiaryDto, UpdateBeneficiaryDto } from '@strawboss/types';

const BEN_COLS = sql`
  id,
  organization_id  AS "organizationId",
  slug,
  display_name     AS "displayName",
  company_name     AS "companyName",
  company_address  AS "companyAddress",
  company_cui      AS "companyCui",
  daily_pin        AS "dailyPin",
  pin_generated_at AS "pinGeneratedAt",
  is_active        AS "isActive",
  created_at       AS "createdAt",
  updated_at       AS "updatedAt",
  deleted_at       AS "deletedAt"
`;

interface OrgBeneficiaryRow {
  beneficiary: Beneficiary;
  org: {
    id: string;
    name: string;
    allowedCropTypes: string[];
  };
}

interface OrgJoinRow {
  id: string;
  organization_id: string;
  slug: string;
  display_name: string;
  company_name: string;
  company_address: string | null;
  company_cui: string | null;
  daily_pin: string;
  pin_generated_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  org_id: string;
  org_name: string;
  org_allowed_crop_types: string[] | null;
}

const PG_UNIQUE_VIOLATION = '23505';

function generatePin(): string {
  return randomInt(0, 10000).toString().padStart(4, '0');
}

@Injectable()
export class BeneficiariesService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  async list(orgId: string): Promise<Beneficiary[]> {
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT ${BEN_COLS}
          FROM beneficiaries
          WHERE organization_id = ${orgId}::uuid
            AND deleted_at IS NULL
          ORDER BY display_name ASC
          LIMIT 500`,
    );
    return rows as unknown as Beneficiary[];
  }

  async findBySlug(orgId: string, slug: string): Promise<Beneficiary | null> {
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT ${BEN_COLS}
          FROM beneficiaries
          WHERE organization_id = ${orgId}::uuid
            AND slug = ${slug}
            AND deleted_at IS NULL
          LIMIT 1`,
    );
    const list = rows as unknown as Beneficiary[];
    return list[0] ?? null;
  }

  async findBySlugPublic(
    orgSlug: string,
    beneficiarySlug: string,
  ): Promise<OrgBeneficiaryRow | null> {
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT
            b.id,
            b.organization_id,
            b.slug,
            b.display_name,
            b.company_name,
            b.company_address,
            b.company_cui,
            b.daily_pin,
            b.pin_generated_at,
            b.is_active,
            b.created_at,
            b.updated_at,
            b.deleted_at,
            o.id         AS org_id,
            o.name       AS org_name,
            o.allowed_crop_types AS org_allowed_crop_types
          FROM beneficiaries b
          JOIN organizations o ON o.id = b.organization_id
          WHERE o.slug = ${orgSlug}
            AND o.deleted_at IS NULL
            AND b.slug = ${beneficiarySlug}
            AND b.deleted_at IS NULL
            AND b.is_active = TRUE
          LIMIT 1`,
    );
    const list = rows as unknown as OrgJoinRow[];
    if (!list.length) return null;
    const r = list[0];
    return {
      beneficiary: {
        id: r.id,
        organizationId: r.organization_id,
        slug: r.slug,
        displayName: r.display_name,
        companyName: r.company_name,
        companyAddress: r.company_address,
        companyCui: r.company_cui,
        dailyPin: r.daily_pin,
        pinGeneratedAt: r.pin_generated_at,
        isActive: r.is_active,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        deletedAt: r.deleted_at,
      },
      org: {
        id: r.org_id,
        name: r.org_name,
        allowedCropTypes: r.org_allowed_crop_types ?? [],
      },
    };
  }

  async create(orgId: string, dto: CreateBeneficiaryDto): Promise<Beneficiary> {
    const pin = generatePin();
    let rows: unknown;
    try {
      rows = await this.drizzleProvider.db.execute(
        sql`INSERT INTO beneficiaries (
              organization_id, slug, display_name, company_name,
              company_address, company_cui, daily_pin, pin_generated_at
            ) VALUES (
              ${orgId}::uuid, ${dto.slug}, ${dto.displayName}, ${dto.companyName},
              ${dto.companyAddress ?? null}, ${dto.companyCui ?? null}, ${pin}, now()
            )
            RETURNING ${BEN_COLS}`,
      );
    } catch (err) {
      if ((err as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Slug-ul este deja folosit în această organizație.');
      }
      throw err;
    }
    const list = rows as unknown as Beneficiary[];
    this.winston.log('flow', `Beneficiary created: ${dto.slug}`, {
      context: 'BeneficiariesService',
      orgId,
      slug: dto.slug,
    });
    return list[0];
  }

  async update(id: string, orgId: string, dto: UpdateBeneficiaryDto): Promise<Beneficiary> {
    const setClauses = [sql`updated_at = now()`];
    if (dto.slug !== undefined) setClauses.push(sql`slug = ${dto.slug}`);
    if (dto.displayName !== undefined) setClauses.push(sql`display_name = ${dto.displayName}`);
    if (dto.companyName !== undefined) setClauses.push(sql`company_name = ${dto.companyName}`);
    if ('companyAddress' in dto)
      setClauses.push(sql`company_address = ${dto.companyAddress ?? null}`);
    if ('companyCui' in dto) setClauses.push(sql`company_cui = ${dto.companyCui ?? null}`);
    if (dto.isActive !== undefined) {
      if (dto.isActive) {
        // Reactivating (was inactive) → refresh the PIN so it's immediately valid,
        // since the rotation cron skips inactive beneficiaries and it may be stale.
        // The CASE reads the pre-UPDATE is_active, so an already-active row is untouched.
        const fresh = generatePin();
        setClauses.push(
          sql`daily_pin = CASE WHEN is_active = FALSE THEN ${fresh} ELSE daily_pin END`,
        );
        setClauses.push(
          sql`pin_generated_at = CASE WHEN is_active = FALSE THEN now() ELSE pin_generated_at END`,
        );
      }
      setClauses.push(sql`is_active = ${dto.isActive}`);
    }

    const setFragment = sql.join(setClauses, sql`, `);
    let rows: unknown;
    try {
      rows = await this.drizzleProvider.db.execute(
        sql`UPDATE beneficiaries
            SET ${setFragment}
            WHERE id = ${id}::uuid
              AND organization_id = ${orgId}::uuid
              AND deleted_at IS NULL
            RETURNING ${BEN_COLS}`,
      );
    } catch (err) {
      if ((err as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Slug-ul este deja folosit în această organizație.');
      }
      throw err;
    }
    const list = rows as unknown as Beneficiary[];
    if (!list.length) throw new NotFoundException(`Beneficiary ${id} not found`);
    return list[0];
  }

  async softDelete(id: string, orgId: string): Promise<void> {
    const rows = await this.drizzleProvider.db.execute(
      sql`UPDATE beneficiaries
          SET deleted_at = now(), updated_at = now()
          WHERE id = ${id}::uuid
            AND organization_id = ${orgId}::uuid
            AND deleted_at IS NULL
          RETURNING id`,
    );
    if (!(rows as unknown as { id: string }[]).length) {
      throw new NotFoundException(`Beneficiary ${id} not found`);
    }
    this.winston.log('flow', `Beneficiary soft-deleted: ${id}`, {
      context: 'BeneficiariesService',
      id,
      orgId,
    });
  }

  async regenPin(id: string, orgId: string): Promise<Beneficiary> {
    const pin = generatePin();
    const rows = await this.drizzleProvider.db.execute(
      sql`UPDATE beneficiaries
          SET daily_pin = ${pin}, pin_generated_at = now(), updated_at = now()
          WHERE id = ${id}::uuid
            AND organization_id = ${orgId}::uuid
            AND deleted_at IS NULL
          RETURNING ${BEN_COLS}`,
    );
    const list = rows as unknown as Beneficiary[];
    if (!list.length) throw new NotFoundException(`Beneficiary ${id} not found`);
    this.winston.log('flow', `Beneficiary PIN regenerated: ${id}`, {
      context: 'BeneficiariesService',
      id,
      orgId,
    });
    return list[0];
  }

  async regenAllPins(): Promise<number> {
    const idRows = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM beneficiaries WHERE deleted_at IS NULL AND is_active = TRUE`,
    );
    const beneficiaries = idRows as unknown as { id: string }[];
    if (!beneficiaries.length) return 0;

    // Generate a CSPRNG PIN per beneficiary in Node, then bulk-update via VALUES.
    const updates = beneficiaries.map((b) => ({
      id: b.id,
      pin: randomInt(0, 10000).toString().padStart(4, '0'),
    }));
    const valuesList = updates.map((u) => sql`(${u.id}::uuid, ${u.pin})`);
    const valuesClause = sql.join(valuesList, sql`, `);

    await this.drizzleProvider.db.execute(
      sql`UPDATE beneficiaries
          SET daily_pin        = v.pin,
              pin_generated_at = now(),
              updated_at       = now()
          FROM (VALUES ${valuesClause}) AS v(id, pin)
          WHERE beneficiaries.id = v.id
            AND beneficiaries.deleted_at IS NULL
            AND beneficiaries.is_active = TRUE`,
    );

    this.winston.log('flow', `Bulk PIN regen: ${updates.length} beneficiaries updated`, {
      context: 'BeneficiariesService',
    });
    return updates.length;
  }
}
