import { z } from 'zod';
import { SEASON_MAX_YEAR, SEASON_MIN_YEAR } from '@strawboss/types';

/**
 * Season validation.
 *
 * A season is a strict calendar year in Europe/Bucharest; see
 * `packages/types/src/season.ts` for why it is derived from each row's business
 * date rather than stamped onto it.
 *
 * The bounds mirror the CHECK constraints in migration 00098. They are not
 * cosmetic: `season` arrives as a query string, and an unbounded coerced number
 * turns a typo into a full-table scan for the year 12026 on tables that are
 * indexed on `(organization_id, <date>)`.
 */
export const seasonYearSchema = z.coerce.number().int().min(SEASON_MIN_YEAR).max(SEASON_MAX_YEAR);

/**
 * The optional `?season=YYYY` every read endpoint accepts.
 *
 * Optional on purpose, and the omission is meaningful rather than lazy: an
 * absent season resolves server-side through
 * `resolveSeasonYear(undefined, org.activeSeasonYear)`, so an old mobile build
 * or a bookmarked URL that knows nothing about seasons keeps working and simply
 * gets the organization's active season.
 */
export const seasonQuerySchema = z.object({
  season: seasonYearSchema.optional(),
});

export type SeasonQuery = z.infer<typeof seasonQuerySchema>;

/**
 * Closing a season.
 *
 * `reason` is mandatory for the same reason it is on feature toggles:
 * `organizations` is not covered by the audit trigger (00023) and the audit
 * interceptor is never bound, so the `closing_note` we persist on
 * `organization_seasons` is the only record of who froze a year's numbers and
 * why.
 */
export const closeSeasonSchema = z.object({
  year: seasonYearSchema,
  reason: z.string().trim().min(3).max(500),
});

export type CloseSeasonInput = z.infer<typeof closeSeasonSchema>;
