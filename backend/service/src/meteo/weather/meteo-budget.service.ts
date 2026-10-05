import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { REDIS_CONNECTION } from '../../config/redis.config';
import { MeteoClient, type MeteoLane } from '../meteo-client';

/**
 * Daily quota guard for the PUBLIC Open-Meteo API (~10k weighted calls/day).
 * Background work stops early (6000) so interactive requests always have head
 * room (8500); the remaining ~1500 are the safety margin. Self-hosted: only
 * counted, never refused. Redis down: bounded in-process counter (this replica
 * only — fail-open but still capped, so it can never run away).
 */
export const BUDGET_CAP_BACKGROUND = 6_000;
export const BUDGET_CAP_INTERACTIVE = 8_500;
const COUNTER_TTL_S = 48 * 3600;
const COOLDOWN_KEY = 'sb:meteo:cooldown';
const COOLDOWN_S = 900;
const WARN_EVERY_MS = 3_600_000;

const dayKey = (): string => `sb:meteo:budget:${new Date().toISOString().slice(0, 10)}`;

@Injectable()
export class MeteoBudgetService {
  private local = { day: '', total: 0 };
  private localCooldownUntil = 0;
  private lastWarnMs = 0;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    private readonly client: MeteoClient,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  /** True while a 429 cooldown is active (fetchers must serve stale / nothing). */
  async inCooldown(): Promise<boolean> {
    if (!this.client.publicApi) return false;
    if (Date.now() < this.localCooldownUntil) return true;
    try {
      return (await this.redis.exists(COOLDOWN_KEY)) === 1;
    } catch {
      return false;
    }
  }

  /** Upstream answered 429: stop calling for 15 minutes, cluster-wide. */
  async noteRateLimited(): Promise<void> {
    this.localCooldownUntil = Date.now() + COOLDOWN_S * 1000;
    this.warnOnce('Open-Meteo answered 429 — 15 min cooldown, serving stale/none');
    try {
      await this.redis.set(COOLDOWN_KEY, '1', 'EX', COOLDOWN_S);
    } catch {
      // local cooldown above still applies
    }
  }

  /** Reserve `weight` units; false = refuse the upstream call. */
  async tryConsume(weight: number, lane: MeteoLane): Promise<boolean> {
    const enforce = this.client.publicApi;
    if (enforce && (await this.inCooldown())) return false;
    const cap = lane === 'interactive' ? BUDGET_CAP_INTERACTIVE : BUDGET_CAP_BACKGROUND;
    const total = await this.incr(weight);
    if (enforce && total > cap) {
      await this.incr(-weight).catch(() => undefined);
      this.warnOnce(`Meteo daily budget cap reached (${lane} cap ${cap}) — refusing upstream calls`);
      return false;
    }
    return true;
  }

  private async incr(delta: number): Promise<number> {
    const key = dayKey();
    try {
      const v = Number(await this.redis.incrbyfloat(key, delta));
      if (delta > 0) await this.redis.expire(key, COUNTER_TTL_S);
      if (Number.isFinite(v)) return v;
    } catch {
      // fall through to the in-process counter
    }
    const day = key;
    if (this.local.day !== day) this.local = { day, total: 0 };
    this.local.total += delta;
    return this.local.total;
  }

  private warnOnce(msg: string): void {
    const now = Date.now();
    if (now - this.lastWarnMs < WARN_EVERY_MS) return;
    this.lastWarnMs = now;
    this.winston.warn(msg, { context: 'MeteoBudgetService' });
  }
}
