import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class MachinesService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(filters?: { machineType?: string; isActive?: boolean }) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (filters?.machineType) {
      conditions.push(sql`machine_type = ${filters.machineType}`);
    }
    if (filters?.isActive !== undefined) {
      conditions.push(sql`is_active = ${filters.isActive}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM machines WHERE ${where} ORDER BY created_at DESC`,
    );
    return result;
  }

  async findById(id: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM machines WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Machine ${id} not found`);
    }
    return rows[0];
  }

  async create(dto: Record<string, unknown>) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO machines (
        machine_type, registration_plate, internal_code, make, model, year,
        fuel_type, tank_capacity_liters, farmtrack_device_id,
        current_odometer_km, current_hourmeter_hrs, is_active,
        max_payload_kg, max_bale_count, tare_weight_kg,
        bales_per_hour_avg, bale_weight_avg_kg, reach_meters
      ) VALUES (
        ${dto.machineType}, ${dto.registrationPlate}, ${dto.internalCode},
        ${dto.make}, ${dto.model}, ${dto.year},
        ${dto.fuelType}, ${dto.tankCapacityLiters},
        ${dto.farmtrackDeviceId ?? null},
        ${dto.currentOdometerKm ?? 0}, ${dto.currentHourmeterHrs ?? 0}, true,
        ${dto.maxPayloadKg ?? null}, ${dto.maxBaleCount ?? null},
        ${dto.tareWeightKg ?? null}, ${dto.balesPerHourAvg ?? null},
        ${dto.baleWeightAvgKg ?? null}, ${dto.reachMeters ?? null}
      ) RETURNING *`,
    );
    return result;
  }

  async update(id: string, dto: Record<string, unknown>) {
    await this.findById(id);

    const setClauses: ReturnType<typeof sql>[] = [];
    const fieldMap: Record<string, string> = {
      machineType: 'machine_type',
      registrationPlate: 'registration_plate',
      internalCode: 'internal_code',
      make: 'make',
      model: 'model',
      year: 'year',
      fuelType: 'fuel_type',
      tankCapacityLiters: 'tank_capacity_liters',
      farmtrackDeviceId: 'farmtrack_device_id',
      currentOdometerKm: 'current_odometer_km',
      currentHourmeterHrs: 'current_hourmeter_hrs',
      isActive: 'is_active',
      maxPayloadKg: 'max_payload_kg',
      maxBaleCount: 'max_bale_count',
      tareWeightKg: 'tare_weight_kg',
      balesPerHourAvg: 'bales_per_hour_avg',
      baleWeightAvgKg: 'bale_weight_avg_kg',
      reachMeters: 'reach_meters',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (key in dto) {
        setClauses.push(sql`${sql.raw(column)} = ${dto[key] as string | number | boolean | null}`);
      }
    }

    if (setClauses.length === 0) {
      return this.findById(id);
    }

    setClauses.push(sql`updated_at = NOW()`);
    const setClause = sql.join(setClauses, sql`, `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE machines SET ${setClause} WHERE id = ${id} AND deleted_at IS NULL RETURNING *`,
    );
    return result;
  }

  async softDelete(id: string) {
    await this.findById(id);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE machines SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${id} RETURNING *`,
    );
    return result;
  }
}
