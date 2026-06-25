import { Injectable, Inject, NotFoundException } from '@nestjs/common';
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

function generatePin(): string {
  return Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
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
    const rows = await this.drizzleProvider.db.execute(
      sql`INSERT INTO beneficiaries (
            organization_id, slug, display_name, company_name,
            company_address, company_cui, daily_pin, pin_generated_at
          ) VALUES (
            ${orgId}::uuid, ${dto.slug}, ${dto.displayName}, ${dto.companyName},
            ${dto.companyAddress ?? null}, ${dto.companyCui ?? null}, ${pin}, now()
          )
          RETURNING ${BEN_COLS}`,
    );
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

    const setFragment = sql.join(setClauses, sql`, `);
    const rows = await this.drizzleProvider.db.execute(
      sql`UPDATE beneficiaries
          SET ${setFragment}
          WHERE id = ${id}::uuid
            AND organization_id = ${orgId}::uuid
            AND deleted_at IS NULL
          RETURNING ${BEN_COLS}`,
    );
    const list = rows as unknown as Beneficiary[];
    if (!list.length) throw new NotFoundException(`Beneficiary ${id} not found`);
    return list[0];
  }

  async softDelete(id: string, orgId: string): Promise<void> {
    await this.drizzleProvider.db.execute(
      sql`UPDATE beneficiaries
          SET deleted_at = now(), updated_at = now()
          WHERE id = ${id}::uuid
            AND organization_id = ${orgId}::uuid
            AND deleted_at IS NULL`,
    );
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
    // Use PostgreSQL random() so each beneficiary gets a distinct 4-digit PIN.
    const rows = await this.drizzleProvider.db.execute(
      sql`UPDATE beneficiaries
          SET daily_pin        = lpad((floor(random() * 10000))::int::text, 4, '0'),
              pin_generated_at = now(),
              updated_at       = now()
          WHERE deleted_at IS NULL
            AND is_active = TRUE
          RETURNING id`,
    );
    const count = (rows as unknown as { id: string }[]).length;
    this.winston.log('flow', `Bulk PIN regen: ${count} beneficiaries updated`, {
      context: 'BeneficiariesService',
    });
    return count;
  }
}
