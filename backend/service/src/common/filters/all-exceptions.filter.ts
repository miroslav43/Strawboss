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
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from '@strawboss/types';
import { tServer } from '../i18n';

/**
 * The locale to translate an error's `message` into.
 *
 * This is the ONE place in the backend that can resolve it for an HTTP
 * exception: `ArgumentsHost` gives access to the request, so
 * `request.user?.locale` is available whenever AuthGuard already ran and
 * attached `RequestUser` (Task 6.1). ZodValidationPipe, by contrast, is
 * constructed with a bare `new` at route-registration time and never sees a
 * request at all — see that file's header comment.
 *
 * Two cases have NO `RequestUser`, deliberately handled the same way:
 *   - a genuinely unauthenticated route (public request portal, a 404, a
 *     malformed/missing Authorization header);
 *   - AuthGuard's own rejections (`errors.accountNotFound` /
 *     `errors.accountInactive` in auth.guard.ts) — the JWT was presented but
 *     rejected BEFORE `request.user` is assigned, even though the guard did,
 *     in the "inactive" case, load the account row (and therefore knows its
 *     stored locale). Deliberately not threaded through as a one-off
 *     override — this filter is the single, consistent fallback point for
 *     every locale-less request.
 *
 * Fallback chosen: an `Accept-Language` header read (best-effort — neither
 * mobile nor admin-web sets one deliberately today, so in practice this
 * mostly lands on the next step), then `DEFAULT_LOCALE` ('ro' — see
 * packages/types/src/locale.ts: still the overwhelming majority of accounts).
 * `normalizeLocale` already treats a missing/unparseable value as
 * `DEFAULT_LOCALE`, so this never throws.
 */
function resolveLocale(request: {
  user?: { locale?: string };
  headers?: Record<string, unknown>;
}): Locale {
  if (request.user?.locale) return normalizeLocale(request.user.locale);
  const acceptLanguage = request.headers?.['accept-language'];
  if (typeof acceptLanguage === 'string' && acceptLanguage.length > 0) {
    return normalizeLocale(acceptLanguage.split(',')[0]);
  }
  return DEFAULT_LOCALE;
}

@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') {
      throw exception instanceof Error
        ? exception
        : new Error(typeof exception === 'string' ? exception : JSON.stringify(exception));
    }

    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<{
      url?: string;
      requestId?: string;
      headers?: Record<string, unknown>;
      user?: { locale?: string };
    }>();
    const locale = resolveLocale(request);

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';
    /** Validation detail (Zod fieldErrors/formErrors), when the failure has any. */
    let details: Record<string, unknown> | undefined;
    /*
     * Stable, machine-readable discriminator (e.g. 'FEATURE_DISABLED'), plus the
     * feature key when the failure is a feature gate.
     *
     * These MUST be hoisted explicitly. The reply below is assembled from a
     * fixed set of fields, so any extra key on the thrown HttpException's
     * response object is silently dropped — a client branching on
     * `code === 'FEATURE_DISABLED'` would be dead code, and the operator would
     * see the generic 'Cerere invalidă.' fallback on a perfectly valid action.
     * Same class of bug as the message-array handling documented below.
     */
    let code: string | undefined;
    let feature: string | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        /*
         * `resp.message` may legitimately be an ARRAY (Nest's own built-in
         * ValidationPipe emits string[]), and it may be MISSING entirely — Zod's
         * `flatten()` has no `message` key at all. The old code did
         * `message = resp.message ?? message`, so a missing message silently kept
         * the initial 'Internal server error' above: every validation failure went
         * out as a 400 claiming the server had crashed, while the actual reason
         * (fieldErrors) was never logged and never sent. That is why an operator
         * saw "Internal server error" for what was really a bad field.
         *
         * Never let a 4xx inherit the 500 fallback text.
         *
         * `resp.i18nKey` (Task 6.4) is checked FIRST and wins: it is how a
         * throw site with no request context of its own (ZodValidationPipe) or
         * no populated `request.user` yet (AuthGuard's own rejections) asks
         * THIS filter — the one place that has both the request and the
         * catalog — to render its message in the caller's locale, instead of
         * baking one language into `message` at the throw site. The literal
         * `resp.message` a locale-unaware throw already set (e.g. Zod's own
         * English text, never used as `message` any more — see
         * zod-validation.pipe.ts) is superseded, not read, when a key is
         * present.
         */
        if (typeof resp.i18nKey === 'string') {
          message = tServer(
            locale,
            resp.i18nKey,
            resp.i18nParams as Record<string, string | number> | undefined,
          );
        } else if (Array.isArray(resp.message)) {
          message = (resp.message as unknown[]).join('; ');
        } else if (typeof resp.message === 'string' && resp.message.length > 0) {
          message = resp.message;
        } else if (statusCode < 500) {
          message = tServer(locale, 'errors.invalidRequest');
        }
        error = (resp.error as string) ?? (statusCode < 500 ? 'Bad Request' : error);

        if (resp.fieldErrors || resp.formErrors) {
          details = {
            fieldErrors: resp.fieldErrors,
            formErrors: resp.formErrors,
          };
        }

        if (typeof resp.code === 'string') code = resp.code;
        if (typeof resp.feature === 'string') feature = resp.feature;
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
        ...(details ? { details } : {}),
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    } else {
      // `details` is what makes a rejected request diagnosable after the fact.
      // Without it a 400 logged only "Internal server error" and we could not tell
      // WHICH field a phone had got wrong — the exact hole that left a loader
      // operator staring at a server-crash dialog with nobody able to explain it.
      this.winston.warn(message, {
        context: 'AllExceptionsFilter',
        statusCode,
        error,
        path,
        requestId,
        ...(details ? { details } : {}),
        // Makes "which org hit which disabled feature, how often" greppable in
        // logs/web/warn/ without adding a bespoke log line at every gate.
        ...(code ? { code } : {}),
        ...(feature ? { feature } : {}),
      });
    }

    void reply.status(statusCode).send({
      statusCode,
      message,
      error,
      // Sent to the client too: the phone can show "baleCount: Expected number,
      // received string" instead of a meaningless scare.
      ...(details ? details : {}),
      ...(code ? { code } : {}),
      ...(feature ? { feature } : {}),
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
    });
  }
}
