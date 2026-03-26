import { z } from "zod";

/**
 * ISO 8601 date-time string schema.
 * Accepts strings like "2024-01-15T10:30:00Z" or "2024-01-15T10:30:00+02:00".
 */
export const isoDateSchema = z
  .string()
  .refine(
    (val) => !isNaN(Date.parse(val)),
    { message: "Invalid ISO 8601 date-time string" },
  );
