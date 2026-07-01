import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import type {
  BeneficiaryContact,
  BeneficiaryTruck,
  BeneficiaryDriver,
  CreateBeneficiaryContactDto,
  UpdateBeneficiaryContactDto,
  CreateBeneficiaryTruckDto,
  UpdateBeneficiaryTruckDto,
  CreateBeneficiaryDriverDto,
  UpdateBeneficiaryDriverDto,
} from '@strawboss/types';

export type RecordKind = 'contact' | 'truck' | 'driver';
type BeneficiaryRecord = BeneficiaryContact | BeneficiaryTruck | BeneficiaryDriver;
type CreateDto =
  | CreateBeneficiaryContactDto
  | CreateBeneficiaryTruckDto
  | CreateBeneficiaryDriverDto;
type UpdateDto =
  | UpdateBeneficiaryContactDto
  | UpdateBeneficiaryTruckDto
  | UpdateBeneficiaryDriverDto;

const PG_UNIQUE_VIOLATION = '23505';

// camelCase select fragments. NUMERIC is cast to float8 so postgres.js yields a JS
// number (it returns numeric as a string by default) — the value flows back into a
// z.number() submit schema, so it must be numeric.
const CONTACT_COLS = sql`
  id,
  organization_id AS "organizationId",
  beneficiary_id  AS "beneficiaryId",
  name, phone, email,
  created_at      AS "createdAt",
  updated_at      AS "updatedAt",
  deleted_at      AS "deletedAt"
`;
const DRIVER_COLS = CONTACT_COLS;
const TRUCK_COLS = sql`
  id,
  organization_id            AS "organizationId",
  beneficiary_id             AS "beneficiaryId",
  truck_registration_plate   AS "truckRegistrationPlate",
  trailer_registration_plate AS "trailerRegistrationPlate",
  capacity_tons::float8      AS "capacityTons",
  transporter_name           AS "transporterName",
  transporter_cui            AS "transporterCui",
  transporter_address        AS "transporterAddress",
  created_at                 AS "createdAt",
  updated_at                 AS "updatedAt",
  deleted_at                 AS "deletedAt"
`;

