import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';

/**
 * Validate a request body against a Zod schema.
 *
 * This used to throw `new BadRequestException(result.error.flatten())`. Zod's
 * `flatten()` returns `{ formErrors, fieldErrors }` — and crucially it has NO
 * `message` key. AllExceptionsFilter reads `resp.message ?? 'Internal server
 * error'`, found nothing, and fell through to the fallback.
 *
 * So EVERY validation failure in the whole app reached the user as
 * "Internal server error" — a 400 wearing a 500's clothes. A loader operator saw
 * a scary server-crash dialog when in truth one field of his request was wrong,
 * and the one thing that said WHICH field (`fieldErrors`) was logged nowhere and
 * sent nowhere. We were blind to our own validation failures.
 *
 * Now the exception carries:
 *   - `message`: a Romanian safety-net summary, never Zod's own (English) text
 *      — see the i18n note below for why;
 *   - `error: 'validation_failed'`: a stable code for clients to branch on
 *      (unchanged — do not rename, it is a machine-readable contract);
 *   - `fieldErrors` / `formErrors`: the full per-field detail, in Zod's own
 *      words. This is what makes the failure diagnosable — it survives in the
 *      log (AllExceptionsFilter) AND in the response body sent to the client
 *      (same filter), even though it never enters the human `message` string.
 *
 * i18n (Task 6.4): this pipe is instantiated with a bare `new
 * ZodValidationPipe(schema)` inline in a controller's `@Body()`/`@Query()`
 * decorator at EVERY call site (see zod-validation.pipe usages across every
 * *.controller.ts file) — that bypasses Nest's DI container entirely, so
 * `@Inject(REQUEST)` here would silently never resolve. The pipe therefore
 * has no reliable way to know the caller's locale, and previously "solved"
 * that by leaking Zod's own English messages straight into `message` — a bad
 * field on a Romanian phone read as `baleCount: Expected number, received
 * string`. Instead of guessing, this pipe stays locale-agnostic: it throws a
 * stable `i18nKey` ('errors.invalidData') and AllExceptionsFilter — which DOES
 * have the request, and therefore `request.user?.locale` — resolves the
 * actual text at the one place that can. `message` below is only the
 * Romanian safety net for the case the filter doesn't apply the key for some
 * reason; it is never shown mixed with Zod's raw detail.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const flat = result.error.flatten();

      throw new BadRequestException({
        statusCode: 400,
        error: 'validation_failed',
        i18nKey: 'errors.invalidData',
        message: 'Date invalide.',
        fieldErrors: flat.fieldErrors,
        formErrors: flat.formErrors,
      });
    }
    return result.data;
  }
}
