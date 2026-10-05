import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { REDIS_CONNECTION } from '../../config/redis.config';
import type { MeteoLane } from '../meteo-client';

export const WX_KEY_PREFIX = 'sb:meteo:wx:v1';
const LOCK_MS = 20_000;
const FAIL_MS = 120_000;
const POLL_TRIES = 5;
const POLL_MS = 500;
const LRU_MAX = 300;
/** After a Redis error skip Redis for this long (each call would otherwise wait out commandTimeout). */
const REDIS_BACKOFF_MS = 15_000;

const UNLOCK_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

interface Entry<T> {
  fetchedAtMs: number;
  v: T;
}

export interface CacheResult<T> {
  value: T | null;
  fetchedAtMs: number | null;
  stale: boolean;
}

export interface CacheOpts<T> {
  freshMs: number;
  staleMaxMs: number;
  lane: MeteoLane;
  /** Must return null on failure (never throw). */
  fetch: () => Promise<T | null>;
}

/**
 * Redis-first stale-while-revalidate cache for interactive weather. Every key
 * has a TTL (Redis has no maxmemory and is shared with BullMQ). Redis errors
 * fall back to a small in-process LRU with the same TTLs — fail-open, like
 * FeaturesCacheService / PinThrottleService.
 */
@Injectable()
export class MeteoWeatherCacheService {
  private readonly lru = new Map<string, { expiresAt: number; raw: string }>();
  private readonly localLocks = new Map<string, number>();
  private redisDownUntil = 0;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  // ── primitives (also used by the farm batch fetcher) ──────────────────────

  private redisUp(): boolean {
    return Date.now() >= this.redisDownUntil;
  }
  private redisFailed(err: unknown): void {
    if (this.redisUp()) {
      this.winston.warn('Meteo cache: Redis unavailable, using in-process fallback', {
        context: 'MeteoWeatherCacheService',
        err: err instanceof Error ? err.message : String(err),
      });
    }
    this.redisDownUntil = Date.now() + REDIS_BACKOFF_MS;
  }

  private lruGet(key: string): string | null {
    const e = this.lru.get(key);
    if (!e) return null;
    if (e.expiresAt <= Date.now()) {
      this.lru.delete(key);
      return null;
    }
    this.lru.delete(key); // refresh recency
    this.lru.set(key, e);
    return e.raw;
  }
  private lruSet(key: string, raw: string, ttlMs: number): void {
    this.lru.delete(key);
    this.lru.set(key, { expiresAt: Date.now() + ttlMs, raw });
    while (this.lru.size > LRU_MAX) {
      const oldest = this.lru.keys().next().value;
      if (oldest === undefined) break;
      this.lru.delete(oldest);
    }
  }

  async read<T>(key: string): Promise<Entry<T> | null> {
    let raw: string | null = null;
    if (this.redisUp()) {
      try {
        raw = await this.redis.get(key);
      } catch (err) {
        this.redisFailed(err);
      }
    }
    if (raw === null) raw = this.lruGet(key);
    if (raw === null) return null;
    try {
      const e = JSON.parse(raw) as Entry<T>;
      return typeof e?.fetchedAtMs === 'number' ? e : null;
    } catch {
      return null;
    }
  }

  async write<T>(key: string, v: T, ttlMs: number, fetchedAtMs = Date.now()): Promise<void> {
    const raw = JSON.stringify({ fetchedAtMs, v } satisfies Entry<T>);
    this.lruSet(key, raw, ttlMs);
    if (!this.redisUp()) return;
    try {
      await this.redis.set(key, raw, 'PX', ttlMs);
    } catch (err) {
      this.redisFailed(err);
    }
  }

  /** Short-lived exclusive lock; returns a token to release with, or null when held elsewhere. */
  async tryLock(key: string, ms = LOCK_MS): Promise<string | null> {
    const lockKey = `${key}:lock`;
    const token = randomUUID();
    if (this.redisUp()) {
      try {
        const ok = await this.redis.set(lockKey, token, 'PX', ms, 'NX');
        return ok === 'OK' ? token : null;
      } catch (err) {
        this.redisFailed(err);
      }
    }
    const until = this.localLocks.get(lockKey) ?? 0;
    if (until > Date.now()) return null;
    this.localLocks.set(lockKey, Date.now() + ms);
    return token;
  }

  async unlock(key: string, token: string): Promise<void> {
    const lockKey = `${key}:lock`;
    this.localLocks.delete(lockKey);
    if (!this.redisUp()) return;
    try {
      await this.redis.eval(UNLOCK_LUA, 1, lockKey, token);
    } catch (err) {
      this.redisFailed(err);
    }
  }

  async isFailed(key: string): Promise<boolean> {
    const failKey = `${key}:fail`;
    if (this.redisUp()) {
      try {
        return (await this.redis.exists(failKey)) === 1;
      } catch (err) {
        this.redisFailed(err);
      }
    }
    return this.lruGet(failKey) !== null;
  }

  async markFailed(key: string): Promise<void> {
    const failKey = `${key}:fail`;
    this.lruSet(failKey, '1', FAIL_MS);
    if (!this.redisUp()) return;
    try {
      await this.redis.set(failKey, '1', 'PX', FAIL_MS);
    } catch (err) {
      this.redisFailed(err);
    }
  }

  // ── stale-while-revalidate ────────────────────────────────────────────────

  async getOrRefresh<T>(key: string, opts: CacheOpts<T>): Promise<CacheResult<T>> {
    const entry = await this.read<T>(key);
    const age = entry ? Date.now() - entry.fetchedAtMs : Infinity;
    if (entry && age < opts.freshMs) {
      return { value: entry.v, fetchedAtMs: entry.fetchedAtMs, stale: false };
    }
    if (entry && age < opts.staleMaxMs) {
      void this.refresh(key, opts).catch(() => undefined);
      return { value: entry.v, fetchedAtMs: entry.fetchedAtMs, stale: true };
    }

    if (await this.isFailed(key)) return { value: null, fetchedAtMs: null, stale: false };
    const r = await this.refresh(key, opts);
    if (r === 'failed') return { value: null, fetchedAtMs: null, stale: false };
    if (r !== 'locked') return { value: r.v, fetchedAtMs: r.fetchedAtMs, stale: false };

    // Another request holds the lock: wait briefly for its result.
    for (let i = 0; i < POLL_TRIES; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const e = await this.read<T>(key);
      if (e) return { value: e.v, fetchedAtMs: e.fetchedAtMs, stale: false };
    }
    return { value: null, fetchedAtMs: null, stale: false };
  }

  /** Fetch + store under the lock; 'locked' = someone else is fetching, 'failed' = negative-cached. */
  private async refresh<T>(key: string, opts: CacheOpts<T>): Promise<Entry<T> | 'locked' | 'failed'> {
    if (await this.isFailed(key)) return 'failed';
    const token = await this.tryLock(key);
    if (!token) return 'locked';
    try {
      const v = await opts.fetch();
      if (v === null) {
        await this.markFailed(key);
        return 'failed';
      }
      const fetchedAtMs = Date.now();
      await this.write(key, v, opts.staleMaxMs, fetchedAtMs);
      return { fetchedAtMs, v };
    } catch (err) {
      this.winston.warn('Meteo cache refresh failed', {
        context: 'MeteoWeatherCacheService',
        key,
        err: err instanceof Error ? err.message : String(err),
      });
      await this.markFailed(key);
      return 'failed';
    } finally {
      await this.unlock(key, token);
    }
  }
}