interface KindConfig {
  /** Hardcoded constant table name (never user input) — safe for sql.raw. */
  table: string;
  cols: SQL;
  /** Column list + matching values (excluding organization_id / beneficiary_id). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insert: (dto: any) => { columns: SQL; values: SQL };
  /** Dynamic SET clauses for a partial update (excluding updated_at). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateSet: (dto: any) => SQL[];
}

const KINDS: Record<RecordKind, KindConfig> = {
  contact: {
    table: 'beneficiary_contacts',
    cols: CONTACT_COLS,
    insert: (d: CreateBeneficiaryContactDto) => ({
      columns: sql`name, phone, email`,
      values: sql`${d.name}, ${d.phone}, ${d.email ?? null}`,
    }),
    updateSet: (d: UpdateBeneficiaryContactDto) => {
      const s: SQL[] = [];
      if (d.name !== undefined) s.push(sql`name = ${d.name}`);
      if (d.phone !== undefined) s.push(sql`phone = ${d.phone}`);
      if ('email' in d) s.push(sql`email = ${d.email ?? null}`);
      return s;
    },
  },
  truck: {
    table: 'beneficiary_trucks',
    cols: TRUCK_COLS,
    insert: (d: CreateBeneficiaryTruckDto) => ({
      columns: sql`truck_registration_plate, trailer_registration_plate, capacity_tons,
                   transporter_name, transporter_cui, transporter_address`,
      values: sql`${d.truckRegistrationPlate}, ${d.trailerRegistrationPlate ?? null}, ${d.capacityTons ?? null},
                  ${d.transporterName ?? null}, ${d.transporterCui ?? null}, ${d.transporterAddress ?? null}`,
    }),
    updateSet: (d: UpdateBeneficiaryTruckDto) => {
      const s: SQL[] = [];
      if (d.truckRegistrationPlate !== undefined)
        s.push(sql`truck_registration_plate = ${d.truckRegistrationPlate}`);
      if ('trailerRegistrationPlate' in d)
        s.push(sql`trailer_registration_plate = ${d.trailerRegistrationPlate ?? null}`);
      if ('capacityTons' in d) s.push(sql`capacity_tons = ${d.capacityTons ?? null}`);
      if ('transporterName' in d) s.push(sql`transporter_name = ${d.transporterName ?? null}`);
      if ('transporterCui' in d) s.push(sql`transporter_cui = ${d.transporterCui ?? null}`);
      if ('transporterAddress' in d)
        s.push(sql`transporter_address = ${d.transporterAddress ?? null}`);
      return s;
    },
  },
  driver: {
    table: 'beneficiary_drivers',
    cols: DRIVER_COLS,
    insert: (d: CreateBeneficiaryDriverDto) => ({
      columns: sql`name, phone, email`,
      values: sql`${d.name}, ${d.phone}, ${d.email ?? null}`,
    }),
    updateSet: (d: UpdateBeneficiaryDriverDto) => {
      const s: SQL[] = [];
      if (d.name !== undefined) s.push(sql`name = ${d.name}`);
      if (d.phone !== undefined) s.push(sql`phone = ${d.phone}`);
      if ('email' in d) s.push(sql`email = ${d.email ?? null}`);
      return s;
    },
  },
};

/**
 * Generic CRUD over the three per-beneficiary record tables. Every method is
 * scoped by BOTH organization_id and beneficiary_id (resolved server-side from
 * the portal slugs by BeneficiaryPinVerifier), so a client-supplied id can never
 * reach another beneficiary's — or another org's — data. Soft-delete throughout.
 */
@Injectable()
export class BeneficiaryRecordsService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  async list(kind: RecordKind, orgId: string, beneficiaryId: string): Promise<BeneficiaryRecord[]> {
    const cfg = KINDS[kind];
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT ${cfg.cols}
          FROM ${sql.raw(cfg.table)}
          WHERE organization_id = ${orgId}::uuid
            AND beneficiary_id = ${beneficiaryId}::uuid
            AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT 500`,
    );
    return rows as unknown as BeneficiaryRecord[];
  }

  async create(
    kind: RecordKind,
    orgId: string,
    beneficiaryId: string,
    dto: CreateDto,
  ): Promise<BeneficiaryRecord> {
    const cfg = KINDS[kind];
    const { columns, values } = cfg.insert(dto);
    let rows: unknown;
    try {
      rows = await this.drizzleProvider.db.execute(
        sql`INSERT INTO ${sql.raw(cfg.table)} (organization_id, beneficiary_id, ${columns})
            VALUES (${orgId}::uuid, ${beneficiaryId}::uuid, ${values})
            RETURNING ${cfg.cols}`,
      );
    } catch (err) {
      if ((err as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Această înregistrare există deja.');
      }
      throw err;
    }
    const inserted = (rows as unknown as BeneficiaryRecord[])[0];
    this.winston.log('flow', `Beneficiary ${kind} created`, {
      context: 'BeneficiaryRecordsService',
      orgId,
      beneficiaryId,
      id: inserted?.id,
    });
    return inserted;
  }

  async update(
    kind: RecordKind,
    orgId: string,
    beneficiaryId: string,
    id: string,
    dto: UpdateDto,
  ): Promise<BeneficiaryRecord> {
    const cfg = KINDS[kind];
    const setClauses = [sql`updated_at = now()`, ...cfg.updateSet(dto)];
    const setFragment = sql.join(setClauses, sql`, `);
    let rows: unknown;
    try {
      rows = await this.drizzleProvider.db.execute(
        sql`UPDATE ${sql.raw(cfg.table)}
            SET ${setFragment}
            WHERE id = ${id}::uuid
              AND organization_id = ${orgId}::uuid
              AND beneficiary_id = ${beneficiaryId}::uuid
              AND deleted_at IS NULL
            RETURNING ${cfg.cols}`,
      );
    } catch (err) {
      if ((err as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Această înregistrare există deja.');
      }
      throw err;
    }
    const list = rows as unknown as BeneficiaryRecord[];
    if (!list.length) throw new NotFoundException(`Beneficiary ${kind} ${id} not found`);
    return list[0];
  }

  async softDelete(
    kind: RecordKind,
    orgId: string,
    beneficiaryId: string,
    id: string,
  ): Promise<void> {
    const cfg = KINDS[kind];
    const rows = await this.drizzleProvider.db.execute(
      sql`UPDATE ${sql.raw(cfg.table)}
          SET deleted_at = now(), updated_at = now()
          WHERE id = ${id}::uuid
            AND organization_id = ${orgId}::uuid
            AND beneficiary_id = ${beneficiaryId}::uuid
            AND deleted_at IS NULL
          RETURNING id`,
    );
    if (!(rows as unknown as { id: string }[]).length) {
      throw new NotFoundException(`Beneficiary ${kind} ${id} not found`);
    }
    this.winston.log('flow', `Beneficiary ${kind} soft-deleted`, {
      context: 'BeneficiaryRecordsService',
      orgId,
      beneficiaryId,
      id,
    });
  }
}
