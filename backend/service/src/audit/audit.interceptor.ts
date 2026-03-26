import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';

/** HTTP methods considered mutations. */
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Interceptor that automatically logs mutations (POST, PUT, PATCH, DELETE)
 * to the audit_logs table.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method: string = request.method;

    if (!MUTATION_METHODS.has(method)) {
      return next.handle();
    }

    const route: string = request.url ?? request.routerPath ?? '';
    const user = request.user as
      | { id: string; email: string; role: string }
      | undefined;
    const userId = user?.id ?? null;
    const ipAddress: string | null =
      (request.ip as string) ??
      (request.headers?.['x-forwarded-for'] as string) ??
      null;

    // Derive table name from the route (first path segment after /api or /)
    const segments = route.replace(/^\/api\//, '/').split('/').filter(Boolean);
    const tableName = segments[0] ?? 'unknown';

    return next.handle().pipe(
      tap((responseBody) => {
        // Fire and forget — do not block the response
        const newValues =
          responseBody && typeof responseBody === 'object'
            ? (responseBody as Record<string, unknown>)
            : null;

        const operation = this.methodToOperation(method);

        void this.auditService
          .log(tableName, '', operation, null, newValues, userId, null, ipAddress)
          .catch((err: unknown) => {
            console.error('AuditInterceptor failed to log:', err);
          });
      }),
    );
  }

  private methodToOperation(method: string): string {
    switch (method) {
      case 'POST':
        return 'insert';
      case 'PUT':
      case 'PATCH':
        return 'update';
      case 'DELETE':
        return 'delete';
      default:
        return 'unknown';
    }
  }
}
