import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';

/**
 * Best-effort FCM acceleration / wake push (OTA + presence dead-man).
 *
 * firebase-admin is NOT installed. We dynamically import it via a non-literal
 * specifier so TypeScript resolves it to `any` and the app boots cleanly
 * without the package. The service account is read from either
 * `FIREBASE_SERVICE_ACCOUNT_FILE` (a path — preferred, avoids cramming a
 * multi-line private key into env / the escaping pitfalls that break JSON.parse)
 * or `FIREBASE_SERVICE_ACCOUNT` (inline JSON). If neither is present the service
 * logs once at info and becomes a no-op; the device poll remains the
 * authoritative delivery mechanism.
 */
@Injectable()
export class FleetPushService {
  private fcmInitialised = false;
  private fcmApp: unknown = null;
  private fcmWarned = false;

  // FCM error codes that mean the token is permanently dead → caller should prune it.
  private static readonly DEAD_TOKEN_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
  ]);
  private static readonly SEND_TIMEOUT_MS = 12_000;

  constructor(
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  /** Service account JSON from FIREBASE_SERVICE_ACCOUNT_FILE (path) or inline env. */
  private resolveServiceAccountJson(): string | null {
    const filePath = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_FILE');
    if (filePath) {
      try {
        return readFileSync(filePath, 'utf8');
      } catch (err) {
        this.winston.warn('Could not read FIREBASE_SERVICE_ACCOUNT_FILE', {
          context: 'FleetPushService',
          filePath,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT') ?? null;
  }

  private async initFcm(): Promise<boolean> {
    if (this.fcmInitialised) return this.fcmApp !== null;

    this.fcmInitialised = true;
    const serviceAccountJson = this.resolveServiceAccountJson();
    if (!serviceAccountJson) {
      if (!this.fcmWarned) {
        this.fcmWarned = true;
        this.winston.info('FCM push disabled — devices will pick up via poll', {
          context: 'FleetPushService',
        });
      }
      return false;
    }

    try {
      // Non-literal import so TS infers `any` (package is not in node_modules).
      const pkg = 'firebase-admin';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin: any = await import(pkg).catch(() => null);
      if (!admin) {
        this.winston.warn('firebase-admin not available; FCM push disabled', {
          context: 'FleetPushService',
        });
        return false;
      }

      const serviceAccount = JSON.parse(serviceAccountJson) as Record<string, unknown>;
      if (admin.apps.length === 0) {
        this.fcmApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } else {
        this.fcmApp = admin.apps[0];
      }
      this.winston.info('FCM push enabled', {
        context: 'FleetPushService',
        project: (serviceAccount.project_id as string) ?? 'unknown',
      });
      return true;
    } catch (err) {
      this.winston.error('Failed to initialise firebase-admin', {
        context: 'FleetPushService',
        err: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Send a data-only OTA check-in push to a set of FCM tokens.
   * Chunked to avoid FCM's per-request limit. Best-effort — errors are logged
   * but never thrown.
   */
  async sendOtaCheckinPush(pushTokens: string[], deploymentId: string): Promise<void> {
    await this.sendDataWake(
      pushTokens,
      { type: 'ota_checkin', deploymentId },
      'sendOtaCheckinPush',
    );
  }

  /**
   * Presence dead-man wake: high-priority data push that wakes a silent
   * device-owner phone's process (there is no JS handler — the wake itself
   * restarts the process, which re-arms the keep-alive PresenceService via
   * MainApplication.onCreate). Returns the tokens FCM reported as permanently
   * invalid so the caller can prune them from devices.push_token.
   */
  async sendPresenceWake(pushTokens: string[]): Promise<string[]> {
    return this.sendDataWake(pushTokens, { type: 'presence_wake' }, 'sendPresenceWake');
  }

  /**
   * Shared high-priority data multicast. Best-effort; never throws. Each chunk is
   * bounded by a timeout so a stalled FCM call can't hang the caller (e.g. the
   * 2-min dead-man scan). Returns tokens FCM reported as permanently dead.
   */
  private async sendDataWake(
    pushTokens: string[],
    data: Record<string, string>,
    label: string,
  ): Promise<string[]> {
    const dead: string[] = [];
    if (!pushTokens.length) return dead;

    const ready = await this.initFcm();
    if (!ready || !this.fcmApp) return dead;

    try {
      const pkg = 'firebase-admin';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin: any = await import(pkg).catch(() => null);
      if (!admin) return dead;

      const messaging = admin.messaging(this.fcmApp);
      const CHUNK = 500;
      for (let i = 0; i < pushTokens.length; i += CHUNK) {
        const chunk = pushTokens.slice(i, i + CHUNK);
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const resp: any = await Promise.race([
            messaging.sendEachForMulticast({ tokens: chunk, data, android: { priority: 'high' } }),
            new Promise((_resolve, reject) =>
              setTimeout(
                () => reject(new Error('FCM send timed out')),
                FleetPushService.SEND_TIMEOUT_MS,
              ),
            ),
          ]);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const responses: any[] = (resp && resp.responses) || [];
          responses.forEach((r, idx) => {
            const code = r?.error?.code;
            if (!r?.success && code && FleetPushService.DEAD_TOKEN_CODES.has(code)) {
              dead.push(chunk[idx]);
            }
          });
        } catch (err) {
          this.winston.warn('FCM multicast chunk failed', {
            context: 'FleetPushService',
            label,
            chunkStart: i,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      this.winston.error(`${label} unexpected error`, {
        context: 'FleetPushService',
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return dead;
  }
}
