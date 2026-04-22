import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
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
export class TripsService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
    @InjectQueue(QUEUE_CMR_GENERATION) private readonly cmrQueue: Queue,
    private readonly notificationsService: NotificationsService,
  ) {}

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
    dateFrom?: string;
    dateTo?: string;
  }) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (filters?.status) {
      const statuses = filters.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        conditions.push(sql`status = ${statuses[0]}::trip_status`);
      } else if (statuses.length > 1) {
        // Build IN clause with explicit cast for each value
        const castList = sql.join(
          statuses.map((s) => sql`${s}::trip_status`),
          sql`, `,
        );
        conditions.push(sql`status IN (${castList})`);
      }
    }
    if (filters?.driverId) {
      conditions.push(sql`driver_id = ${filters.driverId}`);
    }
    if (filters?.truckId) {
      conditions.push(sql`truck_id = ${filters.truckId}`);
    }
    if (filters?.sourceParcelId) {
      conditions.push(sql`source_parcel_id = ${filters.sourceParcelId}`);
    }
    if (filters?.dateFrom) {
      conditions.push(sql`created_at >= ${filters.dateFrom}`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`created_at <= ${filters.dateTo}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM trips WHERE ${where} ORDER BY created_at DESC LIMIT 1000`,
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
