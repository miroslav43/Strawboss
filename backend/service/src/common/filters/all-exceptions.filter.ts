import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
  Inject,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';

@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') {
      throw exception instanceof Error
        ? exception
        : new Error(
            typeof exception === 'string' ? exception : JSON.stringify(exception),
          );
    }

    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<{
      url?: string;
      requestId?: string;
      headers?: Record<string, unknown>;
    }>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string) ?? message;
        error = (resp.error as string) ?? error;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const requestId =
      request.requestId ??
      (typeof request.headers?.['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : undefined);
    const path = request.url ?? '';

    if (statusCode >= 500) {
      this.winston.error(message, {
        context: 'AllExceptionsFilter',
        statusCode,
        error,
        path,
        requestId,
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    } else {
      this.winston.warn(message, {
        context: 'AllExceptionsFilter',
        statusCode,
        error,
        path,
        requestId,
      });
    }

    void reply.status(statusCode).send({
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
    });
  }
}
