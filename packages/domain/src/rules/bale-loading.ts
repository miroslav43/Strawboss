/**
 * System-wide default cap on bales a truck can carry per trip when the
 * per-truck override `machines.max_bale_count` is NULL. Admins can still
 * configure a smaller capacity per truck (e.g. a small flatbed) from the
 * admin dashboard; the backend always honours the per-truck value when set.
 */
export const DEFAULT_MAX_BALES_PER_TRUCK = 33;

/**
 * Structured error codes returned by `POST /api/v1/trips/register-load` so
 * the mobile loader screen can surface tailored Romanian messages without
 * string-matching the human-readable `message` field.
 */
export type RegisterLoadErrorCode =
  | 'bale_count_exceeds_remaining'
  | 'bale_count_exceeds_truck_capacity'
  | 'parcel_fully_loaded';
