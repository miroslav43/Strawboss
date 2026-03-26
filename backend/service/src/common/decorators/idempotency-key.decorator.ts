import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the Idempotency-Key header from the incoming request.
 * Returns `undefined` when the header is not present.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return (
      request.headers?.['idempotency-key'] ??
      request.headers?.['Idempotency-Key']
    );
  },
);
