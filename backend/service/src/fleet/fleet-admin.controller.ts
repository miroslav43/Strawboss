import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { UserRole } from '@strawboss/types';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  updateDeviceSchema,
  createReleaseSchema,
  updateReleaseSchema,
  createDeploymentSchema,
  setDeviceTailscaleSchema,
  setDeviceSmsGatewaySchema,
  testSmsSchema,
  updateTailscaleSettingsSchema,
  createRemoteCommandSchema,
  type UpdateDeviceInput,
  type CreateReleaseInput,
  type UpdateReleaseInput,
  type CreateDeploymentInput,
  type SetDeviceTailscaleInput,
  type SetDeviceSmsGatewayInput,
  type TestSmsInput,
  type UpdateTailscaleSettingsInput,
  type CreateRemoteCommandInput,
} from '@strawboss/validation';
import { FleetService } from './fleet.service';

/**
 * Super-admin fleet management endpoints.
 * All routes require the super_admin role.
 */
@Controller('super-admin')
@Roles(UserRole.super_admin)
export class FleetAdminController {
  constructor(private readonly fleetService: FleetService) {}

  // ─── Devices ───────────────────────────────────────────────────────────────

  /** GET /api/v1/super-admin/devices */
  @Get('devices')
  listDevices() {
    return this.fleetService.listDevices();
  }

  /** GET /api/v1/super-admin/devices/:id */
  @Get('devices/:id')
  getDevice(@Param('id') id: string) {
    return this.fleetService.getDevice(id);
  }

  /** GET /api/v1/super-admin/devices/:id/uptime?days=3 — online/offline timeline */
  @Get('devices/:id/uptime')
  getDeviceUptime(@Param('id') id: string, @Query('days') daysRaw?: string) {
    const days = daysRaw ? Number(daysRaw) : 3;
    return this.fleetService.getDeviceUptime(id, Number.isFinite(days) ? days : 3);
  }

