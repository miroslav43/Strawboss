import { z } from "zod";

/**
 * ISO 8601 date-time string schema.
 * Accepts strings like "2024-01-15T10:30:00Z" or "2024-01-15T10:30:00+02:00".
 * Also accepts date-only format "2024-01-15" (used by production_date, assignment_date).
 */
export const isoDateSchema = z
  .string()
  .refine(
    (s) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/.test(s),
    { message: "Must be ISO 8601 date string" },
  );
