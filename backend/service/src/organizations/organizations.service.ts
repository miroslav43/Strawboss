import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { Organization, CreateOrganizationDto, OrgRequestSettings } from '@strawboss/types';

const ORG_COLS = sql`id, slug, name, created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"`;

@Injectable()
export class OrganizationsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(): Promise<Organization[]> {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${ORG_COLS} FROM organizations WHERE deleted_at IS NULL ORDER BY name ASC`,
    );
    return result as unknown as Organization[];
  }

  async findById(id: string): Promise<Organization> {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${ORG_COLS} FROM organizations WHERE id = ${id}::uuid AND deleted_at IS NULL LIMIT 1`,
    );
    const rows = result as unknown as Organization[];
    if (!rows.length) throw new NotFoundException(`Organization ${id} not found`);
    return rows[0];
  }

  async findBySlug(slug: string): Promise<Organization> {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${ORG_COLS} FROM organizations WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1`,
    );
    const rows = result as unknown as Organization[];
    if (!rows.length) throw new NotFoundException(`Organization '${slug}' not found`);
    return rows[0];
  }

  async create(dto: CreateOrganizationDto): Promise<Organization> {
    const existing = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM organizations WHERE slug = ${dto.slug} LIMIT 1`,
    );
    if ((existing as unknown as { id: string }[]).length) {
      throw new ConflictException(`Organization slug '${dto.slug}' already exists`);
    }
    const result = await this.drizzleProvider.db.execute(sql`
      INSERT INTO organizations (slug, name)
      VALUES (${dto.slug}, ${dto.name})
      RETURNING ${ORG_COLS}
    `);
    return (result as unknown as Organization[])[0];
  }

  /** Read the request-portal settings (4-digit code + allowed crops) for an org. */
  async getRequestSettings(orgId: string): Promise<OrgRequestSettings> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT request_access_code AS "requestAccessCode",
                 allowed_crop_types  AS "allowedCropTypes"
          FROM organizations WHERE id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1`,
    )) as unknown as OrgRequestSettings[];
    if (!rows.length) throw new NotFoundException('Organization not found');
    return {
      requestAccessCode: rows[0].requestAccessCode ?? null,
      allowedCropTypes: rows[0].allowedCropTypes ?? [],
    };
  }

  async updateRequestSettings(orgId: string, dto: OrgRequestSettings): Promise<OrgRequestSettings> {
    const cropArray = dto.allowedCropTypes.length
      ? sql`ARRAY[${sql.join(
          dto.allowedCropTypes.map((c) => sql`${c}`),
          sql`, `,
        )}]::crop_type[]`
      : sql`'{}'::crop_type[]`;
    const rows = (await this.drizzleProvider.db.execute(
      sql`UPDATE organizations SET
            request_access_code = ${dto.requestAccessCode},
            allowed_crop_types = ${cropArray},
            updated_at = NOW()
          WHERE id = ${orgId}::uuid AND deleted_at IS NULL
          RETURNING request_access_code AS "requestAccessCode",
                    allowed_crop_types  AS "allowedCropTypes"`,
    )) as unknown as OrgRequestSettings[];
    if (!rows.length) throw new NotFoundException('Organization not found');
    return {
      requestAccessCode: rows[0].requestAccessCode ?? null,
      allowedCropTypes: rows[0].allowedCropTypes ?? [],
    };
  }
}
