import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  OnModuleInit,
} from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { TripStatus } from '@strawboss/types';
import { QUEUE_CMR_GENERATION } from '../jobs/queues';
import type {
  TripCreateDto,
  StartLoadingDto,
  CompleteLoadingDto,
  DepartDto,
  ArriveDto,
  StartDeliveryDto,
  ConfirmDeliveryDto,
  CompleteDto,
  CancelDto,
  DisputeDto,
  ResolveDisputeDto,
} from '@strawboss/types';
import { getAvailableTransitions } from '@strawboss/domain';

@Injectable()
export class TripsService implements OnModuleInit {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
    @InjectQueue(QUEUE_CMR_GENERATION) private readonly cmrQueue: Queue,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * On boot, reconcile any truck task_assignments that were fully wired
   * up (parent loader + destination) but never had a Trip materialized —
   * e.g. created before this feature shipped, or during a window where
   * auto-upsert errored out. Idempotent: only rows with trip_id IS NULL.
   */
  async onModuleInit(): Promise<void> {
    try {
      const rows = (await this.drizzleProvider.db.execute(
        sql`SELECT ta.id
            FROM task_assignments ta
            JOIN machines m ON m.id = ta.machine_id
            WHERE m.machine_type = 'truck'
              AND ta.deleted_at IS NULL
              AND ta.trip_id IS NULL
              AND ta.parent_assignment_id IS NOT NULL
              AND ta.destination_id IS NOT NULL`,
      )) as unknown as { id: string }[];
      if (rows.length === 0) return;

      this.winston.log(
        'flow',
        `Auto-trip backfill: reconciling ${rows.length} truck task(s) on boot`,
        { context: 'TripsService', count: rows.length },
      );
      for (const row of rows) {
        try {
          await this.autoUpsertFromTruckTask(row.id);
        } catch (err) {
          this.winston.warn(
            `Auto-trip backfill failed for task ${row.id}`,
            {
              context: 'TripsService',
              taskId: row.id,
              err: err instanceof Error ? { message: err.message } : err,
            },
          );
        }
      }
    } catch (err) {
      // Never block boot — log and move on.
      this.winston.error('Auto-trip backfill scan failed on boot', {
        context: 'TripsService',
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
    }
  }

  private async pushToDriver(tripId: string, title: string, body: string, type: string): Promise<void> {
    try {
      const rows = await this.drizzleProvider.db.execute(
        sql`SELECT driver_id FROM trips WHERE id = ${tripId} AND driver_id IS NOT NULL LIMIT 1`,
      ) as unknown as { driver_id: string }[];
      if (rows[0]?.driver_id) {
        await this.notificationsService.sendPush(rows[0].driver_id, title, body, { type, tripId });
      }
    } catch {
      // Best-effort — never fail a trip transition due to push error
    }
  }

  private logTripFlow(
    tripId: string,
    event: string,
    fromStatus: string,
    toStatus: string,
  ): void {
    this.winston.log('flow', `Trip ${tripId} ${event}: ${fromStatus} → ${toStatus}`, {
      context: 'TripsService',
      tripId,
      event,
      fromStatus,
      toStatus,
    });
  }

  async list(filters?: {
    status?: string; // single value OR comma-separated values (e.g. "planned,loading")
    driverId?: string;
    truckId?: string;
    sourceParcelId?: string;
    loaderOperatorId?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const conditions: ReturnType<typeof sql>[] = [sql`t.deleted_at IS NULL`];

    if (filters?.status) {
      const statuses = filters.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        conditions.push(sql`t.status = ${statuses[0]}::trip_status`);
      } else if (statuses.length > 1) {
        const castList = sql.join(
          statuses.map((s) => sql`${s}::trip_status`),
          sql`, `,
        );
        conditions.push(sql`t.status IN (${castList})`);
      }
    }
    if (filters?.driverId) {
      conditions.push(sql`t.driver_id = ${filters.driverId}`);
    }
    if (filters?.truckId) {
      conditions.push(sql`t.truck_id = ${filters.truckId}`);
    }
    if (filters?.sourceParcelId) {
      conditions.push(sql`t.source_parcel_id = ${filters.sourceParcelId}`);
    }
    if (filters?.loaderOperatorId) {
      conditions.push(sql`t.loader_operator_id = ${filters.loaderOperatorId}`);
    }
    if (filters?.dateFrom) {
      conditions.push(sql`t.created_at >= ${filters.dateFrom}`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`t.created_at <= ${filters.dateTo}`);
    }

    const where = sql.join(conditions, sql` AND `);
    // LEFT JOIN destinations/machines/users so the admin table can show
    // human-readable labels without per-row lookups.
    // Trips already store `destination_name` inline (denormalized on create),
    // so we only need to enrich truck / driver / source-parcel labels here.
    const result = await this.drizzleProvider.db.execute(
      sql`
        SELECT
          t.*,
          m.registration_plate                         AS truck_plate,
          m.internal_code                              AS truck_code,
          u.full_name                                  AS driver_name,
          p.name                                       AS source_parcel_name,
          p.code                                       AS source_parcel_code
        FROM trips t
        LEFT JOIN machines m ON m.id = t.truck_id
        LEFT JOIN users    u ON u.id = t.driver_id
        LEFT JOIN parcels  p ON p.id = t.source_parcel_id
        WHERE ${where}
        ORDER BY t.created_at DESC
        LIMIT 1000
      `,
    );
    return result;
  }

  async findById(id: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM trips WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Trip ${id} not found`);
    }
    return rows[0];
  }

  async create(dto: TripCreateDto) {
    const tripNumber = await this.generateTripNumber();

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO trips (
        trip_number, status, source_parcel_id, truck_id, driver_id,
        loader_id, loader_operator_id, destination_name,
        destination_address, destination_coords,
        bale_count, source_parcel_auto, sync_version
      ) VALUES (
        ${tripNumber}, ${TripStatus.planned}, ${dto.sourceParcelId},
        ${dto.truckId}, ${dto.driverId},
        ${dto.loaderId ?? null}, ${dto.loaderOperatorId ?? null},
        ${dto.destinationName ?? null}, ${dto.destinationAddress ?? null},
        ${dto.destinationCoords ? JSON.stringify(dto.destinationCoords) : null},
        0, false, 1
      ) RETURNING *`,
    );
    const created = (result as unknown as Record<string, unknown>[])[0];
    this.logTripFlow(
      String(created?.id ?? 'unknown'),
      'CREATE',
      'new',
      TripStatus.planned,
    );
    return result;
  }

  private async generateTripNumber(): Promise<string> {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `TR-${dateStr}-`;

    const result = await this.drizzleProvider.db.execute(
      sql`SELECT COUNT(*)::int as count FROM trips WHERE trip_number LIKE ${prefix + '%'}`,
    );
    const rows = result as unknown as { count: number }[];
    const count = (rows[0]?.count ?? 0) + 1;
    const seq = String(count).padStart(3, '0');
    return `${prefix}${seq}`;
  }

  private validateTransition(currentStatus: TripStatus, event: string): void {
    const available = getAvailableTransitions(currentStatus);
    if (!available.includes(event)) {
      throw new BadRequestException(
        `Transition '${event}' is not allowed from status '${currentStatus}'. Available: ${available.join(', ')}`,
      );
    }
  }

  async startLoading(id: string, dto: StartLoadingDto) {
    const trip = await this.findById(id);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'START_LOADING');

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.loading},
        loader_operator_id = ${dto.loaderOperatorId},
        loader_id = ${dto.loaderId ?? (trip.loader_id as string | null)},
        loading_started_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'START_LOADING', from, TripStatus.loading);
    return result;
  }

  async completeLoading(id: string, _dto: CompleteLoadingDto) {
    const trip = await this.findById(id);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'COMPLETE_LOADING');

    const baleResult = await this.drizzleProvider.db.execute(
      sql`SELECT COALESCE(SUM(bale_count), 0)::int as total FROM bale_loads WHERE trip_id = ${id} AND deleted_at IS NULL`,
    );
    const baleRows = baleResult as unknown as { total: number }[];
    const totalBales = baleRows[0]?.total ?? 0;

    if (totalBales === 0) {
      throw new BadRequestException(
        'Cannot complete loading without any bale loads recorded',
      );
    }

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.loaded},
        loading_completed_at = NOW(),
        bale_count = ${totalBales},
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'COMPLETE_LOADING', from, TripStatus.loaded);
    void this.pushToDriver(id, 'Transport pregătit', 'Baloții au fost încărcați. Poți pleca.', 'trip_loaded');
    return result;
  }

  async depart(id: string, dto: DepartDto) {
    const trip = await this.findById(id);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'DEPART');

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.in_transit},
        departure_odometer_km = ${dto.departureOdometerKm},
        departure_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'DEPART', from, TripStatus.in_transit);
    return result;
  }

  async arrive(id: string, dto: ArriveDto) {
    const trip = await this.findById(id);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'ARRIVE');

    const departureOdometer = trip.departure_odometer_km as number | null;
    const odometerDistance =
      departureOdometer !== null
        ? dto.arrivalOdometerKm - departureOdometer
        : null;

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.arrived},
        arrival_odometer_km = ${dto.arrivalOdometerKm},
        arrival_at = NOW(),
        odometer_distance_km = ${odometerDistance},
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'ARRIVE', from, TripStatus.arrived);
    void this.pushToDriver(id, 'Ai ajuns la destinație', 'Confirmă livrarea când ești gata.', 'trip_arrived');
    return result;
  }

  async startDelivery(id: string, dto: StartDeliveryDto) {
    const trip = await this.findById(id);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'START_DELIVERY');

    const setClauses: ReturnType<typeof sql>[] = [
      sql`status = ${TripStatus.delivering}`,
      sql`updated_at = NOW()`,
    ];

    if (dto.destinationName) {
      setClauses.push(sql`destination_name = ${dto.destinationName}`);
    }

    const setClause = sql.join(setClauses, sql`, `);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET ${setClause} WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'START_DELIVERY', from, TripStatus.delivering);
    return result;
  }

  async confirmDelivery(id: string, dto: ConfirmDeliveryDto) {
    const trip = await this.findById(id);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'CONFIRM_DELIVERY');

    // Fetch tare weight from the truck
    const truckResult = await this.drizzleProvider.db.execute(
      sql`SELECT tare_weight_kg FROM machines WHERE id = ${trip.truck_id as string} LIMIT 1`,
    );
    const truckRows = truckResult as unknown as { tare_weight_kg: number | null }[];
    const tareWeightKg = truckRows[0]?.tare_weight_kg ?? null;
    const netWeightKg =
      tareWeightKg !== null ? dto.grossWeightKg - tareWeightKg : null;

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.delivered},
        gross_weight_kg = ${dto.grossWeightKg},
        tare_weight_kg = ${tareWeightKg},
        net_weight_kg = ${netWeightKg},
        weight_ticket_number = ${dto.weightTicketNumber ?? null},
        delivered_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'CONFIRM_DELIVERY', from, TripStatus.delivered);
    return result;
  }

  async complete(id: string, dto: CompleteDto) {
    const trip = await this.findById(id);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'COMPLETE');

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.completed},
        receiver_name = ${dto.receiverName},
        receiver_signature_url = ${dto.receiverSignature},
        receiver_signed_at = NOW(),
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'COMPLETE', from, TripStatus.completed);
    void this.pushToDriver(id, 'Transport finalizat', 'Transportul a fost completat cu succes.', 'trip_completed');

    // Auto-generate CMR document in background (after signature is captured)
    await this.cmrQueue.add('generate', { tripId: id });
    this.winston.log('flow', `CMR generation queued for trip ${id}`, {
      context: 'TripsService',
      tripId: id,
    });

    return result;
  }

  async cancel(id: string, dto: CancelDto) {
    const trip = await this.findById(id);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'CANCEL');

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.cancelled},
        cancelled_at = NOW(),
        cancellation_reason = ${dto.cancellationReason},
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'CANCEL', from, TripStatus.cancelled);
    return result;
  }

  async dispute(id: string, _dto: DisputeDto) {
    const trip = await this.findById(id);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'DISPUTE');

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.disputed},
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'DISPUTE', from, TripStatus.disputed);
    void this.pushToDriver(id, 'Dispută transport', 'Transportul tău a intrat în dispută. Contactează dispeceratul.', 'trip_disputed');
    return result;
  }

  // ────────────────────────────────────────────────────────────────────
  // Auto-trip from truck task assignment (Option B)
  //
  // When admin wires up a truck task (parent loader + destination),
  // we materialize a Trip in `planned` status so the loader app and the
  // rest of the system have something to work with. Idempotent via
  // `task_assignments.trip_id`; only mutates trips still in `planned`.
  // ────────────────────────────────────────────────────────────────────

  /**
   * Create or update a Trip that mirrors a truck task_assignment.
   * No-op if the task is not a truck, is incomplete, or if no driver is
   * assigned to the truck.
   */
  async autoUpsertFromTruckTask(taskId: string): Promise<void> {
    // Load truck task + machine type in one shot.
    const taskRows = (await this.drizzleProvider.db.execute(
      sql`SELECT
        ta.id, ta.machine_id, ta.parent_assignment_id, ta.destination_id,
        ta.trip_id, ta.deleted_at,
        m.machine_type
      FROM task_assignments ta
      JOIN machines m ON m.id = ta.machine_id
      WHERE ta.id = ${taskId}
      LIMIT 1`,
    )) as unknown as {
      id: string;
      machine_id: string;
      parent_assignment_id: string | null;
      destination_id: string | null;
      trip_id: string | null;
      deleted_at: string | null;
      machine_type: string;
    }[];
    const task = taskRows[0];
    if (!task || task.deleted_at !== null) return;
    if (task.machine_type !== 'truck') return;
    if (!task.parent_assignment_id || !task.destination_id) {
      // Not enough info yet — keep any existing trip as-is and wait
      // for admin to finish wiring up the task.
      return;
    }

    // Resolve driver: user whose assigned_machine_id == truck.
    const driverRows = (await this.drizzleProvider.db.execute(
      sql`SELECT id FROM users
          WHERE assigned_machine_id = ${task.machine_id}
            AND deleted_at IS NULL
          ORDER BY created_at ASC
          LIMIT 1`,
    )) as unknown as { id: string }[];
    const driverId = driverRows[0]?.id ?? null;
    if (!driverId) {
      this.winston.warn(
        `Auto-trip skipped: truck ${task.machine_id} has no driver assigned (users.assigned_machine_id)`,
        { context: 'TripsService', taskId, truckId: task.machine_id },
      );
      return;
    }

    // Resolve parent (loader task) for source parcel + loader machine + loader operator.
    const parentRows = (await this.drizzleProvider.db.execute(
      sql`SELECT id, machine_id, parcel_id, assigned_user_id
          FROM task_assignments
          WHERE id = ${task.parent_assignment_id}
            AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as {
      id: string;
      machine_id: string;
      parcel_id: string | null;
      assigned_user_id: string | null;
    }[];
    const parent = parentRows[0];
    if (!parent) return;

    const sourceParcelId = parent.parcel_id;
    const loaderMachineId = parent.machine_id;

    // Loader operator: prefer explicit assigned_user_id on the loader task,
    // fall back to whoever is permanently linked to the loader machine.
    let loaderOperatorId: string | null = parent.assigned_user_id;
    if (!loaderOperatorId && loaderMachineId) {
      const opRows = (await this.drizzleProvider.db.execute(
        sql`SELECT id FROM users
            WHERE assigned_machine_id = ${loaderMachineId}
              AND deleted_at IS NULL
            ORDER BY created_at ASC
            LIMIT 1`,
      )) as unknown as { id: string }[];
      loaderOperatorId = opRows[0]?.id ?? null;
    }

    // Destination details (used to denormalize into trips.destination_*).
    const destRows = (await this.drizzleProvider.db.execute(
      sql`SELECT name, address, ST_AsGeoJSON(coords) AS coords_geojson
          FROM delivery_destinations
          WHERE id = ${task.destination_id} AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as { name: string; address: string | null; coords_geojson: string | null }[];
    const dest = destRows[0];
    if (!dest) return;
    const destCoordsGeoJson = dest.coords_geojson;

    if (!task.trip_id) {
      // ── INSERT path
      const tripNumber = await this.generateTripNumber();
      const inserted = (await this.drizzleProvider.db.execute(
        sql`INSERT INTO trips (
          trip_number, status, source_parcel_id, truck_id, driver_id,
          loader_id, loader_operator_id,
          destination_name, destination_address, destination_coords,
          bale_count, source_parcel_auto, sync_version
        ) VALUES (
          ${tripNumber}, ${TripStatus.planned}, ${sourceParcelId},
          ${task.machine_id}, ${driverId},
          ${loaderMachineId}, ${loaderOperatorId},
          ${dest.name}, ${dest.address ?? null},
          ${destCoordsGeoJson ? sql`ST_GeomFromGeoJSON(${destCoordsGeoJson})` : sql`NULL`},
          0, false, 1
        ) RETURNING id`,
      )) as unknown as { id: string }[];
      const tripId = inserted[0]?.id;
      if (!tripId) return;

      await this.drizzleProvider.db.execute(
        sql`UPDATE task_assignments SET trip_id = ${tripId}, updated_at = NOW() WHERE id = ${taskId}`,
      );

      this.logTripFlow(tripId, 'AUTO_CREATE_FROM_TASK', 'new', TripStatus.planned);
      this.winston.log('flow', `Auto-created trip ${tripId} from truck task ${taskId}`, {
        context: 'TripsService',
        tripId,
        taskId,
        truckId: task.machine_id,
        driverId,
      });
      return;
    }

    // ── UPDATE path: only while trip is still in `planned`.
    const statusRows = (await this.drizzleProvider.db.execute(
      sql`SELECT status FROM trips WHERE id = ${task.trip_id} LIMIT 1`,
    )) as unknown as { status: string }[];
    const currentStatus = statusRows[0]?.status;
    if (!currentStatus) return;
    if (currentStatus !== TripStatus.planned) {
      this.winston.log(
        'flow',
        `Auto-trip update skipped: trip ${task.trip_id} already in status ${currentStatus}`,
        { context: 'TripsService', tripId: task.trip_id, taskId },
      );
      return;
    }

    await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        source_parcel_id = ${sourceParcelId},
        truck_id = ${task.machine_id},
        driver_id = ${driverId},
        loader_id = ${loaderMachineId},
        loader_operator_id = ${loaderOperatorId},
        destination_name = ${dest.name},
        destination_address = ${dest.address ?? null},
        destination_coords = ${destCoordsGeoJson ? sql`ST_GeomFromGeoJSON(${destCoordsGeoJson})` : sql`NULL`},
        updated_at = NOW()
      WHERE id = ${task.trip_id} AND status = ${TripStatus.planned}`,
    );

    this.winston.log('flow', `Auto-updated trip ${task.trip_id} from truck task ${taskId}`, {
      context: 'TripsService',
      tripId: task.trip_id,
      taskId,
    });
  }

  /**
   * Cancel a Trip that was auto-created from a truck task_assignment,
   * but only if the trip is still in `planned`. If work already started
   * (loading+) we leave it so ops can finish the real transport.
   */
  async autoCancelForTruckTask(taskId: string): Promise<void> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT trip_id FROM task_assignments WHERE id = ${taskId} LIMIT 1`,
    )) as unknown as { trip_id: string | null }[];
    const tripId = rows[0]?.trip_id ?? null;
    if (!tripId) return;

    const result = (await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.cancelled},
        cancelled_at = NOW(),
        cancellation_reason = 'Task assignment removed',
        updated_at = NOW()
      WHERE id = ${tripId} AND status = ${TripStatus.planned}
      RETURNING id`,
    )) as unknown as { id: string }[];

    if (result.length > 0) {
      this.logTripFlow(tripId, 'AUTO_CANCEL_FROM_TASK', TripStatus.planned, TripStatus.cancelled);
    } else {
      this.winston.log(
        'flow',
        `Auto-cancel skipped: trip ${tripId} is already past planned (real transport in progress)`,
        { context: 'TripsService', tripId, taskId },
      );
    }
  }

  /**
   * Soft-delete a trip and detach it from any linked task_assignment so a
   * future admin edit on the task can re-trigger auto-creation cleanly.
   *
   * Idempotent: if the trip is already soft-deleted, throws 404.
   */
  async softDelete(id: string) {
    const trip = await this.findById(id);
    const from = trip.status as TripStatus;

    if (!['planned', 'cancelled'].includes(from)) {
      throw new BadRequestException(
        `Tripul cu status "${from}" nu poate fi șters. Anulați-l mai întâi.`,
      );
    }

    await this.drizzleProvider.db.execute(
      sql`UPDATE task_assignments SET trip_id = NULL, updated_at = NOW() WHERE trip_id = ${id}`,
    );

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${id} RETURNING id`,
    );

    this.logTripFlow(id, 'DELETE', from, 'deleted');
    return result;
  }

  async resolveDispute(id: string, dto: ResolveDisputeDto) {
    const trip = await this.findById(id);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'RESOLVE_DISPUTE');

    const targetStatus = dto.resolvedTo === 'completed'
      ? TripStatus.completed
      : TripStatus.delivered;

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${targetStatus},
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'RESOLVE_DISPUTE', from, targetStatus);
    return result;
  }
}
