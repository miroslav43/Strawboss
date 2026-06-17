import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { isUploadUrl, signUploadUrl } from '../../uploads/uploads-signing';

/**
 * Recursively rewrites every `/api/v1/uploads/...` string in an outgoing
 * response body into a short-lived signed URL. The unauthenticated static file
 * route (registered on raw Fastify, outside Nest's AuthGuard) then verifies that
 * signature — closing the unauthenticated-file-access hole while keeping plain
 * `<img src>` working. Egress-only: stored DB values are never mutated.
 */
@Injectable()
export class UploadUrlSigningInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService) {}

  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const secret = this.config.getOrThrow<string>('SUPABASE_JWT_SECRET');
    const nowMs = Date.now();
    return next.handle().pipe(map((body) => signDeep(body, secret, nowMs, new WeakSet())));
  }
}

function signDeep(value: unknown, secret: string, nowMs: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return isUploadUrl(value) ? signUploadUrl(value, secret, nowMs) : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => signDeep(v, secret, nowMs, seen));
  }
  if (value && typeof value === 'object') {
    // Leave non-plain objects (Buffers, Dates, streams) untouched.
    if (Buffer.isBuffer(value) || value instanceof Date) return value;
    if (seen.has(value)) return value;
    seen.add(value);
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      obj[key] = signDeep(obj[key], secret, nowMs, seen);
    }
    return value;
  }
  return value;
}
