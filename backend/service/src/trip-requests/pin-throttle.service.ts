import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { REDIS_CONNECTION } from '../config/redis.config';

/**
 * Redis-backed brute-force protection for the public beneficiary PIN portal.
 *
 * Two layers:
 *  - per-beneficiary lockout: after `maxFailures` wrong PINs within `failWindowSec`,
 *    the beneficiary is locked for `lockoutSec` (every verify/submit returns 429).
 *  - per-IP request cap: at most `ipLimit` portal requests per IP per `ipWindowSec`.
 *
 * All operations fail OPEN: if Redis is unavailable the portal keeps working
 * (availability over strict limiting for this low-value endpoint).
 */
@Injectable()
export class PinThrottleService {
  private readonly failWindowSec = 900; // count failures over 15 min
  private readonly maxFailures = 8; // lock after 8 wrong PINs
  private readonly lockoutSec = 900; // 15 min lockout
  private readonly ipWindowSec = 300; // per-IP rolling window
  private readonly ipLimit = 60; // max portal requests / IP / window

  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  private lockKey(o: string, b: string): string {
    return `pin:lock:${o}:${b}`;
  }
  private failKey(o: string, b: string): string {
    return `pin:fail:${o}:${b}`;
  }
  private ipKey(ip: string): string {
    return `pin:ip:${ip}`;
  }

  /** Throws 429 if the beneficiary is locked out or the IP is over its request cap. */
  async assertAllowed(orgSlug: string, beneficiarySlug: string, ip: string): Promise<void> {
    try {
      if (await this.redis.exists(this.lockKey(orgSlug, beneficiarySlug))) {
        throw this.tooMany();
      }
      const n = await this.redis.incr(this.ipKey(ip));
      if (n === 1) await this.redis.expire(this.ipKey(ip), this.ipWindowSec);
      if (n > this.ipLimit) throw this.tooMany();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.failOpen('assertAllowed', e);
    }
  }

  /** Records a wrong-PIN attempt; locks the beneficiary at the failure threshold. */
  async recordFailure(orgSlug: string, beneficiarySlug: string): Promise<void> {
    try {
      const key = this.failKey(orgSlug, beneficiarySlug);
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, this.failWindowSec);
      if (n >= this.maxFailures) {
        await this.redis.set(this.lockKey(orgSlug, beneficiarySlug), '1', 'EX', this.lockoutSec);
        await this.redis.del(key);
        this.winston.warn(`Beneficiary PIN locked after ${n} failed attempts`, {
          context: 'PinThrottleService',
          orgSlug,
          beneficiarySlug,
          lockoutSec: this.lockoutSec,
        });
      }
    } catch (e) {
      this.failOpen('recordFailure', e);
    }
  }

  /** Clears the failure counter after a correct PIN. */
  async recordSuccess(orgSlug: string, beneficiarySlug: string): Promise<void> {
    try {
      await this.redis.del(this.failKey(orgSlug, beneficiarySlug));
    } catch (e) {
      this.failOpen('recordSuccess', e);
    }
  }

  private tooMany(): HttpException {
    return new HttpException(
      'Prea multe încercări. Încearcă din nou mai târziu.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private failOpen(op: string, e: unknown): void {
    this.winston.warn(`PinThrottleService.${op}: Redis unavailable, failing open`, {
      context: 'PinThrottleService',
      err: e instanceof Error ? { message: e.message } : e,
    });
  }
}
