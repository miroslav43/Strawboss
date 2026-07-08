import {
  Injectable,
  Inject,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { timingSafeEqual, randomUUID, randomBytes, createHash } from 'node:crypto';
import { createWriteStream, promises as fsp } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import { resolveUploadsRoot } from '../uploads/uploads.service';
import { signUploadUrl, UPLOADS_URL_PREFIX } from '../uploads/uploads-signing';
import type {
  DeviceCheckinResponse,
  DeviceRemoteCommand,
  DeviceRemoteCommandRecord,
  DeviceRemoteCommandReport,
  PendingSms,
  DeviceSmsReport,
  PendingDeployment,
  OtaState,
  DeviceCommand,
  AppSettings,
  DeviceUptimeResponse,
} from '@strawboss/types';
import type {
  DeviceCheckinInput,
  CreateReleaseInput,
  UpdateReleaseInput,
  CreateDeploymentInput,
  UpdateDeviceInput,
  SetDeviceTailscaleInput,
  SetDeviceSmsGatewayInput,
  TestSmsInput,
  UpdateTailscaleSettingsInput,
  CreateRemoteCommandInput,
} from '@strawboss/validation';
import { FleetPushService } from './fleet-push.service';
import { QUEUE_OTA_DEPLOY } from '../jobs/queues';
import { postResendEmail } from '../messaging/resend-client';

/** Max APK size: 250 MB */
export const APK_MAX_BYTES = 250 * 1024 * 1024;

const DEVICE_COLS = sql`
  id,
  device_uuid             AS "deviceUuid",
  organization_id         AS "organizationId",
  name,
  android_id              AS "androidId",
  model,
  manufacturer,
  os_version              AS "osVersion",
  app_version             AS "appVersion",
  version_code            AS "versionCode",
  push_token              AS "pushToken",
  is_device_owner         AS "isDeviceOwner",
  last_seen_at            AS "lastSeenAt",
  last_checkin_at         AS "lastCheckinAt",
  last_active_trip        AS "lastActiveTrip",
  tailscale_desired       AS "tailscaleDesired",
  tailscale_online        AS "tailscaleOnline",
  tailscale_ip            AS "tailscaleIp",
  tailscale_hostname      AS "tailscaleHostname",
  tailscale_last_seen     AS "tailscaleLastSeen",
  tailscale_last_error    AS "tailscaleLastError",
  is_sms_gateway          AS "isSmsGateway",
  last_state              AS "lastState",
  last_state_at           AS "lastStateAt",
  last_user_id            AS "lastUserId",
  created_at              AS "createdAt",
  updated_at              AS "updatedAt",
  deleted_at              AS "deletedAt"
`;

const RELEASE_COLS = sql`
  id,
  version,
  version_code    AS "versionCode",
  apk_key         AS "apkKey",
  sha256,
  size_bytes      AS "sizeBytes",
  changelog,
  mandatory,
  status,
  uploaded_by     AS "uploadedBy",
  created_at      AS "createdAt",
  updated_at      AS "updatedAt",
  deleted_at      AS "deletedAt"
`;

const DEPLOYMENT_COLS = sql`
  id,
  release_id          AS "releaseId",
  target_kind         AS "targetKind",
  target_org_id       AS "targetOrgId",
  target_device_ids   AS "targetDeviceIds",
  scheduled_at        AS "scheduledAt",
  force_now           AS "forceNow",
  status,
  created_by          AS "createdBy",
  created_at          AS "createdAt",
  updated_at          AS "updatedAt"
`;

/** Column list for the outbound_messages outbox (mirrors messages.service.ts COLS). */
const OUTBOUND_MESSAGE_COLS = sql`
  id,
  organization_id     AS "organizationId",
  channel, kind,
  to_address          AS "toAddress",
  subject,
  left(body, 200)     AS "bodyPreview",
  status,
  provider_message_id AS "providerMessageId",
  error, attempts,
  trip_request_id     AS "tripRequestId",
  claimed_by_device   AS "claimedByDevice",
  sent_at             AS "sentAt",
  delivered_at        AS "deliveredAt",
  created_at          AS "createdAt",
  updated_at          AS "updatedAt"
`;

type Row = Record<string, unknown>;

@Injectable()
export class FleetService {
  private readonly uploadsRoot: string;
  private readonly jwtSecret: string;

  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly configService: ConfigService,
    private readonly fleetPushService: FleetPushService,
    @InjectQueue(QUEUE_OTA_DEPLOY) private readonly otaDeployQueue: Queue,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    this.uploadsRoot = resolveUploadsRoot(configService);
    this.jwtSecret = configService.getOrThrow<string>('SUPABASE_JWT_SECRET');
  }

  // ─── Tailscale hostname sanitizer ────────────────────────────────────────────

  /**
   * Convert a device display name into a Tailscale-safe DNS label.
   * Lowercase, replace runs of non-[a-z0-9-] with '-', strip leading/trailing '-'.
   * Fallback: "phone-<first 8 chars of device id>".
   */
  sanitizeHostname(name: string | null | undefined, deviceId: string): string {
    if (!name) return `phone-${deviceId.slice(0, 8)}`;
    const sanitized = name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return sanitized || `phone-${deviceId.slice(0, 8)}`;
  }

  // ─── Device token helpers ─────────────────────────────────────────────────────

  /**
   * Generate a new per-device token (64 hex chars) and its SHA-256 hash.
   * The raw token is returned once (at registration); only the hash is stored.
   */
  private generateDeviceToken(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return { token, tokenHash };
  }

  /**
   * Verify a submitted token against the stored SHA-256 hash.
   * Uses timing-safe comparison to prevent timing attacks.
   */
  private verifyDeviceToken(submittedToken: string, storedHash: string): boolean {
    const submittedHash = createHash('sha256').update(submittedToken).digest('hex');
    const a = Buffer.from(submittedHash);
    const b = Buffer.from(storedHash);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  // ─── Signed APK URL ───────────────────────────────────────────────────────────

  private signApkUrl(apkKey: string): string {
    const url = `${UPLOADS_URL_PREFIX}${apkKey}`;
    return signUploadUrl(url, this.jwtSecret, Date.now());
  }

  // ─── Check-in ────────────────────────────────────────────────────────────────

  async checkin(dto: DeviceCheckinInput): Promise<DeviceCheckinResponse> {
    const db = this.drizzleProvider.db;

    // 1. Look up device by deviceUuid
    const existing = await db.execute(
      sql`SELECT id, device_token_hash, version_code, organization_id
          FROM devices
          WHERE device_uuid = ${dto.deviceUuid} AND deleted_at IS NULL
          LIMIT 1`,
    );
    const rows = existing as unknown as {
      id: string;
      device_token_hash: string;
      version_code: number | null;
      organization_id: string | null;
    }[];

    let deviceId: string;
    let deviceTokenIssued: string | undefined;
    let orgId: string | null;

    let isRegistration = false;

    if (rows.length === 0) {
      // REGISTRATION — first check-in for this deviceUuid
      isRegistration = true;
      const { token, tokenHash } = this.generateDeviceToken();
      const inserted = await db.execute(
        sql`INSERT INTO devices (
              device_uuid, device_token_hash,
              app_version, version_code, model, manufacturer, os_version, android_id,
              push_token, is_device_owner, last_active_trip,
              last_seen_at, last_checkin_at
            ) VALUES (
              ${dto.deviceUuid}, ${tokenHash},
              ${dto.appVersion}, ${dto.versionCode},
              ${dto.model ?? null}, ${dto.manufacturer ?? null},
              ${dto.osVersion ?? null}, ${dto.androidId ?? null},
              ${dto.pushToken ?? null}, ${dto.isDeviceOwner}, ${dto.activeTrip},
              now(), now()
            ) RETURNING id, organization_id`,
      );
      const newRow = (inserted as unknown as { id: string; organization_id: string | null }[])[0];
      deviceId = newRow.id;
      orgId = newRow.organization_id;
      deviceTokenIssued = token;

      this.winston.log('flow', 'Device registered', {
        context: 'FleetService',
        deviceUuid: dto.deviceUuid,
        deviceId,
      });
    } else {
      // RETURNING DEVICE — verify token
      const row = rows[0];
      if (!dto.deviceToken) {
        throw new UnauthorizedException('deviceToken required for known device');
      }
      if (!this.verifyDeviceToken(dto.deviceToken, row.device_token_hash)) {
        throw new UnauthorizedException('Invalid device token');
      }

      deviceId = row.id;
      orgId = row.organization_id;

      // Upsert device fields
      await db.execute(
        sql`UPDATE devices SET
              app_version       = ${dto.appVersion},
              version_code      = ${dto.versionCode},
              model             = COALESCE(${dto.model ?? null}, model),
              manufacturer      = COALESCE(${dto.manufacturer ?? null}, manufacturer),
              os_version        = COALESCE(${dto.osVersion ?? null}, os_version),
              android_id        = COALESCE(${dto.androidId ?? null}, android_id),
              push_token        = COALESCE(${dto.pushToken ?? null}, push_token),
              is_device_owner   = ${dto.isDeviceOwner},
              last_active_trip  = ${dto.activeTrip},
              last_seen_at      = now(),
              last_checkin_at   = now(),
              updated_at        = now()
            WHERE id = ${deviceId}::uuid`,
      );
    }

    // On first registration, return immediately with no pending work.
    // An unverified registrant must not receive signed APK URLs or inflate stats.
    if (isRegistration) {
      return {
        deviceId,
        assignedOrgId: orgId,
        deviceTokenIssued,
        pendingDeployment: null,
        pendingCommand: null,
        pendingCommands: [],
        pendingSms: [],
      };
    }

    // 2. Apply OTA reports
    if (dto.otaReports && dto.otaReports.length > 0) {
      for (const report of dto.otaReports) {
        await this.applyOtaReport(
          deviceId,
          dto.versionCode,
          report.deploymentId,
          report.state as OtaState,
          report.error,
        );
      }
    }

    // 3. Apply command reports (Tailscale up/down outcomes)
    if (dto.commandReports && dto.commandReports.length > 0) {
      await this.applyCommandReports(deviceId, dto.commandReports);
    }

    // 4. Apply one-shot remote-debug command reports
    if (dto.remoteCommandReports && dto.remoteCommandReports.length > 0) {
      await this.applyRemoteCommandReports(deviceId, dto.remoteCommandReports);
    }

    // 4b. Apply SMS send receipts (gateway devices)
    if (dto.smsReports && dto.smsReports.length > 0) {
      await this.applySmsReports(deviceId, dto.smsReports);
    }

    // 5. Compute pending deployment
    const pendingDeployment = await this.computePendingDeployment(deviceId, dto.versionCode, orgId);

    // 6. Compute pending Tailscale command
    const pendingCommand = await this.computePendingCommand(deviceId);

    // 7. Compute pending one-shot remote-debug commands
    const pendingCommands = await this.computePendingRemoteCommands(deviceId);

    // 8. Compute pending SMS to send (gateway devices only)
    const pendingSms = await this.computePendingSms(deviceId);

    return {
      deviceId,
      assignedOrgId: orgId,
      ...(deviceTokenIssued ? { deviceTokenIssued } : {}),
      pendingDeployment,
      pendingCommand,
      pendingCommands,
      pendingSms,
    };
  }

  private async applyCommandReports(
    deviceId: string,
    reports: { commandId: string; status: 'success' | 'failure'; error?: string }[],
  ): Promise<void> {
    const db = this.drizzleProvider.db;

    // Fetch the persisted pending command for this device so we can verify commandId
    const deviceRows = await db.execute(
      sql`SELECT tailscale_pending_command_id  AS "pendingCommandId",
                 tailscale_pending_action       AS "pendingAction"
          FROM devices
          WHERE id = ${deviceId}::uuid AND deleted_at IS NULL
          LIMIT 1`,
    );
    const deviceRow = (
      deviceRows as unknown as {
        pendingCommandId: string | null;
        pendingAction: string | null;
      }[]
    )[0];
    if (!deviceRow) return;

    for (const report of reports) {
      // Only act on reports that match the stored pending command id
      if (report.commandId !== deviceRow.pendingCommandId) continue;

      if (report.status === 'success') {
        // Derive the new applied value from the pending action ('up' → true, 'down' → false)
        const newApplied = deviceRow.pendingAction === 'up';
        await db.execute(
          sql`UPDATE devices SET
                tailscale_applied              = ${newApplied},
                tailscale_pending_command_id   = NULL,
                tailscale_pending_action       = NULL,
                tailscale_last_error           = NULL,
                updated_at                     = now()
              WHERE id = ${deviceId}::uuid`,
        );
        this.winston.log('flow', 'Tailscale command applied by device', {
          context: 'FleetService',
          deviceId,
          commandId: report.commandId,
          action: deviceRow.pendingAction,
          newApplied,
        });
      } else {
        // Failure — clear the pending command so a fresh one is issued next check-in
        await db.execute(
          sql`UPDATE devices SET
                tailscale_pending_command_id = NULL,
                tailscale_pending_action     = NULL,
                tailscale_last_error         = ${report.error ?? 'unknown error'},
                updated_at                   = now()
              WHERE id = ${deviceId}::uuid`,
        );
        this.winston.warn('Tailscale command failed on device', {
          context: 'FleetService',
          deviceId,
          commandId: report.commandId,
          error: report.error,
        });
      }
    }
  }

  // ─── One-shot remote-debug command queue ─────────────────────────────────────

  /**
   * Apply device-reported results for one-shot remote-debug commands.
   * On `report_state` success, also persists the gathered state snapshot to the device row.
   */
  private async applyRemoteCommandReports(
    deviceId: string,
    reports: DeviceRemoteCommandReport[],
  ): Promise<void> {
    const db = this.drizzleProvider.db;

    for (const report of reports) {
      const commandRows = await db.execute(
        sql`SELECT id, command_type AS "commandType"
            FROM device_remote_commands
            WHERE id = ${report.commandId}::uuid
              AND device_id = ${deviceId}::uuid
            LIMIT 1`,
      );
      const commandRow = (commandRows as unknown as { id: string; commandType: string }[])[0];
      if (!commandRow) continue;

      if (report.status === 'success') {
        await db.execute(
          sql`UPDATE device_remote_commands
              SET status       = 'completed',
                  result       = ${report.result ? JSON.stringify(report.result) : null}::jsonb,
                  completed_at = now(),
                  updated_at   = now()
              WHERE id = ${commandRow.id}::uuid`,
        );

        // For report_state: persist the gathered snapshot onto the device row
        if (commandRow.commandType === 'report_state' && report.result) {
          await db.execute(
            sql`UPDATE devices
                SET last_state    = ${JSON.stringify(report.result)}::jsonb,
                    last_state_at = now(),
                    updated_at    = now()
                WHERE id = ${deviceId}::uuid`,
          );
          this.winston.log('flow', 'Device state snapshot recorded', {
            context: 'FleetService',
            deviceId,
            commandId: commandRow.id,
          });
        }
      } else {
        await db.execute(
          sql`UPDATE device_remote_commands
              SET status       = 'failed',
                  last_error   = ${report.error ?? 'unknown error'},
                  completed_at = now(),
                  updated_at   = now()
              WHERE id = ${commandRow.id}::uuid`,
        );
        this.winston.warn('Remote command failed on device', {
          context: 'FleetService',
          deviceId,
          commandId: commandRow.id,
          commandType: commandRow.commandType,
          error: report.error,
        });
      }
    }
  }

  /**
   * Return pending/sent one-shot remote-debug commands for the device (oldest-first, max 10).
   * Marks newly-pending rows as 'sent' so we know they've been delivered at least once.
   * Re-returns 'sent' commands each check-in — the device deduplicates by id.
   * For `reinstall_apk`, resolves the releaseId to a fresh signed APK URL at delivery time.
   */
  private async computePendingRemoteCommands(deviceId: string): Promise<DeviceRemoteCommand[]> {
    const db = this.drizzleProvider.db;

    const rows = await db.execute(
      sql`SELECT id,
                 command_type AS "commandType",
                 params,
                 status
          FROM device_remote_commands
          WHERE device_id = ${deviceId}::uuid
            AND status IN ('pending', 'sent')
          ORDER BY created_at ASC
          LIMIT 10`,
    );

    type CommandRow = {
      id: string;
      commandType: string;
      params: Record<string, unknown> | null;
      status: string;
    };
    const commandRows = rows as unknown as CommandRow[];
    if (!commandRows.length) return [];

    // Mark all currently-pending rows as 'sent' (idempotent for already-sent rows)
    const pendingIds = commandRows.filter((r) => r.status === 'pending').map((r) => r.id);
    if (pendingIds.length > 0) {
      await db.execute(
        sql`UPDATE device_remote_commands
            SET status   = 'sent',
                sent_at  = now(),
                updated_at = now()
            WHERE id = ANY(${`{${pendingIds.join(',')}}`}::uuid[])
              AND status = 'pending'`,
      );
    }

    // Build the DeviceRemoteCommand[] array
    const commands: DeviceRemoteCommand[] = [];
    for (const row of commandRows) {
      if (row.commandType === 'reinstall_apk') {
        // Resolve releaseId → fresh signed URL
        const releaseId = row.params?.releaseId as string | undefined;
        if (!releaseId) continue; // malformed — skip

        const releaseRows = await db.execute(
          sql`SELECT apk_key AS "apkKey", sha256
              FROM app_releases
              WHERE id = ${releaseId}::uuid AND deleted_at IS NULL
              LIMIT 1`,
        );
        const release = (releaseRows as unknown as { apkKey: string; sha256: string }[])[0];
        if (!release) continue; // release deleted — skip

        commands.push({
          id: row.id,
          type: 'reinstall_apk',
          params: {
            packageName: 'com.strawboss.mobile',
            apkUrl: this.signApkUrl(release.apkKey),
            sha256: release.sha256,
          },
        });
      } else {
        commands.push({
          id: row.id,
          type: row.commandType as DeviceRemoteCommand['type'],
          ...(row.params ? { params: row.params } : {}),
        });
      }
    }

    return commands;
  }

  /** Apply SMS send-attempt receipts from a gateway device (anti-spoof: must own the row). */
  private async applySmsReports(deviceId: string, reports: DeviceSmsReport[]): Promise<void> {
    const db = this.drizzleProvider.db;
    for (const r of reports) {
      await db.execute(
        sql`UPDATE outbound_messages
            SET status = ${r.status === 'sent' ? 'delivered' : 'failed'},
                provider_message_id = COALESCE(${r.providerInfo ?? null}, provider_message_id),
                error = ${r.status === 'failed' ? (r.error ?? 'send failed') : null},
                delivered_at = CASE WHEN ${r.status === 'sent'} THEN now() ELSE delivered_at END,
                updated_at = now()
            WHERE id = ${r.id}::uuid
              AND channel = 'sms'
              AND claimed_by_device = ${deviceId}::uuid`,
      );
    }
  }

  /**
   * Claim + return pending SMS for a gateway device: atomically marks them 'sent'
   * (claimed) so no other device grabs them, and returns {id, to, body}. Non-gateway
   * devices get nothing. FOR UPDATE SKIP LOCKED avoids double-claims under concurrency.
   */
  private async computePendingSms(deviceId: string): Promise<PendingSms[]> {
    const db = this.drizzleProvider.db;
    const rows = await db.execute(
      sql`UPDATE outbound_messages
          SET status = 'sent', claimed_by_device = ${deviceId}::uuid,
              sent_at = now(), updated_at = now()
          WHERE id IN (
            SELECT om.id FROM outbound_messages om
            WHERE om.channel = 'sms' AND om.status = 'pending'
              AND EXISTS (
                SELECT 1 FROM devices d
                WHERE d.id = ${deviceId}::uuid AND d.is_sms_gateway = true
              )
            ORDER BY om.created_at ASC
            LIMIT 20
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id, to_address AS "to", body`,
    );
    return rows as unknown as PendingSms[];
  }

  /**
   * Enqueue a one-shot remote-debug command for a device.
   * Sends a best-effort FCM wake push so the device checks in promptly.
   */
  async enqueueCommand(
    deviceId: string,
    dto: CreateRemoteCommandInput,
    createdBy: string,
  ): Promise<DeviceRemoteCommandRecord> {
    const db = this.drizzleProvider.db;

    // 404 guard
    await this.getDevice(deviceId);

    const result = await db.execute(
      sql`INSERT INTO device_remote_commands
            (device_id, command_type, params, status, created_by)
          VALUES (
            ${deviceId}::uuid,
            ${dto.type},
            ${dto.params ? JSON.stringify(dto.params) : null}::jsonb,
            'pending',
            ${createdBy}::uuid
          )
          RETURNING
            id,
            device_id      AS "deviceId",
            command_type   AS "type",
            params,
            status,
            result,
            last_error     AS "lastError",
            sent_at        AS "sentAt",
            completed_at   AS "completedAt",
            created_by     AS "createdBy",
            created_at     AS "createdAt",
            updated_at     AS "updatedAt"`,
    );
    const record = (result as unknown as DeviceRemoteCommandRecord[])[0];

    this.winston.log('flow', 'Remote command enqueued', {
      context: 'FleetService',
      deviceId,
      commandId: record.id,
      commandType: dto.type,
      createdBy,
    });

    // Best-effort FCM wake
    const deviceRows = await db.execute(
      sql`SELECT push_token AS "pushToken"
          FROM devices
          WHERE id = ${deviceId}::uuid AND deleted_at IS NULL
          LIMIT 1`,
    );
    const pushToken = (deviceRows as unknown as { pushToken: string | null }[])[0]?.pushToken;
    if (pushToken) {
      this.fleetPushService.sendOtaCheckinPush([pushToken], `remote-cmd`).catch(() => {});
    }

    return record;
  }

  /**
   * Presence dead-man: wake device-owner phones whose last check-in has gone
   * stale by sending a high-priority FCM data push. The wake restarts the frozen/
   * killed process, which re-arms the keep-alive PresenceService via onCreate.
   * Called by the presence-deadman BullMQ job (~every 2 min). Best-effort.
   */
  async wakeStaleDeviceOwners(
    staleMinutes = 4,
  ): Promise<{ scanned: number; woken: number; pruned: number }> {
    // Require last_checkin_at IS NOT NULL: a push_token only exists after a check-in,
    // so a genuinely never-seen row is skipped rather than FCM-spammed forever.
    const rows = (await this.drizzleProvider.db.execute(sql`
      SELECT push_token AS "pushToken"
      FROM devices
      WHERE is_device_owner = true
        AND deleted_at IS NULL
        AND push_token IS NOT NULL
        AND last_checkin_at IS NOT NULL
        AND last_checkin_at < now() - (${staleMinutes} * interval '1 minute')
    `)) as unknown as { pushToken: string | null }[];
    const tokens = rows.map((r) => r.pushToken).filter((t): t is string => !!t);
    if (tokens.length === 0) return { scanned: rows.length, woken: 0, pruned: 0 };

    // sendPresenceWake returns tokens FCM reports as permanently dead — prune them so
    // a factory-reset/uninstalled phone stops being re-woken every scan.
    const dead = await this.fleetPushService.sendPresenceWake(tokens);
    for (const t of dead) {
      await this.drizzleProvider.db.execute(
        sql`UPDATE devices SET push_token = NULL WHERE push_token = ${t}`,
      );
    }
    this.winston.log('flow', 'Presence dead-man woke stale device-owners', {
      context: 'FleetService',
      woken: tokens.length,
      prunedDeadTokens: dead.length,
    });
    return { scanned: rows.length, woken: tokens.length, pruned: dead.length };
  }

  /**
   * List one-shot command history for a device (newest-first, max 50).
   */
  async listCommands(deviceId: string): Promise<DeviceRemoteCommandRecord[]> {
    // 404 guard
    await this.getDevice(deviceId);

    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
            id,
            device_id      AS "deviceId",
            command_type   AS "type",
            params,
            status,
            result,
            last_error     AS "lastError",
            sent_at        AS "sentAt",
            completed_at   AS "completedAt",
            created_by     AS "createdBy",
            created_at     AS "createdAt",
            updated_at     AS "updatedAt"
          FROM device_remote_commands
          WHERE device_id = ${deviceId}::uuid
          ORDER BY created_at DESC
          LIMIT 50`,
    );
    return result as unknown as DeviceRemoteCommandRecord[];
  }

  /**
   * Re-issue the Tailscale 'up' command to a device by clearing the applied flag.
   * The existing `computePendingCommand` will re-issue an 'up' on the next check-in.
   */
  async reapplyTailscale(deviceId: string): Promise<{ ok: boolean }> {
    // 404 guard
    await this.getDevice(deviceId);

    await this.drizzleProvider.db.execute(
      sql`UPDATE devices
          SET tailscale_applied              = false,
              tailscale_pending_command_id   = NULL,
              tailscale_pending_action       = NULL,
              updated_at                     = now()
          WHERE id = ${deviceId}::uuid`,
    );

    this.winston.log('flow', 'Tailscale reapply requested', {
      context: 'FleetService',
      deviceId,
    });

    return { ok: true };
  }

  private async computePendingCommand(deviceId: string): Promise<DeviceCommand | null> {
    const db = this.drizzleProvider.db;

    // Read device tailscale state (re-read after applying reports)
    // Also read the persisted pending command so we can reuse a stable id across check-ins.
    const deviceRows = await db.execute(
      sql`SELECT name,
                 tailscale_desired              AS "tailscaleDesired",
                 tailscale_applied              AS "tailscaleApplied",
                 tailscale_pending_command_id   AS "pendingCommandId",
                 tailscale_pending_action       AS "pendingAction"
          FROM devices
          WHERE id = ${deviceId}::uuid AND deleted_at IS NULL
          LIMIT 1`,
    );
    const device = (
      deviceRows as unknown as {
        name: string | null;
        tailscaleDesired: boolean;
        tailscaleApplied: boolean;
        pendingCommandId: string | null;
        pendingAction: string | null;
      }[]
    )[0];
    if (!device) return null;

    // If desired === applied, the command has been fully executed (or was never needed).
    if (device.tailscaleDesired === device.tailscaleApplied) {
      // Clear any stale pending command that may linger
      if (device.pendingCommandId) {
        await db.execute(
          sql`UPDATE devices SET
                tailscale_pending_command_id = NULL,
                tailscale_pending_action     = NULL,
                updated_at                   = now()
              WHERE id = ${deviceId}::uuid`,
        );
      }
      return null;
    }

    const action = device.tailscaleDesired ? 'up' : 'down';

    if (action === 'down') {
      // No auth key needed for 'down'. Reuse or generate a stable command id.
      let commandId: string;
      if (device.pendingCommandId && device.pendingAction === 'down') {
        commandId = device.pendingCommandId;
      } else {
        commandId = randomUUID();
        await db.execute(
          sql`UPDATE devices SET
                tailscale_pending_command_id = ${commandId}::uuid,
                tailscale_pending_action     = 'down',
                updated_at                   = now()
              WHERE id = ${deviceId}::uuid`,
        );
      }
      return {
        id: commandId,
        type: 'tailscale',
        action: 'down',
      };
    }

    // action === 'up' — fetch all relevant settings from app_settings
    const settingsRows = await db.execute(
      sql`SELECT tailscale_auth_key            AS "tailscaleAuthKey",
                 tailscale_tailnet             AS "tailscaleTailnet",
                 tailscale_oauth_client_id     AS "tailscaleOauthClientId",
                 tailscale_oauth_client_secret AS "tailscaleOauthClientSecret",
                 tailscale_tag                 AS "tailscaleTag",
                 tailscale_apk_key             AS "tailscaleApkKey",
                 tailscale_apk_sha256          AS "tailscaleApkSha256",
                 tailscale_mint_failed_at      AS "tailscaleMintFailedAt"
          FROM app_settings
          WHERE id = true
          LIMIT 1`,
    );
    const settings = (
      settingsRows as unknown as {
        tailscaleAuthKey: string | null;
        tailscaleTailnet: string | null;
        tailscaleOauthClientId: string | null;
        tailscaleOauthClientSecret: string | null;
        tailscaleTag: string | null;
        tailscaleApkKey: string | null;
        tailscaleApkSha256: string | null;
        tailscaleMintFailedAt: string | null;
      }[]
    )[0];

    const hostname = this.sanitizeHostname(device.name, deviceId);

    // Eagerly persist the hostname so the host status-sync script can match it
    await db.execute(
      sql`UPDATE devices SET
            tailscale_hostname = ${hostname},
            updated_at         = now()
          WHERE id = ${deviceId}::uuid`,
    );

    // Decide which auth key to use:
    // Prefer OAuth-minted ephemeral keys; fall back to the shared key; error if neither.
    let authKey: string | null = null;
    const oauthFullyConfigured =
      settings?.tailscaleOauthClientId &&
      settings.tailscaleOauthClientSecret &&
      settings.tailscaleTag;
    const oauthPartiallyConfigured =
      !oauthFullyConfigured &&
      (settings?.tailscaleOauthClientId || settings?.tailscaleOauthClientSecret);

    // Warn on partial OAuth config (clientId+secret present but tag missing)
    if (oauthPartiallyConfigured) {
      this.winston.warn('Partial Tailscale OAuth config: tag missing — using shared auth key', {
        context: 'FleetService',
        deviceId,
      });
    }

    if (oauthFullyConfigured) {
      // Check mint back-off: if minting failed within the last 15 minutes, skip
      const mintFailedAt = settings.tailscaleMintFailedAt
        ? new Date(settings.tailscaleMintFailedAt).getTime()
        : null;
      const backOffMs = 15 * 60 * 1000;
      const inBackOff = mintFailedAt !== null && Date.now() - mintFailedAt < backOffMs;

      if (inBackOff) {
        this.winston.debug('Tailscale OAuth minting in back-off; using shared auth key', {
          context: 'FleetService',
          deviceId,
          mintFailedAt: settings.tailscaleMintFailedAt,
        });
        authKey = settings?.tailscaleAuthKey ?? null;
      } else {
        // Attempt to mint a single-use ephemeral key
        authKey = await this.mintEphemeralAuthKey(
          settings.tailscaleOauthClientId!,
          settings.tailscaleOauthClientSecret!,
          settings.tailscaleTag!,
          hostname,
        );
        if (!authKey) {
          // Minting failed — record the failure timestamp and fall back to shared key
          await db.execute(
            sql`UPDATE app_settings SET tailscale_mint_failed_at = now() WHERE id = true`,
          );
          this.winston.warn('OAuth minting failed; falling back to shared Tailscale auth key', {
            context: 'FleetService',
            deviceId,
          });
          authKey = settings?.tailscaleAuthKey ?? null;
        } else {
          // Minting succeeded — clear any prior failure timestamp
          await db.execute(
            sql`UPDATE app_settings SET tailscale_mint_failed_at = NULL WHERE id = true`,
          );
        }
      }
    } else {
      // No (full) OAuth configured — use shared key
      authKey = settings?.tailscaleAuthKey ?? null;
    }

    if (!authKey) {
      // No usable auth key at all — record error, don't issue command
      const errorMsg = oauthFullyConfigured
        ? 'Tailscale auth key minting failed and no shared key set'
        : 'no Tailscale auth key configured';
      await db.execute(
        sql`UPDATE devices SET
              tailscale_last_error = ${errorMsg},
              updated_at           = now()
            WHERE id = ${deviceId}::uuid`,
      );
      this.winston.warn('Cannot issue Tailscale up command', {
        context: 'FleetService',
        deviceId,
        reason: errorMsg,
      });
      return null;
    }

    // Build the APK payload if a Tailscale APK is hosted
    const tailscaleApk =
      settings?.tailscaleApkKey && settings.tailscaleApkSha256
        ? {
            url: this.signApkUrl(settings.tailscaleApkKey),
            sha256: settings.tailscaleApkSha256,
          }
        : undefined;

    // Reuse existing pending command id if the action is the same; otherwise generate a new one.
    let commandId: string;
    if (device.pendingCommandId && device.pendingAction === 'up') {
      commandId = device.pendingCommandId;
    } else {
      commandId = randomUUID();
      await db.execute(
        sql`UPDATE devices SET
              tailscale_pending_command_id = ${commandId}::uuid,
              tailscale_pending_action     = 'up',
              updated_at                   = now()
            WHERE id = ${deviceId}::uuid`,
      );
    }

    return {
      id: commandId,
      type: 'tailscale',
      action: 'up',
      payload: {
        authKey,
        hostname,
        tailnet: settings?.tailscaleTailnet ?? 'tail2b4c34.ts.net',
        ...(tailscaleApk ? { tailscaleApk } : {}),
      },
    };
  }

  private async applyOtaReport(
    deviceId: string,
    deviceVersionCode: number,
    deploymentId: string,
    reportedState: OtaState,
    error?: string,
  ): Promise<void> {
    const db = this.drizzleProvider.db;

    // Fetch the device_ota_status + release version_code
    const statusRows = await db.execute(
      sql`SELECT dos.id, dos.state, ar.version_code AS "releaseVersionCode"
          FROM device_ota_status dos
          JOIN ota_deployments od ON od.id = dos.deployment_id
          JOIN app_releases ar ON ar.id = od.release_id
          WHERE dos.device_id = ${deviceId}::uuid
            AND dos.deployment_id = ${deploymentId}::uuid
          LIMIT 1`,
    );
    const statusRow = (
      statusRows as unknown as { id: string; state: string; releaseVersionCode: number }[]
    )[0];

    if (!statusRow) return; // No matching row — ignore stale report

    // Anti-skew: only confirm `installed` when device's reported versionCode matches release
    let effectiveState = reportedState;
    if (reportedState === 'installed' && deviceVersionCode < statusRow.releaseVersionCode) {
      effectiveState = 'installing' as OtaState;
    }

    const setClauses: ReturnType<typeof sql>[] = [
      sql`state = ${effectiveState}::ota_state`,
      sql`updated_at = now()`,
    ];

    if (error !== undefined) {
      setClauses.push(sql`error = ${error}`);
    }

    if (reportedState === 'downloading') {
      // no timestamp for downloading — it's transient
    }
    if (reportedState === 'downloaded') {
      setClauses.push(sql`downloaded_at = now()`);
    }
    if (effectiveState === 'installed') {
      setClauses.push(sql`installed_at = now()`);
    }
    if (reportedState === 'failed') {
      setClauses.push(sql`attempt = attempt + 1`);
    }

    const set = sql.join(setClauses, sql`, `);
    await db.execute(
      sql`UPDATE device_ota_status SET ${set}
          WHERE id = ${statusRow.id}::uuid`,
    );
  }

  private async computePendingDeployment(
    deviceId: string,
    deviceVersionCode: number,
    orgId: string | null,
  ): Promise<PendingDeployment | null> {
    const db = this.drizzleProvider.db;

    // Find existing non-terminal device_ota_status for active deployments
    const existingRows = await db.execute(
      sql`SELECT dos.id AS "statusId", dos.state, dos.deployment_id AS "deploymentId",
               od.force_now AS "forceNow", od.target_kind AS "targetKind",
               od.target_org_id AS "targetOrgId", od.target_device_ids AS "targetDeviceIds",
               ar.id AS "releaseId", ar.version, ar.version_code AS "versionCode",
               ar.apk_key AS "apkKey", ar.sha256, ar.size_bytes AS "sizeBytes",
               ar.mandatory
          FROM device_ota_status dos
          JOIN ota_deployments od ON od.id = dos.deployment_id
          JOIN app_releases ar ON ar.id = od.release_id
          WHERE dos.device_id = ${deviceId}::uuid
            AND dos.state NOT IN ('installed', 'failed')
            AND od.status = 'active'
            AND ar.deleted_at IS NULL
          ORDER BY ar.version_code DESC
          LIMIT 1`,
    );

    type StatusRow = {
      statusId: string;
      state: string;
      deploymentId: string;
      forceNow: boolean;
      releaseId: string;
      version: string;
      versionCode: number;
      apkKey: string;
      sha256: string;
      sizeBytes: number;
      mandatory: boolean;
    };

    let statusRow: StatusRow | undefined = (existingRows as unknown as StatusRow[])[0];

    // If no existing row, check if there's an active deployment that should fan out to this device
    if (!statusRow) {
      const fanOutRows = await db.execute(
        sql`SELECT od.id AS "deploymentId", od.force_now AS "forceNow",
                 od.target_kind AS "targetKind", od.target_org_id AS "targetOrgId",
                 od.target_device_ids AS "targetDeviceIds",
                 ar.id AS "releaseId", ar.version, ar.version_code AS "versionCode",
                 ar.apk_key AS "apkKey", ar.sha256, ar.size_bytes AS "sizeBytes",
                 ar.mandatory
            FROM ota_deployments od
            JOIN app_releases ar ON ar.id = od.release_id
            WHERE od.status = 'active'
              AND ar.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM device_ota_status dos2
                WHERE dos2.deployment_id = od.id AND dos2.device_id = ${deviceId}::uuid
              )
              AND (
                od.target_kind = 'all'
                OR (od.target_kind = 'org' AND od.target_org_id = ${orgId ?? null}::uuid)
                OR (od.target_kind = 'device_set' AND ${deviceId}::uuid = ANY(od.target_device_ids))
              )
            ORDER BY ar.version_code DESC
            LIMIT 1`,
      );

      type FanOutRow = {
        deploymentId: string;
        forceNow: boolean;
        releaseId: string;
        version: string;
        versionCode: number;
        apkKey: string;
        sha256: string;
        sizeBytes: number;
        mandatory: boolean;
      };

      const fanRow = (fanOutRows as unknown as FanOutRow[])[0];
      if (fanRow) {
        // Downgrade guard
        if (deviceVersionCode >= fanRow.versionCode) {
          // Already up to date — create status row as installed and skip
          await db.execute(
            sql`INSERT INTO device_ota_status (deployment_id, device_id, state, installed_at)
                VALUES (${fanRow.deploymentId}::uuid, ${deviceId}::uuid, 'installed'::ota_state, now())
                ON CONFLICT (deployment_id, device_id) DO NOTHING`,
          );
          return null;
        }

        // Lazy fan-out — create the status row as notified.
        // Use DO NOTHING to avoid resetting state on a concurrent insert;
        // if a row already exists we'll pick it up via the existing-row query on the next check-in.
        const inserted = await db.execute(
          sql`INSERT INTO device_ota_status (deployment_id, device_id, state, notified_at)
              VALUES (${fanRow.deploymentId}::uuid, ${deviceId}::uuid, 'notified'::ota_state, now())
              ON CONFLICT (deployment_id, device_id) DO NOTHING
              RETURNING id`,
        );
        const insertedId = (inserted as unknown as { id: string }[])[0]?.id;
        if (!insertedId) return null;

        statusRow = {
          statusId: insertedId,
          state: 'notified',
          deploymentId: fanRow.deploymentId,
          forceNow: fanRow.forceNow,
          releaseId: fanRow.releaseId,
          version: fanRow.version,
          versionCode: fanRow.versionCode,
          apkKey: fanRow.apkKey,
          sha256: fanRow.sha256,
          sizeBytes: fanRow.sizeBytes,
          mandatory: fanRow.mandatory,
        };
      }
    }

    if (!statusRow) return null;

    // Downgrade guard for existing status rows
    if (deviceVersionCode >= statusRow.versionCode) {
      await db.execute(
        sql`UPDATE device_ota_status SET state = 'installed'::ota_state, installed_at = now(), updated_at = now()
            WHERE id = ${statusRow.statusId}::uuid`,
      );
      return null;
    }

    // Update to notified if still pending
    if (statusRow.state === 'pending') {
      await db.execute(
        sql`UPDATE device_ota_status SET state = 'notified'::ota_state, notified_at = now(), updated_at = now()
            WHERE id = ${statusRow.statusId}::uuid`,
      );
    }

    const apkUrl = this.signApkUrl(statusRow.apkKey);

    return {
      deploymentId: statusRow.deploymentId,
      releaseId: statusRow.releaseId,
      version: statusRow.version,
      versionCode: statusRow.versionCode,
      apkUrl,
      sha256: statusRow.sha256,
      sizeBytes: Number(statusRow.sizeBytes),
      installPolicy: {
        forceNow: statusRow.forceNow,
        mandatory: statusRow.mandatory,
      },
    };
  }

  // ─── Super-admin: devices ─────────────────────────────────────────────────────

  async listDevices() {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
            d.id,
            d.device_uuid           AS "deviceUuid",
            d.organization_id       AS "organizationId",
            d.name,
            d.android_id            AS "androidId",
            d.model,
            d.manufacturer,
            d.os_version            AS "osVersion",
            d.app_version           AS "appVersion",
            d.version_code          AS "versionCode",
            d.push_token            AS "pushToken",
            d.is_device_owner       AS "isDeviceOwner",
            d.last_seen_at          AS "lastSeenAt",
            d.last_checkin_at       AS "lastCheckinAt",
            d.last_active_trip      AS "lastActiveTrip",
            d.tailscale_desired     AS "tailscaleDesired",
            d.tailscale_online      AS "tailscaleOnline",
            d.tailscale_ip          AS "tailscaleIp",
            d.tailscale_hostname    AS "tailscaleHostname",
            d.tailscale_last_seen   AS "tailscaleLastSeen",
            d.tailscale_last_error  AS "tailscaleLastError",
            d.is_sms_gateway        AS "isSmsGateway",
            d.created_at            AS "createdAt",
            d.updated_at            AS "updatedAt",
            d.deleted_at            AS "deletedAt",
            o.name                  AS "organizationName",
            d.last_user_id          AS "lastUserId",
            lu.full_name            AS "lastUserName",
            lu.role                 AS "lastUserRole",
            luo.name                AS "lastUserOrgName",
            latest.state            AS "latestOtaState",
            latest.deployment_id    AS "latestDeploymentId"
          FROM devices d
          LEFT JOIN organizations o ON o.id = d.organization_id AND o.deleted_at IS NULL
          LEFT JOIN users lu ON lu.id = d.last_user_id AND lu.deleted_at IS NULL
          LEFT JOIN organizations luo ON luo.id = lu.organization_id AND luo.deleted_at IS NULL
          LEFT JOIN LATERAL (
            SELECT dos.state, dos.deployment_id
            FROM device_ota_status dos
            WHERE dos.device_id = d.id
            ORDER BY dos.created_at DESC
            LIMIT 1
          ) latest ON true
          WHERE d.deleted_at IS NULL
          ORDER BY o.name NULLS LAST, d.name NULLS LAST, d.created_at DESC
          LIMIT 5000`,
    );
    return result as unknown as Row[];
  }

  async getDevice(id: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${DEVICE_COLS} FROM devices WHERE id = ${id}::uuid AND deleted_at IS NULL LIMIT 1`,
    );
    const rows = result as unknown as Row[];
    if (!rows.length) throw new NotFoundException(`Device ${id} not found`);
    return rows[0];
  }

  /**
   * Online-vs-offline timeline for a device over the last `days`. "Online" =
   * the bound operator's connected sessions (`user_sessions`, rolled by the
   * heartbeat/location-report on every report; a >2 min gap opens a new session),
   * so the sessions ARE the online intervals and the gaps are offline. Returns the
   * merged online intervals clipped to the window plus the online %.
   */
  async getDeviceUptime(id: string, days: number): Promise<DeviceUptimeResponse> {
    const win = Number.isFinite(days) ? Math.max(1, Math.min(30, Math.round(days))) : 3;
    const to = new Date();
    const from = new Date(to.getTime() - win * 86_400_000);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    const totalSeconds = Math.round((to.getTime() - from.getTime()) / 1000);

    const devRows = (await this.drizzleProvider.db.execute(sql`
      SELECT last_user_id AS "lastUserId"
      FROM devices WHERE id = ${id}::uuid AND deleted_at IS NULL LIMIT 1
    `)) as unknown as { lastUserId: string | null }[];
    if (!devRows.length) throw new NotFoundException(`Device ${id} not found`);
    const userId = devRows[0].lastUserId;

    const base: DeviceUptimeResponse = {
      deviceId: id,
      days: win,
      from: fromIso,
      to: toIso,
      hasOperator: !!userId,
      onlineSeconds: 0,
      offlineSeconds: totalSeconds,
      onlinePct: 0,
      intervals: [],
    };
    if (!userId) return base;

    const rows = (await this.drizzleProvider.db.execute(sql`
      SELECT
        GREATEST(started_at, ${fromIso}::timestamptz)             AS "start",
        LEAST(COALESCE(ended_at, NOW()), ${toIso}::timestamptz)   AS "end"
      FROM user_sessions
      WHERE user_id = ${userId}::uuid
        AND COALESCE(ended_at, NOW()) >= ${fromIso}::timestamptz
        AND started_at <= ${toIso}::timestamptz
      ORDER BY started_at ASC
      LIMIT 20000
    `)) as unknown as { start: string; end: string }[];

    // Merge overlapping/adjacent intervals (sessions shouldn't overlap, but be
    // defensive) into the online timeline.
    const merged: { start: string; end: string }[] = [];
    for (const r of rows) {
      const s = new Date(r.start).getTime();
      const e = new Date(r.end).getTime();
      if (!(e > s)) continue;
      const last = merged[merged.length - 1];
      if (last && s <= new Date(last.end).getTime()) {
        if (e > new Date(last.end).getTime()) last.end = new Date(e).toISOString();
      } else {
        merged.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
      }
    }

    let onlineMs = 0;
    for (const m of merged) {
      onlineMs += new Date(m.end).getTime() - new Date(m.start).getTime();
    }
    const onlineSeconds = Math.round(onlineMs / 1000);
    const offlineSeconds = Math.max(0, totalSeconds - onlineSeconds);
    const onlinePct = totalSeconds > 0 ? Math.round((onlineSeconds / totalSeconds) * 1000) / 10 : 0;

    return {
      ...base,
      hasOperator: true,
      onlineSeconds,
      offlineSeconds,
      onlinePct,
      intervals: merged,
    };
  }

  async updateDevice(id: string, dto: UpdateDeviceInput) {
    await this.getDevice(id);
    const setClauses: ReturnType<typeof sql>[] = [sql`updated_at = now()`];
    if ('name' in dto) setClauses.push(sql`name = ${dto.name ?? null}`);
    if ('organizationId' in dto)
      setClauses.push(sql`organization_id = ${dto.organizationId ?? null}::uuid`);
    const set = sql.join(setClauses, sql`, `);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE devices SET ${set} WHERE id = ${id}::uuid AND deleted_at IS NULL RETURNING ${DEVICE_COLS}`,
    );
    return (result as unknown as Row[])[0];
  }

  async deleteDevice(id: string) {
    await this.getDevice(id);
    await this.drizzleProvider.db.execute(
      sql`UPDATE devices SET deleted_at = now(), updated_at = now() WHERE id = ${id}::uuid`,
    );
    return { ok: true };
  }

  async getDeviceOtaStatus(id: string) {
    await this.getDevice(id);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
            dos.id,
            dos.deployment_id   AS "deploymentId",
            dos.device_id       AS "deviceId",
            dos.state,
            dos.error,
            dos.attempt,
            dos.notified_at     AS "notifiedAt",
            dos.downloaded_at   AS "downloadedAt",
            dos.installed_at    AS "installedAt",
            dos.created_at      AS "createdAt",
            dos.updated_at      AS "updatedAt",
            ar.version,
            ar.version_code     AS "versionCode"
          FROM device_ota_status dos
          JOIN ota_deployments od ON od.id = dos.deployment_id
          JOIN app_releases ar ON ar.id = od.release_id
          WHERE dos.device_id = ${id}::uuid
          ORDER BY dos.created_at DESC
          LIMIT 200`,
    );
    return result as unknown as Row[];
  }

  async getDeviceLogs(
    deviceUuid: string,
    level: string = 'all',
    date: string = new Date().toISOString().slice(0, 10),
  ) {
    const { getLogRoot } = await import('../logger/winston-factory');
    const logRoot = getLogRoot();

    const validLevels = ['all', 'error', 'warn', 'info', 'flow', 'debug', 'http'];
    const safeLevel = validLevels.includes(level) ? level : 'all';

    // Harden against path traversal: `date` is interpolated into a filename, so it must
    // be a strict YYYY-MM-DD with no separators. `safeLevel` is already allow-listed.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Invalid date (expected YYYY-MM-DD)');
    }

    const logDir = path.join(logRoot, 'mobile', safeLevel);
    const logFile = path.join(logDir, `${date}.log`);

    // Defense-in-depth: the resolved file must stay inside the level directory.
    const baseDir = path.resolve(logRoot, 'mobile', safeLevel);
    if (!path.resolve(logFile).startsWith(baseDir + path.sep)) {
      throw new BadRequestException('Invalid log path');
    }

    let lines: string[];
    try {
      const content = await fsp.readFile(logFile, 'utf8');
      lines = content.split('\n').filter(Boolean);
    } catch {
      return { entries: [] };
    }

    const entries: Row[] = [];
    for (const line of lines.slice(-1000)) {
      try {
        const parsed = JSON.parse(line) as Row;
        // Filter by deviceId in meta or top-level
        const metaDeviceId = (parsed.meta as Row | undefined)?.deviceId ?? parsed.deviceId;
        if (metaDeviceId !== deviceUuid) continue;
        entries.push({
          level: parsed.level,
          message: parsed.message,
          context: parsed.context,
          meta: parsed.meta,
          recordedAt: (parsed.meta as Row | undefined)?.recordedAt ?? parsed.recordedAt,
          timestamp: parsed.timestamp,
        });
      } catch {
        // skip malformed lines
      }
    }

    return { entries };
  }

  // ─── Super-admin: releases ────────────────────────────────────────────────────

  async listReleases() {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${RELEASE_COLS} FROM app_releases WHERE deleted_at IS NULL ORDER BY version_code DESC LIMIT 500`,
    );
    return result as unknown as Row[];
  }

  async createRelease(
    dto: CreateReleaseInput,
    stream: Readable,
    // mimetype is kept for future strict validation; multipart MIME values vary
    // in practice so we accept any content-type here.
    _mimetype: string,
    uploadedBy: string,
  ) {
    const id = randomUUID();
    const apkKey = `apks/${id}.apk`;
    const dir = path.join(this.uploadsRoot, 'apks');
    await fsp.mkdir(dir, { recursive: true });
    const absolute = path.join(this.uploadsRoot, apkKey);

    let sizeBytes = 0;
    const hashStream = createHash('sha256');
    let firstChunkChecked = false;

    // Write to disk while computing hash + size, validating ZIP magic on first chunk
    const ws = createWriteStream(absolute);
    stream.on('data', (chunk: Buffer) => {
      if (!firstChunkChecked) {
        firstChunkChecked = true;
        // APK files are ZIP archives — magic bytes: 50 4b 03 04 ("PK\x03\x04")
        if (
          chunk.length < 4 ||
          chunk[0] !== 0x50 ||
          chunk[1] !== 0x4b ||
          chunk[2] !== 0x03 ||
          chunk[3] !== 0x04
        ) {
          stream.destroy(new BadRequestException('Not a valid APK (missing ZIP header)'));
          return;
        }
      }
      sizeBytes += chunk.length;
      hashStream.update(chunk);
      if (sizeBytes > APK_MAX_BYTES) {
        stream.destroy(new BadRequestException(`APK exceeds max size of ${APK_MAX_BYTES} bytes`));
      }
    });

    try {
      await pipeline(stream, ws);
    } catch (err) {
      await fsp.unlink(absolute).catch(() => {});
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(err instanceof Error ? err.message : 'Upload failed');
    }

    const sha256 = hashStream.digest('hex');

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO app_releases (id, version, version_code, apk_key, sha256, size_bytes, changelog, mandatory, uploaded_by)
          VALUES (
            ${id}::uuid,
            ${dto.version},
            ${dto.versionCode},
            ${apkKey},
            ${sha256},
            ${sizeBytes},
            ${dto.changelog ?? null},
            ${dto.mandatory ?? false},
            ${uploadedBy}::uuid
          ) RETURNING ${RELEASE_COLS}`,
    );

    this.winston.log('flow', 'APK release created', {
      context: 'FleetService',
      releaseId: id,
      version: dto.version,
      versionCode: dto.versionCode,
      sizeBytes,
    });

    return (result as unknown as Row[])[0];
  }

  async updateRelease(id: string, dto: UpdateReleaseInput) {
    const existing = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM app_releases WHERE id = ${id}::uuid AND deleted_at IS NULL LIMIT 1`,
    );
    if (!(existing as unknown as Row[]).length)
      throw new NotFoundException(`Release ${id} not found`);

    const setClauses: ReturnType<typeof sql>[] = [sql`updated_at = now()`];
    if (dto.status !== undefined) setClauses.push(sql`status = ${dto.status}::release_status`);
    if (dto.mandatory !== undefined) setClauses.push(sql`mandatory = ${dto.mandatory}`);
    if ('changelog' in dto) setClauses.push(sql`changelog = ${dto.changelog ?? null}`);

    if (setClauses.length === 1) {
      const r = await this.drizzleProvider.db.execute(
        sql`SELECT ${RELEASE_COLS} FROM app_releases WHERE id = ${id}::uuid LIMIT 1`,
      );
      return (r as unknown as Row[])[0];
    }

    const set = sql.join(setClauses, sql`, `);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE app_releases SET ${set} WHERE id = ${id}::uuid AND deleted_at IS NULL RETURNING ${RELEASE_COLS}`,
    );
    return (result as unknown as Row[])[0];
  }

  // ─── Super-admin: deployments ─────────────────────────────────────────────────

  async listDeployments() {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
            od.id,
            od.release_id       AS "releaseId",
            od.target_kind      AS "targetKind",
            od.target_org_id    AS "targetOrgId",
            od.target_device_ids AS "targetDeviceIds",
            od.scheduled_at     AS "scheduledAt",
            od.force_now        AS "forceNow",
            od.status,
            od.created_by       AS "createdBy",
            od.created_at       AS "createdAt",
            od.updated_at       AS "updatedAt",
            ar.version,
            ar.version_code     AS "versionCode",
            COUNT(dos.id) FILTER (WHERE dos.state = 'pending')   AS "countPending",
            COUNT(dos.id) FILTER (WHERE dos.state = 'notified')  AS "countNotified",
            COUNT(dos.id) FILTER (WHERE dos.state = 'installed') AS "countInstalled",
            COUNT(dos.id) FILTER (WHERE dos.state = 'failed')    AS "countFailed",
            COUNT(dos.id) AS "countTotal"
          FROM ota_deployments od
          JOIN app_releases ar ON ar.id = od.release_id
          LEFT JOIN device_ota_status dos ON dos.deployment_id = od.id
          GROUP BY od.id, ar.version, ar.version_code
          ORDER BY od.created_at DESC
          LIMIT 500`,
    );
    return result as unknown as Row[];
  }

  async createDeployment(dto: CreateDeploymentInput, createdBy: string) {
    // Verify release exists
    const releaseRows = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM app_releases WHERE id = ${dto.releaseId}::uuid AND deleted_at IS NULL LIMIT 1`,
    );
    if (!(releaseRows as unknown as Row[]).length) {
      throw new NotFoundException(`Release ${dto.releaseId} not found`);
    }

    const immediate = !dto.scheduledAt;
    const status = immediate ? 'active' : 'pending';

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO ota_deployments (
            release_id, target_kind, target_org_id, target_device_ids,
            scheduled_at, force_now, status, created_by
          ) VALUES (
            ${dto.releaseId}::uuid,
            ${dto.targetKind}::ota_target_kind,
            ${dto.targetOrgId ?? null}::uuid,
            ${dto.targetDeviceIds ? `{${dto.targetDeviceIds.join(',')}}` : null}::uuid[],
            ${dto.scheduledAt ?? null},
            ${dto.forceNow ?? false},
            ${status}::ota_deployment_status,
            ${createdBy}::uuid
          ) RETURNING ${DEPLOYMENT_COLS}`,
    );
    const deployment = (result as unknown as Row[])[0];

    this.winston.log('flow', 'OTA deployment created', {
      context: 'FleetService',
      deploymentId: deployment.id,
      releaseId: dto.releaseId,
      targetKind: dto.targetKind,
      status,
    });

    const deploymentId = deployment.id as string;

    if (immediate) {
      // Activate synchronously so the response reflects the live state
      await this.activateDeployment(deploymentId);
    } else {
      // Schedule a BullMQ delayed job; clamp negative delay to 0 (activate now)
      const delay = Math.max(0, new Date(dto.scheduledAt!).getTime() - Date.now());
      await this.otaDeployQueue.add(
        'activate',
        { deploymentId },
        { delay, jobId: `ota-deploy-${deploymentId}` },
      );
      this.winston.log('flow', 'OTA deployment scheduled', {
        context: 'FleetService',
        deploymentId,
        scheduledAt: dto.scheduledAt,
        delayMs: delay,
      });
    }

    return deployment;
  }

  /**
   * Activate a deployment: flip status to active, fan out device_ota_status rows,
   * send FCM acceleration push. Called both immediately and by the BullMQ processor.
   */
  async activateDeployment(deploymentId: string): Promise<void> {
    const db = this.drizzleProvider.db;

    // Fetch deployment + release
    const depRows = await db.execute(
      sql`SELECT od.id, od.target_kind, od.target_org_id, od.target_device_ids, od.status,
               ar.version_code AS "releaseVersionCode"
          FROM ota_deployments od
          JOIN app_releases ar ON ar.id = od.release_id
          WHERE od.id = ${deploymentId}::uuid
          LIMIT 1`,
    );
    type DepRow = {
      id: string;
      target_kind: string;
      target_org_id: string | null;
      target_device_ids: string[] | null;
      status: string;
      releaseVersionCode: number;
    };
    const dep = (depRows as unknown as DepRow[])[0];
    if (!dep) throw new NotFoundException(`Deployment ${deploymentId} not found`);
    if (dep.status === 'cancelled' || dep.status === 'completed') return;

    // Flip to active
    await db.execute(
      sql`UPDATE ota_deployments SET status = 'active'::ota_deployment_status, updated_at = now()
          WHERE id = ${deploymentId}::uuid`,
    );

    // Fan out — find target devices
    let deviceQuery: ReturnType<typeof sql>;
    if (dep.target_kind === 'all') {
      deviceQuery = sql`SELECT id, push_token, version_code FROM devices WHERE deleted_at IS NULL`;
    } else if (dep.target_kind === 'org') {
      deviceQuery = sql`SELECT id, push_token, version_code FROM devices WHERE organization_id = ${dep.target_org_id}::uuid AND deleted_at IS NULL`;
    } else {
      // device_set
      deviceQuery = sql`SELECT id, push_token, version_code FROM devices WHERE id = ANY(${`{${(dep.target_device_ids ?? []).join(',')}}`}::uuid[]) AND deleted_at IS NULL`;
    }

    const deviceRows = await db.execute(deviceQuery);
    type DeviceRow = { id: string; push_token: string | null; version_code: number | null };
    const devices = deviceRows as unknown as DeviceRow[];

    const pushTokens: string[] = [];

    for (const device of devices) {
      const devVersionCode = device.version_code ?? 0;
      const initialState = devVersionCode >= dep.releaseVersionCode ? 'installed' : 'pending';

      await db.execute(
        sql`INSERT INTO device_ota_status (deployment_id, device_id, state, notified_at, installed_at)
            VALUES (
              ${deploymentId}::uuid,
              ${device.id}::uuid,
              ${initialState}::ota_state,
              ${initialState === 'pending' ? sql`now()` : sql`NULL`},
              ${initialState === 'installed' ? sql`now()` : sql`NULL`}
            )
            ON CONFLICT (deployment_id, device_id) DO NOTHING`,
      );

      if (initialState === 'pending' && device.push_token) {
        pushTokens.push(device.push_token);
      }
    }

    this.winston.log('flow', 'OTA deployment activated', {
      context: 'FleetService',
      deploymentId,
      deviceCount: devices.length,
      pushCount: pushTokens.length,
    });

    // Best-effort FCM push
    this.fleetPushService.sendOtaCheckinPush(pushTokens, deploymentId).catch(() => {});
  }

  async cancelDeployment(id: string) {
    // Check existence first (without status filter) so we can give a proper 404
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM ota_deployments WHERE id = ${id}::uuid LIMIT 1`,
    );
    if (!(rows as unknown as Row[]).length)
      throw new NotFoundException(`Deployment ${id} not found`);

    // Only cancel non-terminal deployments; skip already-cancelled/completed ones
    const updated = await this.drizzleProvider.db.execute(
      sql`UPDATE ota_deployments
          SET status = 'cancelled'::ota_deployment_status, updated_at = now()
          WHERE id = ${id}::uuid
            AND status NOT IN ('cancelled', 'completed')
          RETURNING id`,
    );

    if (!(updated as unknown as Row[]).length) {
      throw new ConflictException(`Deployment ${id} is already in a terminal state`);
    }

    this.winston.log('flow', 'OTA deployment cancelled', {
      context: 'FleetService',
      deploymentId: id,
    });

    return { ok: true };
  }

  // ─── Super-admin: Tailscale per-device toggle ─────────────────────────────────

  async setDeviceTailscale(id: string, dto: SetDeviceTailscaleInput): Promise<Row> {
    await this.getDevice(id); // 404 check

    const setClauses: ReturnType<typeof sql>[] = [
      sql`tailscale_desired = ${dto.desired}`,
      sql`updated_at = now()`,
    ];

    // Eagerly set hostname when turning on so the host sync can match immediately
    if (dto.desired) {
      // Read the device name to compute hostname
      const nameRows = await this.drizzleProvider.db.execute(
        sql`SELECT name FROM devices WHERE id = ${id}::uuid AND deleted_at IS NULL LIMIT 1`,
      );
      const deviceName = (nameRows as unknown as { name: string | null }[])[0]?.name ?? null;
      const hostname = this.sanitizeHostname(deviceName, id);
      setClauses.push(sql`tailscale_hostname = ${hostname}`);
    }

    const set = sql.join(setClauses, sql`, `);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE devices SET ${set} WHERE id = ${id}::uuid AND deleted_at IS NULL RETURNING ${DEVICE_COLS}`,
    );
    const updated = (result as unknown as Row[])[0];

    this.winston.log('flow', 'Tailscale desired state toggled', {
      context: 'FleetService',
      deviceId: id,
      desired: dto.desired,
    });

    // Best-effort FCM wake so the device checks in quickly
    const pushToken = updated?.pushToken as string | null | undefined;
    if (pushToken) {
      this.fleetPushService.sendOtaCheckinPush([pushToken], `tailscale-${id}`).catch(() => {});
    }

    return updated;
  }

  // ─── Super-admin: SMS-gateway per-device toggle ──────────────────────────────

  /**
   * Flag/unflag a device as the SMS gateway. When true, `computePendingSms`
   * hands this device pending `outbound_messages` on check-in. Best-effort FCM
   * wake so the change takes effect quickly.
   */
  async setDeviceSmsGateway(id: string, dto: SetDeviceSmsGatewayInput): Promise<Row> {
    await this.getDevice(id); // 404 check

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE devices
            SET is_sms_gateway = ${dto.enabled}, updated_at = now()
          WHERE id = ${id}::uuid AND deleted_at IS NULL
          RETURNING ${DEVICE_COLS}`,
    );
    const updated = (result as unknown as Row[])[0];

    this.winston.log('flow', 'SMS gateway flag toggled', {
      context: 'FleetService',
      deviceId: id,
      enabled: dto.enabled,
    });

    const pushToken = updated?.pushToken as string | null | undefined;
    if (pushToken) {
      this.fleetPushService.sendOtaCheckinPush([pushToken], `sms-gateway-${id}`).catch(() => {});
    }

    return updated;
  }

  /**
   * Enqueue a one-off test SMS for the gateway. Writes a `pending`
   * `outbound_messages` row exactly like the messaging service does; the flagged
   * gateway claims it on its next check-in and sends it via the SIM. Requires the
   * device to already be a gateway (else the row would never be claimed).
   */
  async enqueueGatewayTestSms(
    id: string,
    dto: TestSmsInput,
  ): Promise<{ ok: true; messageId: string }> {
    const device = (await this.getDevice(id)) as Record<string, unknown>;
    if (!device['isSmsGateway']) {
      throw new BadRequestException('Device is not an SMS gateway — enable it first');
    }
    const orgId = (device['organizationId'] as string | null) ?? null;
    const body = dto.body?.trim() || `StrawBoss test SMS · ${new Date().toISOString()}`;

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO outbound_messages (organization_id, channel, kind, to_address, body, status)
          VALUES (${orgId}::uuid, 'sms', 'gateway_test', ${dto.to}, ${body}, 'pending')
          RETURNING id`,
    );
    const messageId = (result as unknown as { id: string }[])[0]?.id;

    this.winston.log('flow', 'Gateway test SMS enqueued', {
      context: 'FleetService',
      deviceId: id,
      to: dto.to,
      messageId,
    });

    return { ok: true, messageId };
  }

  // ─── Super-admin: global outbound-messages monitor ──────────────────────────

  /**
   * GET /api/v1/super-admin/messages — global outbox list (NOT org-scoped), so
   * NULL-org rows (e.g. gateway_test from an unassigned gateway) are visible.
   */
  async listAllMessages(filters: {
    channel?: string;
    status?: string;
    deviceId?: string;
  }): Promise<Row[]> {
    const conds = [sql`true`];
    if (filters.channel) conds.push(sql`channel = ${filters.channel}`);
    if (filters.status) conds.push(sql`status = ${filters.status}`);
    if (filters.deviceId) conds.push(sql`claimed_by_device = ${filters.deviceId}::uuid`);
    const where = sql.join(conds, sql` AND `);
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT ${OUTBOUND_MESSAGE_COLS} FROM outbound_messages
          WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
    );
    return rows as unknown as Row[];
  }

  /** GET /api/v1/super-admin/devices/:id/messages — outbox history for one gateway. */
  async listDeviceMessages(id: string): Promise<Row[]> {
    await this.getDevice(id); // 404-guard
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT ${OUTBOUND_MESSAGE_COLS} FROM outbound_messages
          WHERE claimed_by_device = ${id}::uuid ORDER BY created_at DESC LIMIT 200`,
    );
    return rows as unknown as Row[];
  }

  /**
   * POST /api/v1/super-admin/messages/:id/retry — global retry (no org predicate).
   * SMS → reset to pending for re-claim; email → re-POST to Resend. Mirrors
   * MessagesService.retry() minus the organization_id filter.
   */
  async retryMessage(id: string): Promise<{ ok: true }> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT id, channel, to_address AS "to", subject, body, html
          FROM outbound_messages WHERE id = ${id}::uuid LIMIT 1`,
    )) as unknown as {
      id: string;
      channel: string;
      to: string;
      subject: string | null;
      body: string;
      html: string | null;
    }[];
    const row = rows[0];
    if (!row) throw new NotFoundException('Message not found');

    // SMS: reset to pending so a gateway device re-claims and re-sends it.
    if (row.channel === 'sms') {
      await this.drizzleProvider.db.execute(
        sql`UPDATE outbound_messages
            SET status = 'pending', claimed_by_device = NULL, error = NULL, updated_at = now()
            WHERE id = ${id}::uuid`,
      );
      return { ok: true };
    }

    // Email: re-POST to Resend, updating this same row.
    const key = this.configService.get<string>('RESEND_API_KEY');
    const from = this.configService.get<string>('RESEND_FROM');
    if (!key || !from) throw new BadRequestException('RESEND_API_KEY / RESEND_FROM not configured');
    const result = await postResendEmail(key, from, {
      to: row.to,
      subject: row.subject ?? '',
      html: row.html,
      text: row.body,
    });
    if (!result.ok) {
      await this.drizzleProvider.db.execute(
        sql`UPDATE outbound_messages
            SET status = 'failed', error = ${(result.error ?? 'error').slice(0, 500)},
                attempts = attempts + 1, updated_at = now()
            WHERE id = ${id}::uuid`,
      );
      throw new BadRequestException(result.error ?? 'send failed');
    }
    await this.drizzleProvider.db.execute(
      sql`UPDATE outbound_messages
          SET status = 'sent', provider_message_id = ${result.providerId ?? null}, error = NULL,
              attempts = attempts + 1, sent_at = now(), updated_at = now()
          WHERE id = ${id}::uuid`,
    );
    return { ok: true };
  }

  // ─── Super-admin: app_settings (Tailscale global config) ─────────────────────

  private maskSettings(row: {
    tailscaleAuthKey: string | null;
    tailscaleTailnet: string | null;
    tailscaleOauthClientId: string | null;
    tailscaleOauthClientSecret: string | null;
    tailscaleTag: string | null;
    tailscaleApkKey: string | null;
    updatedAt: string | null;
  }): AppSettings {
    return {
      tailscaleAuthKeySet: !!row.tailscaleAuthKey,
      tailscaleTailnet: row.tailscaleTailnet,
      tailscaleOauthConfigured: !!(row.tailscaleOauthClientId && row.tailscaleOauthClientSecret),
      tailscaleTag: row.tailscaleTag,
      tailscaleApkSet: !!row.tailscaleApkKey,
      updatedAt: row.updatedAt,
    };
  }

  async getTailscaleSettings(): Promise<AppSettings> {
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT tailscale_auth_key           AS "tailscaleAuthKey",
                 tailscale_tailnet            AS "tailscaleTailnet",
                 tailscale_oauth_client_id    AS "tailscaleOauthClientId",
                 tailscale_oauth_client_secret AS "tailscaleOauthClientSecret",
                 tailscale_tag               AS "tailscaleTag",
                 tailscale_apk_key           AS "tailscaleApkKey",
                 updated_at                  AS "updatedAt"
          FROM app_settings
          WHERE id = true
          LIMIT 1`,
    );
    const row = (
      rows as unknown as {
        tailscaleAuthKey: string | null;
        tailscaleTailnet: string | null;
        tailscaleOauthClientId: string | null;
        tailscaleOauthClientSecret: string | null;
        tailscaleTag: string | null;
        tailscaleApkKey: string | null;
        updatedAt: string | null;
      }[]
    )[0];

    if (!row) {
      // Should not happen (migration seeds the singleton row), but be defensive
      return {
        tailscaleAuthKeySet: false,
        tailscaleTailnet: null,
        tailscaleOauthConfigured: false,
        tailscaleTag: null,
        tailscaleApkSet: false,
        updatedAt: null,
      };
    }

    return this.maskSettings(row);
  }

  async updateTailscaleSettings(
    dto: UpdateTailscaleSettingsInput,
    updatedBy: string,
  ): Promise<AppSettings> {
    const setClauses: ReturnType<typeof sql>[] = [
      sql`updated_at = now()`,
      sql`updated_by = ${updatedBy}::uuid`,
    ];

    // authKey: undefined/null = leave unchanged; '' = clear; non-empty string = set
    if (dto.authKey !== undefined && dto.authKey !== null) {
      if (dto.authKey === '') {
        setClauses.push(sql`tailscale_auth_key = NULL`);
      } else {
        setClauses.push(sql`tailscale_auth_key = ${dto.authKey}`);
      }
    }

    if (dto.tailnet !== undefined && dto.tailnet !== null) {
      setClauses.push(sql`tailscale_tailnet = ${dto.tailnet}`);
    }

    // oauthClientId: undefined/null = leave unchanged; '' = clear; non-empty = set
    if (dto.oauthClientId !== undefined && dto.oauthClientId !== null) {
      if (dto.oauthClientId === '') {
        setClauses.push(sql`tailscale_oauth_client_id = NULL`);
      } else {
        setClauses.push(sql`tailscale_oauth_client_id = ${dto.oauthClientId}`);
      }
    }

    // oauthClientSecret: undefined/null = leave unchanged; '' = clear; non-empty = set
    if (dto.oauthClientSecret !== undefined && dto.oauthClientSecret !== null) {
      if (dto.oauthClientSecret === '') {
        setClauses.push(sql`tailscale_oauth_client_secret = NULL`);
      } else {
        setClauses.push(sql`tailscale_oauth_client_secret = ${dto.oauthClientSecret}`);
      }
    }

    // tag: undefined/null = leave unchanged; '' = clear; non-empty = set
    if (dto.tag !== undefined && dto.tag !== null) {
      if (dto.tag === '') {
        setClauses.push(sql`tailscale_tag = NULL`);
      } else {
        setClauses.push(sql`tailscale_tag = ${dto.tag}`);
      }
    }

    // A settings change always resets the OAuth mint back-off so the new credentials
    // are tried immediately on the next check-in.
    setClauses.push(sql`tailscale_mint_failed_at = NULL`);

    const set = sql.join(setClauses, sql`, `);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE app_settings SET ${set}
          WHERE id = true
          RETURNING tailscale_auth_key           AS "tailscaleAuthKey",
                    tailscale_tailnet            AS "tailscaleTailnet",
                    tailscale_oauth_client_id    AS "tailscaleOauthClientId",
                    tailscale_oauth_client_secret AS "tailscaleOauthClientSecret",
                    tailscale_tag               AS "tailscaleTag",
                    tailscale_apk_key           AS "tailscaleApkKey",
                    updated_at                  AS "updatedAt"`,
    );
    const row = (
      result as unknown as {
        tailscaleAuthKey: string | null;
        tailscaleTailnet: string | null;
        tailscaleOauthClientId: string | null;
        tailscaleOauthClientSecret: string | null;
        tailscaleTag: string | null;
        tailscaleApkKey: string | null;
        updatedAt: string | null;
      }[]
    )[0];

    this.winston.log('flow', 'Tailscale settings updated', {
      context: 'FleetService',
      updatedBy,
      authKeyChanged: dto.authKey !== undefined,
      tailnetChanged: dto.tailnet !== undefined,
      oauthChanged: dto.oauthClientId !== undefined || dto.oauthClientSecret !== undefined,
      tagChanged: dto.tag !== undefined,
    });

    // Guard against missing singleton row (should never happen, but be defensive)
    if (!row) {
      return this.getTailscaleSettings();
    }

    return this.maskSettings(row);
  }

  // ─── Tailscale OAuth: mint ephemeral auth key ─────────────────────────────────

  /**
   * Mint a single-use ephemeral Tailscale auth key via the OAuth2 client-credentials
   * flow. Two API calls:
   *   1. POST https://api.tailscale.com/api/v2/oauth/token  → access_token
   *   2. POST https://api.tailscale.com/api/v2/tailnet/-/keys  → key
   *
   * Returns the minted key string, or null on any error (network, non-2xx). The
   * caller is responsible for falling back to the shared auth key.
   */
  private async mintEphemeralAuthKey(
    clientId: string,
    clientSecret: string,
    tag: string,
    hostname: string,
  ): Promise<string | null> {
    try {
      // Step 1: client-credentials token exchange
      const tokenBody = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      });
      const tokenRes = await fetch('https://api.tailscale.com/api/v2/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      });
      if (!tokenRes.ok) {
        this.winston.warn('Tailscale OAuth token exchange failed', {
          context: 'FleetService',
          status: tokenRes.status,
        });
        return null;
      }
      const tokenJson = (await tokenRes.json()) as { access_token?: string };
      const accessToken = tokenJson.access_token;
      if (!accessToken) {
        this.winston.warn('Tailscale OAuth token response missing access_token', {
          context: 'FleetService',
        });
        return null;
      }

      // Step 2: mint ephemeral key
      const keyRes = await fetch('https://api.tailscale.com/api/v2/tailnet/-/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          capabilities: {
            devices: {
              create: {
                reusable: false,
                ephemeral: true,
                preauthorized: true,
                tags: [tag],
              },
            },
          },
          expirySeconds: 3600,
          description: `fleet ${hostname}`,
        }),
      });
      if (!keyRes.ok) {
        this.winston.warn('Tailscale key minting failed', {
          context: 'FleetService',
          status: keyRes.status,
        });
        return null;
      }
      const keyJson = (await keyRes.json()) as { key?: string };
      const key = keyJson.key;
      if (!key) {
        this.winston.warn('Tailscale key response missing key field', {
          context: 'FleetService',
        });
        return null;
      }

      return key;
    } catch (err) {
      this.winston.warn('Tailscale mintEphemeralAuthKey threw', {
        context: 'FleetService',
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  // ─── Tailscale APK upload ─────────────────────────────────────────────────────

  async uploadTailscaleApk(stream: Readable): Promise<AppSettings> {
    const db = this.drizzleProvider.db;
    const apkKey = 'tailscale/tailscale.apk';
    const dir = path.join(this.uploadsRoot, 'tailscale');
    await fsp.mkdir(dir, { recursive: true });
    const absolute = path.join(this.uploadsRoot, apkKey);

    let sizeBytes = 0;
    const hashStream = createHash('sha256');
    let firstChunkChecked = false;

    const ws = createWriteStream(absolute);
    stream.on('data', (chunk: Buffer) => {
      if (!firstChunkChecked) {
        firstChunkChecked = true;
        // APK files are ZIP archives — magic bytes: 50 4b 03 04 ("PK\x03\x04")
        if (
          chunk.length < 4 ||
          chunk[0] !== 0x50 ||
          chunk[1] !== 0x4b ||
          chunk[2] !== 0x03 ||
          chunk[3] !== 0x04
        ) {
          stream.destroy(new BadRequestException('Not a valid APK (missing ZIP header)'));
          return;
        }
      }
      sizeBytes += chunk.length;
      hashStream.update(chunk);
      if (sizeBytes > APK_MAX_BYTES) {
        stream.destroy(
          new BadRequestException(`Tailscale APK exceeds max size of ${APK_MAX_BYTES} bytes`),
        );
      }
    });

    try {
      await pipeline(stream, ws);
    } catch (err) {
      await fsp.unlink(absolute).catch(() => {});
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(err instanceof Error ? err.message : 'Upload failed');
    }

    const sha256 = hashStream.digest('hex');

    await db.execute(
      sql`UPDATE app_settings
          SET tailscale_apk_key    = ${apkKey},
              tailscale_apk_sha256 = ${sha256},
              tailscale_apk_size   = ${sizeBytes},
              updated_at           = now()
          WHERE id = true`,
    );

    this.winston.log('flow', 'Tailscale APK uploaded', {
      context: 'FleetService',
      sha256,
      sizeBytes,
    });

    return this.getTailscaleSettings();
  }
}
