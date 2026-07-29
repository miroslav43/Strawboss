import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CONNECTION } from '../config/redis.config';

/** Monotonic counter bumped on every feature-flag write. One key, cluster-wide. */
const GENERATION_KEY = 'sb:flags:gen';

/** How often a replica re-reads the counter. Bounds cross-replica divergence. */
const POLL_MS = 2_000;

/**
 * Cross-replica invalidation for cached feature flags.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Flags ride along in `AuthGuard`'s per-replica user-context cache (60s TTL),
 * which costs zero extra queries. But production runs two backend replicas
 * behind an nginx round-robin, and their caches expire at independent moments.
 * With TTL alone, the ~55s after a toggle would return on/off/on to consecutive
 * requests from the same browser — the operator concludes the switch is broken
 * and flips it again. That is qualitatively worse than a simple delay.
 *
 * The 60s TTL was justified for `is_active` because a JWT expires hourly
 * anyway, bounding the damage. A kill-switch has no such outer bound, so the
 * number does not transfer.
 *
 * ── WHY A GENERATION COUNTER, NOT PUB/SUB ─────────────────────────────────
 *
 * `RedisModule` builds its client with `maxRetriesPerRequest: 1` and swallows
 * every error, and creates no second connection. A subscriber that silently
 * dropped its reconnect would miss every message published while it was down —
 * permanently, and undetectably. A counter is polled, so a replica that misses
 * a window self-heals on its next read.
 *
 * ── NEVER BLOCKS A REQUEST ────────────────────────────────────────────────
 *
 * `currentGeneration()` is synchronous: it returns the last known value and
 * kicks off a background refresh when the poll window has elapsed. Awaiting
 * Redis on the request path would put its 1500ms `commandTimeout` in front of
 * one request every two seconds.
 *
 * Fail-open throughout: if Redis is unreachable the last known generation
 * stands and the system degrades to exactly the pure-TTL behaviour it had
 * before — never to "everything disabled". Same posture as PinThrottleService.
 */
@Injectable()
export class FeaturesCacheService {
  private generation = 0;
  private checkedAt = 0;
  private refreshing = false;

  constructor(@Inject(REDIS_CONNECTION) private readonly redis: Redis) {}

  /**
   * Last known generation. Callers store it alongside a cached value and treat
   * a change as invalidation.
   */
  currentGeneration(): number {
    const now = Date.now();
    if (!this.refreshing && now - this.checkedAt >= POLL_MS) {
      // Claim the window before awaiting so a burst of concurrent requests
      // issues one Redis round-trip, not one per request.
      this.checkedAt = now;
      this.refreshing = true;
      void this.refresh();
    }
    return this.generation;
  }

  private async refresh(): Promise<void> {
    try {
      const raw = await this.redis.get(GENERATION_KEY);
      const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) this.generation = parsed;
    } catch {
      // Keep the last known value: degrade to pure TTL, never to fail-closed.
      // `checkedAt` was already advanced, so a down Redis is not hammered.
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Call after committing a flag write. Invalidates this replica immediately
   * and every other replica within POLL_MS.
   */
  async bump(): Promise<void> {
    try {
      await this.redis.incr(GENERATION_KEY);
    } catch {
      // The 60s TTL still bounds staleness; the write itself already committed.
    }
    // Force this replica to re-read on the very next call rather than waiting
    // out the poll window, so the operator who just saved sees it applied.
    this.checkedAt = 0;
  }
}
