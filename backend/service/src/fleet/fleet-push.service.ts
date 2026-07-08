import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';

/**
 * Best-effort FCM acceleration push for OTA deployments.
 *
 * firebase-admin is NOT installed. We dynamically import it via a non-literal
 * specifier so TypeScript resolves it to `any` and the app boots cleanly
 * without the package. If `FIREBASE_SERVICE_ACCOUNT` is absent the service
 * logs once at info and becomes a no-op; the device poll remains the
 * authoritative delivery mechanism.
 */
@Injectable()
export class FleetPushService {
  private fcmInitialised = false;
  private fcmApp: unknown = null;
  private fcmWarned = false;

  constructor(
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  private async initFcm(): Promise<boolean> {
    if (this.fcmInitialised) return this.fcmApp !== null;

    this.fcmInitialised = true;
    const serviceAccountJson = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT');
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
   * MainApplication.onCreate). Called by the presence-deadman BullMQ job for
   * device-owner phones whose last_checkin_at has gone stale.
   */
  async sendPresenceWake(pushTokens: string[]): Promise<void> {
    await this.sendDataWake(pushTokens, { type: 'presence_wake' }, 'sendPresenceWake');
  }

  /** Shared high-priority data multicast. Best-effort; never throws. */
  private async sendDataWake(
    pushTokens: string[],
    data: Record<string, string>,
    label: string,
  ): Promise<void> {
    if (!pushTokens.length) return;

    const ready = await this.initFcm();
    if (!ready || !this.fcmApp) return;

    try {
      const pkg = 'firebase-admin';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin: any = await import(pkg).catch(() => null);
      if (!admin) return;

      const messaging = admin.messaging(this.fcmApp);
      const CHUNK = 500;
      for (let i = 0; i < pushTokens.length; i += CHUNK) {
        const chunk = pushTokens.slice(i, i + CHUNK);
        try {
          await messaging.sendEachForMulticast({
            tokens: chunk,
            data,
            android: { priority: 'high' },
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
  }
}
