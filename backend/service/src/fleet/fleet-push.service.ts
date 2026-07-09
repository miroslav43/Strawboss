import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { createSign } from 'crypto';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';

/**
 * Best-effort FCM wake push (OTA acceleration + presence dead-man), sent via the
 * FCM HTTP v1 API directly — NO firebase-admin dependency (the backend image installs
 * with `--frozen-lockfile`, and firebase-admin's transitive tree isn't in the lockfile).
 * We sign a short-lived OAuth2 access token from the service-account key with Node's
 * built-in crypto, then POST one message per token. High-priority data messages are
 * Doze-exempt, so this is the one layer that wakes a device-owner phone silent in deep
 * Doze (its on-device exact-idle alarms are throttled to the maintenance windows).
 *
 * Service account is read from FIREBASE_SERVICE_ACCOUNT_FILE (path, preferred) or
 * FIREBASE_SERVICE_ACCOUNT (inline JSON). Absent/invalid → the service is a no-op
 * (device poll remains the fallback).
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

@Injectable()
export class FleetPushService {
  private sa: ServiceAccount | null = null;
  private saResolved = false;
  private disabledWarned = false;
  private accessToken: string | null = null;
  private accessTokenExpMs = 0;

  private static readonly REQ_TIMEOUT_MS = 10_000;
  private static readonly SEND_CONCURRENCY = 10;
  private static readonly TOKEN_URL = 'https://oauth2.googleapis.com/token';
  private static readonly FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

  constructor(
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  /** Parse the service account once from file or inline env. Null → FCM disabled. */
  private loadServiceAccount(): ServiceAccount | null {
    if (this.saResolved) return this.sa;
    this.saResolved = true;

    let json: string | null = null;
    const filePath = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_FILE');
    if (filePath) {
      try {
        json = readFileSync(filePath, 'utf8');
      } catch (err) {
        this.winston.warn('Could not read FIREBASE_SERVICE_ACCOUNT_FILE', {
          context: 'FleetPushService',
          filePath,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (!json) json = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT') ?? null;

    if (!json) {
      if (!this.disabledWarned) {
        this.disabledWarned = true;
        this.winston.info('FCM push disabled — devices will pick up via poll', {
          context: 'FleetPushService',
        });
      }
      return null;
    }

    try {
      const p = JSON.parse(json) as Partial<ServiceAccount>;
      if (!p.client_email || !p.private_key || !p.project_id) {
        this.winston.warn('FIREBASE service account JSON missing required fields', {
          context: 'FleetPushService',
        });
        return null;
      }
      this.sa = {
        client_email: p.client_email,
        private_key: p.private_key,
        project_id: p.project_id,
      };
      this.winston.info('FCM push enabled (HTTP v1)', {
        context: 'FleetPushService',
        project: this.sa.project_id,
      });
      return this.sa;
    } catch (err) {
      this.winston.error('Failed to parse FIREBASE service account JSON', {
        context: 'FleetPushService',
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private static base64url(input: string | Buffer): string {
    return Buffer.from(input)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private static async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FleetPushService.REQ_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** OAuth2 access token for FCM, cached until ~1 min before expiry. */
  private async getAccessToken(sa: ServiceAccount): Promise<string | null> {
    if (this.accessToken && Date.now() < this.accessTokenExpMs - 60_000) return this.accessToken;
    try {
      const now = Math.floor(Date.now() / 1000);
      const header = FleetPushService.base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claim = FleetPushService.base64url(
        JSON.stringify({
          iss: sa.client_email,
          scope: FleetPushService.FCM_SCOPE,
          aud: FleetPushService.TOKEN_URL,
          iat: now,
          exp: now + 3600,
        }),
      );
      const signer = createSign('RSA-SHA256');
      signer.update(`${header}.${claim}`);
      const signature = FleetPushService.base64url(signer.sign(sa.private_key));
      const jwt = `${header}.${claim}.${signature}`;

      const res = await FleetPushService.fetchWithTimeout(FleetPushService.TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt,
        }).toString(),
      });
      if (!res.ok) {
        this.winston.warn('FCM OAuth token request failed', {
          context: 'FleetPushService',
          status: res.status,
        });
        return null;
      }
      const body = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!body.access_token) return null;
      this.accessToken = body.access_token;
      this.accessTokenExpMs = Date.now() + (body.expires_in ?? 3600) * 1000;
      return this.accessToken;
    } catch (err) {
      this.winston.warn('FCM OAuth token error', {
        context: 'FleetPushService',
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /** Data-only OTA check-in push. Best-effort; never throws. */
  async sendOtaCheckinPush(pushTokens: string[], deploymentId: string): Promise<void> {
    await this.sendDataWake(
      pushTokens,
      { type: 'ota_checkin', deploymentId },
      'sendOtaCheckinPush',
    );
  }

  /**
   * Presence dead-man wake. Returns tokens FCM reported as permanently invalid so the
   * caller can prune devices.push_token (a wiped/uninstalled phone stops being re-woken).
   */
  async sendPresenceWake(pushTokens: string[]): Promise<string[]> {
    return this.sendDataWake(pushTokens, { type: 'presence_wake' }, 'sendPresenceWake');
  }

  private async sendDataWake(
    pushTokens: string[],
    data: Record<string, string>,
    label: string,
  ): Promise<string[]> {
    const dead: string[] = [];
    if (!pushTokens.length) return dead;

    const sa = this.loadServiceAccount();
    if (!sa) return dead;
    const accessToken = await this.getAccessToken(sa);
    if (!accessToken) return dead;

    const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    const sendOne = async (token: string): Promise<void> => {
      try {
        const res = await FleetPushService.fetchWithTimeout(url, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ message: { token, data, android: { priority: 'high' } } }),
        });
        if (res.ok) return;
        // 404 = the token is no longer registered (UNREGISTERED / NOT_FOUND) — always
        // safe to prune.
        if (res.status === 404) {
          dead.push(token);
          return;
        }
        const bodyText = await res.text().catch(() => '');
        // 400 is ambiguous: FCM returns INVALID_ARGUMENT for a bad TOKEN *and* for a
        // malformed message. Only prune when the error specifically implicates the token
        // (a field violation on `message.token`, an unregistered/legacy token, or a
        // sender-id mismatch) — NEVER on a bare INVALID_ARGUMENT, or a future
        // payload-shape bug would 400 for every token and wipe the whole fleet's
        // push_token, disabling the dead-man until every phone re-checks-in.
        if (
          res.status === 400 &&
          /message\.token|registration-token-not-registered|SENDER_ID_MISMATCH|UNREGISTERED/i.test(
            bodyText,
          )
        ) {
          dead.push(token);
          return;
        }
        this.winston.warn('FCM v1 send failed', {
          context: 'FleetPushService',
          label,
          status: res.status,
          body: bodyText.slice(0, 200),
        });
      } catch (err) {
        this.winston.warn('FCM v1 send error', {
          context: 'FleetPushService',
          label,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    };

    // Bounded concurrency so a big fleet doesn't open hundreds of sockets at once.
    for (let i = 0; i < pushTokens.length; i += FleetPushService.SEND_CONCURRENCY) {
      await Promise.all(pushTokens.slice(i, i + FleetPushService.SEND_CONCURRENCY).map(sendOne));
    }
    return dead;
  }
}
