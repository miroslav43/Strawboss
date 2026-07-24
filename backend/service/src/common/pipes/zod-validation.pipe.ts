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
 *   - `message`: a human-readable summary ("baleCount: Expected number, received
 *      string"), so the phone shows something true and actionable;
 *   - `error: 'validation_failed'`: a stable code for clients to branch on;
 *   - `fieldErrors` / `formErrors`: the full detail, which the filter logs.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const flat = result.error.flatten();

      // "field: reason" per bad field, plus any whole-object refine failures
      // (e.g. "exactly one of parcelId or sourceDepotId is required"), which live
      // in formErrors and would otherwise be invisible.
      const parts = [
        ...Object.entries(flat.fieldErrors).map(
          ([field, errs]) => `${field}: ${(errs ?? []).join(', ')}`,
        ),
        ...flat.formErrors,
      ];

      throw new BadRequestException({
        statusCode: 400,
        error: 'validation_failed',
        message: parts.length ? parts.join('; ') : 'Date invalide.',
        fieldErrors: flat.fieldErrors,
        formErrors: flat.formErrors,
      });
    }
    return result.data;
  }
}
