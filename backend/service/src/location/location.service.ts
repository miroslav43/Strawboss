import { Injectable, BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { LocationReportDto, MachineLastLocation } from '@strawboss/types';

@Injectable()
export class LocationService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  /**
   * Store a single GPS ping from a mobile device.
   * Any authenticated operator can report their position.
   */
  async reportLocation(dto: LocationReportDto, operatorId: string): Promise<void> {
    if (dto.lat < -90 || dto.lat > 90 || dto.lon < -180 || dto.lon > 180) {
      throw new BadRequestException('Invalid coordinates');
    }

    await this.drizzleProvider.db.execute(sql`
      INSERT INTO machine_location_events
        (machine_id, operator_id, lat, lon, accuracy_m, heading_deg, speed_ms, recorded_at)
      VALUES (
        ${dto.machineId}::uuid,
        ${operatorId}::uuid,
        ${dto.lat},
        ${dto.lon},
        ${dto.accuracyM ?? null},
        ${dto.headingDeg ?? null},
        ${dto.speedMs ?? null},
        ${dto.recordedAt}::timestamptz
      )
    `);
  }

  /**
   * Return the last known position for every machine that has reported GPS.
   * Joined with machines and users tables to include display labels.
   * Admin-only endpoint.
   */
  async getLastKnownPositions(): Promise<MachineLastLocation[]> {
    const result = await this.drizzleProvider.db.execute(sql`
      SELECT DISTINCT ON (mle.machine_id)
        mle.machine_id                                        AS "machineId",
        m.machine_type                                        AS "machineType",
        COALESCE(m.internal_code, m.registration_plate)      AS "machineCode",
        mle.operator_id                                       AS "operatorId",
        u.full_name                                           AS "operatorName",
        mle.lat,
        mle.lon,
        mle.accuracy_m   AS "accuracyM",
        mle.heading_deg  AS "headingDeg",
        mle.speed_ms     AS "speedMs",
        mle.recorded_at  AS "recordedAt"
      FROM machine_location_events mle
      LEFT JOIN machines m ON m.id = mle.machine_id
      LEFT JOIN users    u ON u.id = mle.operator_id
      WHERE mle.machine_id IS NOT NULL
      ORDER BY mle.machine_id, mle.recorded_at DESC
    `);

    return result as unknown as MachineLastLocation[];
  }
}
