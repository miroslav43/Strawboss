import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Headers,
  Req,
  Res,
  Inject,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Logger as WinstonLogger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { ParcelsService } from './parcels.service';
import { SeasonsService } from '../seasons/seasons.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createParcelSchema,
  updateParcelSchema,
  importParcelsSchema,
  overrideBalesSchema,
  transferToDepotSchema,
} from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';
import type { RequestUser } from '../auth/auth.guard';
import { RequireFeature } from '../features/require-feature.decorator';

@Controller('parcels')
export class ParcelsController {
  constructor(
    private readonly parcelsService: ParcelsService,
    private readonly seasons: SeasonsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: WinstonLogger,
  ) {}

  /**
   * The parcels list can be 1-10 MB (bale-tally joins over every parcel) and
   * is re-fetched on every mobile MapScreen mount, so it is ETag-validated:
   * `getListCacheMeta()` mirrors this handler's exact filters but only reads
   * max(sync_version)/count — cheap enough to run before the heavy query on
   * every request. A match against `If-None-Match` short-circuits to a bare
   * 304. Response body for a 200 is byte-identical to before this feature.
   *
   * Uses a non-passthrough @Res() (see DocumentsController.download for the
   * same idiom) so we can send either a bodyless 304 or the normal 200 body
   * from one handler.
   */
  @Get()
  async list(
    // Required params first — NestJS binds by decorator, not position, so this
    // order is purely to satisfy TS1016 (no required param after an optional).
    @CurrentUser() user: RequestUser,
    @Res() res: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
    @Query('municipality') municipality?: string,
    @Query('isActive') isActive?: string,
    @Query('cropType') cropType?: string,
  ) {
    // T9.2 — `isActive` accepted for back-compat but ignored downstream.
    const filters = {
      municipality,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      cropType,
    };

    const seasonYear = this.seasons.gateYear(user.organizationId, user.activeSeasonYear);
    const meta = await this.parcelsService.getListCacheMeta(user.organizationId, filters);
    // The season is part of the ETag because it changes the RESPONSE without
    // changing any row: closing a season re-scopes every bale tally in this
    // payload, but bumps no sync_version. Without it, a phone that validated
    // before the rollover would keep getting 304 and keep showing last season's
    // numbers on the map indefinitely.
    const etag = `"p${meta.version}-${meta.count}-s${seasonYear ?? 'all'}"`;

    if (ifNoneMatch && ifNoneMatch === etag) {
      res.header('ETag', etag).status(304).send();
      return;
    }

    const rows = await this.parcelsService.list(user.organizationId, filters, seasonYear);
    res.header('ETag', etag).status(200).send(rows);
  }

  @Get(':id/bale-availability')
  getBaleAvailability(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    // The ACTIVE season, not a query parameter — this is what the loader app
    // reads to decide whether a field still has bales to take.
    return this.parcelsService.getBaleAvailability(
      id,
      user.organizationId,
      this.seasons.gateYear(user.organizationId, user.activeSeasonYear),
    );
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.parcelsService.findById(id, user.organizationId);
  }

  @Post()
  @RequireFeature('geo.parcels')
  @Roles('admin' as UserRole, 'geofence_maker' as UserRole)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createParcelSchema)) dto: Record<string, unknown>,
  ) {
    return this.parcelsService.create(user.organizationId, dto);
  }

  @Post('import')
  @RequireFeature('geo.kml_import')
  @Roles('admin' as UserRole, 'geofence_maker' as UserRole)
  import(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(importParcelsSchema))
    dto: { farmId?: string | null; parcels: Array<Record<string, unknown>> },
  ) {
    return this.parcelsService.importMany(user.organizationId, dto);
  }

  @Post(':id/override-bales')
  @RequireFeature('bales.adjustments')
  @Roles('admin' as UserRole)
  overrideBales(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(overrideBalesSchema))
    dto: { produced?: number; loaded?: number; reason?: string; balerId?: string },
  ) {
    return this.parcelsService.overrideBales(id, dto, user.id, user.organizationId);
  }

  @Post(':id/transfer-to-depot')
  @RequireFeature('bales.adjustments')
  @Roles('admin' as UserRole)
  transferToDepot(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(transferToDepotSchema))
    dto: { destinationId: string; baleCount: number },
  ) {
    return this.parcelsService.transferToDepot(id, dto, user.id, user.organizationId);
  }

  @Patch(':id')
  @RequireFeature('geo.parcels')
  @Roles('admin' as UserRole, 'geofence_maker' as UserRole)
  update(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateParcelSchema)) dto: Record<string, unknown>,
  ) {
    return this.parcelsService.update(id, user.organizationId, dto);
  }

  @Delete(':id')
  @RequireFeature('geo.parcels')
  @Roles('admin' as UserRole)
  async softDelete(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: { user?: { id: string; role: string } },
  ) {
    this.winston.info('DELETE parcel started', {
      context: 'ParcelsController',
      parcelId: id,
      userId: req.user?.id ?? null,
      role: req.user?.role ?? null,
    });
    try {
      const result = await this.parcelsService.softDelete(id, user.organizationId);
      this.winston.info('DELETE parcel success', {
        context: 'ParcelsController',
        parcelId: id,
      });
      return result;
    } catch (err) {
      this.winston.error('DELETE parcel failed', {
        context: 'ParcelsController',
        parcelId: id,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  }
}
