import {
  Injectable,
  Inject,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { createWriteStream, promises as fsp } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import { resolveUploadsRoot } from '../uploads/uploads.service';
import { signUploadUrl, UPLOADS_URL_PREFIX } from '../uploads/uploads-signing';
import type {
  DeviceCheckinResponse,
  PendingDeployment,
  OtaState,
  DeviceCommand,
  AppSettings,
} from '@strawboss/types';
import type {
  DeviceCheckinInput,
  CreateReleaseInput,
  UpdateReleaseInput,
  CreateDeploymentInput,
  UpdateDeviceInput,
  SetDeviceTailscaleInput,
  UpdateTailscaleSettingsInput,
} from '@strawboss/validation';
import { FleetPushService } from './fleet-push.service';
import { QUEUE_OTA_DEPLOY } from '../jobs/queues';

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

  // ─── HMAC helpers ────────────────────────────────────────────────────────────

  private computeDeviceToken(deviceUuid: string): string {
    return createHmac('sha256', this.jwtSecret).update(deviceUuid).digest('hex');
  }

  private verifyDeviceToken(deviceUuid: string, token: string): boolean {
    const expected = this.computeDeviceToken(deviceUuid);
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
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

    if (rows.length === 0) {
      // REGISTRATION — first check-in for this deviceUuid
      const token = this.computeDeviceToken(dto.deviceUuid);
      const inserted = await db.execute(
        sql`INSERT INTO devices (
              device_uuid, device_token_hash,
              app_version, version_code, model, manufacturer, os_version, android_id,
              push_token, is_device_owner, last_active_trip,
              last_seen_at, last_checkin_at
            ) VALUES (
              ${dto.deviceUuid}, ${token},
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
      if (!this.verifyDeviceToken(dto.deviceUuid, dto.deviceToken)) {
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

    // 4. Compute pending deployment
    const pendingDeployment = await this.computePendingDeployment(deviceId, dto.versionCode, orgId);

    // 5. Compute pending Tailscale command
    const pendingCommand = await this.computePendingCommand(deviceId);

    return {
      deviceId,
      assignedOrgId: orgId,
      ...(deviceTokenIssued ? { deviceTokenIssued } : {}),
      pendingDeployment,
      pendingCommand,
    };
  }

  private async applyCommandReports(
    deviceId: string,
    reports: { commandId: string; status: 'success' | 'failure'; error?: string }[],
  ): Promise<void> {
    const db = this.drizzleProvider.db;

    // Fetch current device tailscale state once for all reports
    const deviceRows = await db.execute(
      sql`SELECT tailscale_desired FROM devices WHERE id = ${deviceId}::uuid AND deleted_at IS NULL LIMIT 1`,
    );
    const deviceRow = (deviceRows as unknown as { tailscale_desired: boolean }[])[0];
    if (!deviceRow) return;

    for (const report of reports) {
      if (report.status === 'success') {
        // Device successfully applied the desired state — mark it applied
        await db.execute(
          sql`UPDATE devices SET
                tailscale_applied    = tailscale_desired,
                tailscale_last_error = NULL,
                updated_at           = now()
              WHERE id = ${deviceId}::uuid`,
        );
        this.winston.log('flow', 'Tailscale command applied by device', {
          context: 'FleetService',
          deviceId,
          commandId: report.commandId,
          desired: deviceRow.tailscale_desired,
        });
      } else {
        // Failure — record the error (do NOT update tailscale_applied)
        await db.execute(
          sql`UPDATE devices SET
                tailscale_last_error = ${report.error ?? 'unknown error'},
                updated_at           = now()
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

  private async computePendingCommand(deviceId: string): Promise<DeviceCommand | null> {
    const db = this.drizzleProvider.db;

    // Read device tailscale state (re-read after applying reports)
    const deviceRows = await db.execute(
      sql`SELECT name, tailscale_desired, tailscale_applied
          FROM devices
          WHERE id = ${deviceId}::uuid AND deleted_at IS NULL
          LIMIT 1`,
    );
    const device = (
      deviceRows as unknown as {
        name: string | null;
        tailscale_desired: boolean;
        tailscale_applied: boolean;
      }[]
    )[0];
    if (!device) return null;

    // If desired === applied, nothing to do
    if (device.tailscale_desired === device.tailscale_applied) return null;

    const action = device.tailscale_desired ? 'up' : 'down';

    if (action === 'down') {
      // No auth key needed for 'down'
      return {
        id: randomUUID(),
        type: 'tailscale',
        action: 'down',
      };
    }

    // action === 'up' — need the auth key from app_settings
    const settingsRows = await db.execute(
      sql`SELECT tailscale_auth_key AS "tailscaleAuthKey", tailscale_tailnet AS "tailscaleTailnet"
          FROM app_settings
          WHERE id = true
          LIMIT 1`,
    );
    const settings = (
      settingsRows as unknown as { tailscaleAuthKey: string | null; tailscaleTailnet: string }[]
    )[0];

    if (!settings?.tailscaleAuthKey) {
      // No auth key configured — record error, don't issue command
      await db.execute(
        sql`UPDATE devices SET
              tailscale_last_error = 'no Tailscale auth key configured',
              updated_at           = now()
            WHERE id = ${deviceId}::uuid`,
      );
      this.winston.warn('Cannot issue Tailscale up command — no auth key configured', {
        context: 'FleetService',
        deviceId,
      });
      return null;
    }

    const hostname = this.sanitizeHostname(device.name, deviceId);

    // Eagerly persist the hostname so the host status-sync script can match it
    await db.execute(
      sql`UPDATE devices SET
            tailscale_hostname = ${hostname},
            updated_at         = now()
          WHERE id = ${deviceId}::uuid`,
    );

    return {
      id: randomUUID(),
      type: 'tailscale',
      action: 'up',
      payload: {
        authKey: settings.tailscaleAuthKey,
        hostname,
        tailnet: settings.tailscaleTailnet ?? 'tail2b4c34.ts.net',
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

        // Lazy fan-out — create the status row as notified
        const inserted = await db.execute(
          sql`INSERT INTO device_ota_status (deployment_id, device_id, state, notified_at)
              VALUES (${fanRow.deploymentId}::uuid, ${deviceId}::uuid, 'notified'::ota_state, now())
              ON CONFLICT (deployment_id, device_id) DO UPDATE SET
                state = EXCLUDED.state,
                notified_at = EXCLUDED.notified_at,
                updated_at = now()
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
            d.created_at            AS "createdAt",
            d.updated_at            AS "updatedAt",
            d.deleted_at            AS "deletedAt",
            o.name                  AS "organizationName",
            latest.state            AS "latestOtaState",
            latest.deployment_id    AS "latestDeploymentId"
          FROM devices d
          LEFT JOIN organizations o ON o.id = d.organization_id AND o.deleted_at IS NULL
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

    // Write to disk while computing hash + size
    const ws = createWriteStream(absolute);
    stream.on('data', (chunk: Buffer) => {
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
            ${dto.targetDeviceIds ? JSON.stringify(dto.targetDeviceIds.map((id) => id)) : null}::uuid[],
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
      deviceQuery = sql`SELECT id, push_token, version_code FROM devices WHERE id = ANY(${JSON.stringify(dep.target_device_ids ?? [])}::uuid[]) AND deleted_at IS NULL`;
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
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM ota_deployments WHERE id = ${id}::uuid LIMIT 1`,
    );
    if (!(rows as unknown as Row[]).length)
      throw new NotFoundException(`Deployment ${id} not found`);

    await this.drizzleProvider.db.execute(
      sql`UPDATE ota_deployments SET status = 'cancelled'::ota_deployment_status, updated_at = now()
          WHERE id = ${id}::uuid`,
    );

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

  // ─── Super-admin: app_settings (Tailscale global config) ─────────────────────

  private maskSettings(row: {
    tailscaleAuthKey: string | null;
    tailscaleTailnet: string | null;
    updatedAt: string | null;
  }): AppSettings {
    return {
      tailscaleAuthKey: null, // NEVER return the raw key
      tailscaleAuthKeySet: !!row.tailscaleAuthKey,
      tailscaleTailnet: row.tailscaleTailnet,
      updatedAt: row.updatedAt,
    };
  }

  async getTailscaleSettings(): Promise<AppSettings> {
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT tailscale_auth_key AS "tailscaleAuthKey",
                 tailscale_tailnet  AS "tailscaleTailnet",
                 updated_at         AS "updatedAt"
          FROM app_settings
          WHERE id = true
          LIMIT 1`,
    );
    const row = (
      rows as unknown as {
        tailscaleAuthKey: string | null;
        tailscaleTailnet: string | null;
        updatedAt: string | null;
      }[]
    )[0];

    if (!row) {
      // Should not happen (migration seeds the singleton row), but be defensive
      return {
        tailscaleAuthKey: null,
        tailscaleAuthKeySet: false,
        tailscaleTailnet: 'tail2b4c34.ts.net',
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

    if (dto.authKey !== undefined) {
      // null or omitted = leave unchanged, empty string = clear to NULL, non-empty = set
      if (dto.authKey === null) {
        // null means "leave unchanged" per schema doc — skip
      } else if (dto.authKey === '') {
        setClauses.push(sql`tailscale_auth_key = NULL`);
      } else {
        setClauses.push(sql`tailscale_auth_key = ${dto.authKey}`);
      }
    }

    if (dto.tailnet !== undefined && dto.tailnet !== null) {
      setClauses.push(sql`tailscale_tailnet = ${dto.tailnet}`);
    }

    const set = sql.join(setClauses, sql`, `);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE app_settings SET ${set}
          WHERE id = true
          RETURNING tailscale_auth_key AS "tailscaleAuthKey",
                    tailscale_tailnet  AS "tailscaleTailnet",
                    updated_at         AS "updatedAt"`,
    );
    const row = (
      result as unknown as {
        tailscaleAuthKey: string | null;
        tailscaleTailnet: string | null;
        updatedAt: string | null;
      }[]
    )[0];

    this.winston.log('flow', 'Tailscale settings updated', {
      context: 'FleetService',
      updatedBy,
      authKeyChanged: dto.authKey !== undefined,
      tailnetChanged: dto.tailnet !== undefined,
    });

    return this.maskSettings(row);
  }
}
