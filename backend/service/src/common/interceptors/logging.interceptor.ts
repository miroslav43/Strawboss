import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  Inject,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Observable, throwError, catchError, tap } from 'rxjs';

/**
 * Assigns X-Request-Id, logs one line per HTTP request at level `http`
 * (routed to logs/web/http/ by Winston).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<{
      method: string;
      url: string;
      ip?: string;
      headers?: Record<string, unknown>;
      user?: { id: string; role?: string };
      requestId?: string;
    }>();
    const reply = ctx.getResponse<{ statusCode?: number; header: (k: string, v: string) => void }>();

    const method = request.method;
    const url = request.url;
    const start = Date.now();

    const incomingId = request.headers?.['x-request-id'];
    const requestId =
      typeof incomingId === 'string' && incomingId.trim()
        ? incomingId.trim()
        : randomUUID();
    request.requestId = requestId;
    reply.header('X-Request-Id', requestId);

    const userId = request.user?.id ?? null;
    const ip =
      request.ip ??
      (typeof request.headers?.['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for'].split(',')[0]?.trim()
        : null);

    return next.handle().pipe(
      tap(() => {
        const durationMs = Date.now() - start;
        const statusCode = reply.statusCode ?? 200;
        this.winston.log('http', `${method} ${url} ${statusCode} ${durationMs}ms`, {
          context: 'HTTP',
          requestId,
          method,
          path: url,
          statusCode,
          durationMs,
          userId,
          ip,
        });
      }),
      catchError((err: unknown) => {
        const durationMs = Date.now() - start;
        const statusCode =
          err instanceof HttpException ? err.getStatus() : 500;
        const message =
          err instanceof Error ? err.message : String(err);

        this.winston.log('http', `${method} ${url} ${statusCode} ${durationMs}ms (error)`, {
          context: 'HTTP',
          requestId,
          method,
          path: url,
          statusCode,
          durationMs,
          userId,
          ip,
          error: true,
        });

        if (statusCode >= 500) {
          this.winston.error(message, {
            context: 'HTTP',
            requestId,
            stack: err instanceof Error ? err.stack : undefined,
          });
        }

        return throwError(() => err);
      }),
    );
  }
}
