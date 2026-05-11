import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

/** All machine columns aliased to camelCase so the API is consistent. */
const MACHINE_COLS = sql`
  id,
  machine_type              AS "machineType",
  registration_plate        AS "registrationPlate",
  internal_code             AS "internalCode",
  make,
  model,
  year,
  fuel_type                 AS "fuelType",
  tank_capacity_liters      AS "tankCapacityLiters",
  farmtrack_device_id       AS "farmtrackDeviceId",
  current_odometer_km       AS "currentOdometerKm",
  current_hourmeter_hrs     AS "currentHourmeterHrs",
  is_active                 AS "isActive",
  max_bale_count            AS "maxBaleCount",
  tare_weight_kg            AS "tareWeightKg",
  bale_weight_avg_kg        AS "baleWeightAvgKg",
  owner_company_name        AS "ownerCompanyName",
  owner_company_address     AS "ownerCompanyAddress",
  owner_company_cui         AS "ownerCompanyCui",
  created_at                AS "createdAt",
  updated_at                AS "updatedAt",
  deleted_at                AS "deletedAt"
`;

@Injectable()
export class MachinesService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(orgId: string | null, filters?: { machineType?: string; isActive?: boolean }) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    if (filters?.machineType) {
      conditions.push(sql`machine_type = ${filters.machineType}`);
    }
    if (filters?.isActive !== undefined) {
      conditions.push(sql`is_active = ${filters.isActive}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${MACHINE_COLS} FROM machines WHERE ${where} ORDER BY created_at DESC`,
    );
    return result;
  }

  async findById(id: string, orgId: string | null) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`id = ${id}::uuid`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${MACHINE_COLS} FROM machines WHERE ${where} LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Machine ${id} not found`);
    }
    return rows[0];
  }

  async create(orgId: string | null, dto: Record<string, unknown>) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO machines (
        organization_id,
        machine_type, registration_plate, internal_code, make, model, year,
        fuel_type, tank_capacity_liters, farmtrack_device_id,
        current_odometer_km, current_hourmeter_hrs, is_active,
        max_bale_count, tare_weight_kg, bale_weight_avg_kg,
        owner_company_name, owner_company_address, owner_company_cui
      ) VALUES (
        ${orgId}::uuid,
        ${dto.machineType}::machine_type,
        ${dto.registrationPlate},
        ${dto.internalCode},
        ${dto.make}, ${dto.model}, ${dto.year},
        ${dto.fuelType}::fuel_type,
        ${dto.tankCapacityLiters},
        ${dto.farmtrackDeviceId ?? null},
        ${dto.currentOdometerKm ?? 0},
        ${dto.currentHourmeterHrs ?? 0},
        true,
        ${dto.maxBaleCount ?? null},
        ${dto.tareWeightKg ?? null},
        ${dto.baleWeightAvgKg ?? null},
        ${dto.ownerCompanyName ?? null},
        ${dto.ownerCompanyAddress ?? null},
        ${dto.ownerCompanyCui ?? null}
      ) RETURNING ${MACHINE_COLS}`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }

  async update(id: string, orgId: string | null, dto: Record<string, unknown>) {
    await this.findById(id, orgId);

    const setClauses: ReturnType<typeof sql>[] = [];
    const fieldMap: Record<string, string> = {
      machineType:          'machine_type',
      registrationPlate:    'registration_plate',
      internalCode:         'internal_code',
      make:                 'make',
      model:                'model',
      year:                 'year',
      fuelType:             'fuel_type',
      tankCapacityLiters:   'tank_capacity_liters',
      farmtrackDeviceId:    'farmtrack_device_id',
      currentOdometerKm:    'current_odometer_km',
      currentHourmeterHrs:  'current_hourmeter_hrs',
      isActive:             'is_active',
      maxBaleCount:         'max_bale_count',
      tareWeightKg:         'tare_weight_kg',
      baleWeightAvgKg:      'bale_weight_avg_kg',
      ownerCompanyName:     'owner_company_name',
      ownerCompanyAddress:  'owner_company_address',
      ownerCompanyCui:      'owner_company_cui',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (key in dto) {
        setClauses.push(
          sql`${sql.raw(column)} = ${dto[key] as string | number | boolean | null}`,
        );
      }
    }

    if (setClauses.length === 0) {
      return this.findById(id, orgId);
    }

    setClauses.push(sql`updated_at = NOW()`);
    const setClause = sql.join(setClauses, sql`, `);

    const updateConditions: ReturnType<typeof sql>[] = [
      sql`id = ${id}::uuid`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) updateConditions.push(sql`organization_id = ${orgId}::uuid`);
    const updateWhere = sql.join(updateConditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE machines SET ${setClause}
          WHERE ${updateWhere}
          RETURNING ${MACHINE_COLS}`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }

  async softDelete(id: string, orgId: string | null) {
    await this.findById(id, orgId);

    const deleteConditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`];
    if (orgId !== null) deleteConditions.push(sql`organization_id = ${orgId}::uuid`);
    const deleteWhere = sql.join(deleteConditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE machines
          SET deleted_at = NOW(), updated_at = NOW()
          WHERE ${deleteWhere}
          RETURNING ${MACHINE_COLS}`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }
}