  /** PATCH /api/v1/super-admin/devices/:id */
  @Patch('devices/:id')
  updateDevice(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDeviceSchema)) dto: UpdateDeviceInput,
  ) {
    return this.fleetService.updateDevice(id, dto);
  }

  /** DELETE /api/v1/super-admin/devices/:id */
  @Delete('devices/:id')
  deleteDevice(@Param('id') id: string) {
    return this.fleetService.deleteDevice(id);
  }

  /** GET /api/v1/super-admin/devices/:id/ota-status */
  @Get('devices/:id/ota-status')
  getDeviceOtaStatus(@Param('id') id: string) {
    return this.fleetService.getDeviceOtaStatus(id);
  }

  /** GET /api/v1/super-admin/devices/:id/logs?level=&date= */
  @Get('devices/:id/logs')
  async getDeviceLogs(
    @Param('id') id: string,
    @Query('level') level?: string,
    @Query('date') date?: string,
  ) {
    // id here is the devices.id (UUID); we need to get the device_uuid for log filtering
    const device = (await this.fleetService.getDevice(id)) as Record<string, unknown>;
    const deviceUuid = device['deviceUuid'] as string;
    return this.fleetService.getDeviceLogs(deviceUuid, level, date);
  }

  // ─── Releases ─────────────────────────────────────────────────────────────

  /** GET /api/v1/super-admin/releases */
  @Get('releases')
  listReleases() {
    return this.fleetService.listReleases();
  }

  /**
   * POST /api/v1/super-admin/releases — multipart/form-data with fields:
   *   version, versionCode, changelog?, mandatory?  +  file part `apk`
   *
   * The global @fastify/multipart registration (3 MB limit) is overridden at the
   * Fastify level here by calling req.file() with a higher fileSize limit. Because
   * @fastify/multipart is registered globally, each route can pass its own options
   * to req.file(). APKs can be 50–150 MB; we allow up to 250 MB.
   */
  @Post('releases')
  async createRelease(@Req() req: FastifyRequest, @CurrentUser() user: RequestUser) {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }

    // Override per-request file size limit for APK uploads (250 MB)
    const APK_LIMIT = 250 * 1024 * 1024;
    const file = await req.file({ limits: { fileSize: APK_LIMIT } });
    if (!file) {
      throw new BadRequestException('Missing file part');
    }

    // Parse metadata fields from the multipart fields
    const fields = file.fields as Record<string, { value: string } | undefined> | undefined;
    const rawDto: Record<string, unknown> = {};
    if (fields) {
      for (const [key, field] of Object.entries(fields)) {
        if (field && 'value' in field) {
          rawDto[key] = field.value;
        }
      }
    }

    const parsed = createReleaseSchema.safeParse(rawDto);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const dto: CreateReleaseInput = parsed.data;

    return this.fleetService.createRelease(dto, file.file, file.mimetype, user.id);
  }

  /** PATCH /api/v1/super-admin/releases/:id */
  @Patch('releases/:id')
  updateRelease(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateReleaseSchema)) dto: UpdateReleaseInput,
  ) {
    return this.fleetService.updateRelease(id, dto);
  }

  // ─── Deployments ──────────────────────────────────────────────────────────

  /** GET /api/v1/super-admin/deployments */
  @Get('deployments')
  listDeployments() {
    return this.fleetService.listDeployments();
  }

  /** POST /api/v1/super-admin/deployments */
  @Post('deployments')
  async createDeployment(
    @Body(new ZodValidationPipe(createDeploymentSchema)) dto: CreateDeploymentInput,
    @CurrentUser() user: RequestUser,
  ) {
    const deployment = await this.fleetService.createDeployment(dto, user.id);
    return deployment;
  }

  /** POST /api/v1/super-admin/deployments/:id/cancel */
  @Post('deployments/:id/cancel')
  cancelDeployment(@Param('id') id: string) {
    return this.fleetService.cancelDeployment(id);
  }

  // ─── Tailscale per-device toggle ──────────────────────────────────────────

  /**
   * PATCH /api/v1/super-admin/devices/:id/tailscale
   * Set the desired Tailscale state for a device. The device applies it via MDM
   * on next check-in. Triggers a best-effort FCM wake push.
   */
  @Patch('devices/:id/tailscale')
  setDeviceTailscale(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setDeviceTailscaleSchema)) dto: SetDeviceTailscaleInput,
  ) {
    return this.fleetService.setDeviceTailscale(id, dto);
  }

  // ─── SMS-gateway per-device toggle + test send ────────────────────────────

  /**
   * PATCH /api/v1/super-admin/devices/:id/sms-gateway
   * Flag/unflag a device as the SMS gateway that claims pending outbound SMS.
   */
  @Patch('devices/:id/sms-gateway')
  setDeviceSmsGateway(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setDeviceSmsGatewaySchema)) dto: SetDeviceSmsGatewayInput,
  ) {
    return this.fleetService.setDeviceSmsGateway(id, dto);
  }

  /**
   * POST /api/v1/super-admin/devices/:id/test-sms
   * Enqueue a one-off test SMS through the gateway (device must be a gateway).
   */
  @Post('devices/:id/test-sms')
  sendGatewayTestSms(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(testSmsSchema)) dto: TestSmsInput,
  ) {
    return this.fleetService.enqueueGatewayTestSms(id, dto);
  }

  // ─── Tailscale global settings ─────────────────────────────────────────────

  /**
   * GET /api/v1/super-admin/settings/tailscale
   * Returns masked settings — raw secrets are NEVER returned.
   */
  @Get('settings/tailscale')
  getTailscaleSettings() {
    return this.fleetService.getTailscaleSettings();
  }

  /**
   * PUT /api/v1/super-admin/settings/tailscale
   * Update Tailscale settings: auth key, tailnet, OAuth client, tag.
   * For each secret field: undefined/null = leave unchanged; '' = clear; non-empty = set.
   */
  @Put('settings/tailscale')
  updateTailscaleSettings(
    @Body(new ZodValidationPipe(updateTailscaleSettingsSchema)) dto: UpdateTailscaleSettingsInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.fleetService.updateTailscaleSettings(dto, user.id);
  }

  /**
   * POST /api/v1/super-admin/settings/tailscale-apk
   * Upload the official Tailscale APK so Device-Owner phones can silently self-install it.
   * Multipart field name: `apk`. Max 250 MB. Overwrites any previously uploaded APK.
   * Returns masked AppSettings so the UI can reflect tailscaleApkSet immediately.
   */
  @Post('settings/tailscale-apk')
  async uploadTailscaleApk(@Req() req: FastifyRequest) {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }

    // Override per-request file size limit for APK uploads (250 MB)
    const APK_LIMIT = 250 * 1024 * 1024;
    const file = await req.file({ limits: { fileSize: APK_LIMIT } });
    if (!file) {
      throw new BadRequestException('Missing file part `apk`');
    }

    return this.fleetService.uploadTailscaleApk(file.file);
  }

  // ─── One-shot remote-debug command queue ──────────────────────────────────

  /**
   * POST /api/v1/super-admin/devices/:id/commands
   * Enqueue a one-shot management/diagnostic command for a device.
   * The command is delivered on the device's next check-in.
   */
  @Post('devices/:id/commands')
  enqueueCommand(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createRemoteCommandSchema)) dto: CreateRemoteCommandInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.fleetService.enqueueCommand(id, dto, user.id);
  }

  /**
   * GET /api/v1/super-admin/devices/:id/commands
   * List the one-shot command history for a device (newest-first, max 50).
   */
  @Get('devices/:id/commands')
  listCommands(@Param('id') id: string) {
    return this.fleetService.listCommands(id);
  }

  /**
   * POST /api/v1/super-admin/devices/:id/reapply-tailscale
   * Clear the Tailscale applied flag so the existing channel re-issues an 'up'
   * on the next check-in (re-applies config for already-enrolled devices).
   */
  @Post('devices/:id/reapply-tailscale')
  reapplyTailscale(@Param('id') id: string) {
    return this.fleetService.reapplyTailscale(id);
  }
}
