import { Injectable, BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type {
  LocationReportDto,
  MachineLastLocation,
  RouteHistoryResponse,
  RoutePoint,
} from '@strawboss/types';

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
        au.id                                                 AS "assignedUserId",
        au.full_name                                          AS "assignedUserName",
        mle.lat,
        mle.lon,
        mle.accuracy_m   AS "accuracyM",
        mle.heading_deg  AS "headingDeg",
        mle.speed_ms     AS "speedMs",
        mle.recorded_at  AS "recordedAt"
      FROM machine_location_events mle
      LEFT JOIN machines m  ON m.id = mle.machine_id
      LEFT JOIN users    u  ON u.id = mle.operator_id
      LEFT JOIN users    au ON au.assigned_machine_id = mle.machine_id
                            AND au.deleted_at IS NULL
      WHERE mle.machine_id IS NOT NULL
      ORDER BY mle.machine_id, mle.recorded_at DESC
    `);

    return result as unknown as MachineLastLocation[];
  }

  /**
   * Return the GPS route history for a specific machine within a time range.
   * Points are ordered chronologically (ASC) with a safety cap of 50 000 rows.
   */
  async getRouteHistory(
    machineId: string,
    from: string,
    to: string,
  ): Promise<RouteHistoryResponse> {
    // Validate machineId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(machineId)) {
      throw new BadRequestException('Invalid machineId: must be a valid UUID');
    }

    // Validate from/to are valid ISO-8601 dates
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (isNaN(fromDate.getTime())) {
      throw new BadRequestException('Invalid "from" parameter: must be a valid ISO-8601 date');
    }
    if (isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid "to" parameter: must be a valid ISO-8601 date');
    }
    if (fromDate >= toDate) {
      throw new BadRequestException('"from" must be before "to"');
    }

    const machineResult = await this.drizzleProvider.db.execute(sql`
      SELECT
        COALESCE(internal_code, registration_plate) AS "machineCode",
        machine_type AS "machineType"
      FROM machines
      WHERE id = ${machineId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `);
    const machine = (machineResult as unknown as Array<{
      machineCode: string | null;
      machineType: string | null;
    }>)[0] ?? null;

    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        lat,
        lon,
        accuracy_m   AS "accuracyM",
        heading_deg  AS "headingDeg",
        speed_ms     AS "speedMs",
        recorded_at  AS "recordedAt"
      FROM machine_location_events
      WHERE machine_id = ${machineId}::uuid
        AND recorded_at >= ${from}::timestamptz
        AND recorded_at <= ${to}::timestamptz
      ORDER BY recorded_at ASC
      LIMIT 50000
    `);

    const points = result as unknown as RoutePoint[];

    return {
      machineId,
      machineCode: machine?.machineCode ?? null,
      machineType: machine?.machineType ?? null,
      from,
      to,
      totalPoints: points.length,
      points,
    };
  }
}
