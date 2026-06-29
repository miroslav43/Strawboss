/**
 * Device uptime report — how much of a window a fleet device was online vs offline.
 *
 * "Online" is derived from `user_sessions` (connected-session intervals for the
 * device's currently-bound operator, `devices.last_user_id`): the session-roll on
 * each heartbeat/location-report extends the current session while the device keeps
 * reporting, and opens a new one after a >2 min gap — so the sessions ARE the
 * online intervals and the gaps between them are offline.
 */
export interface DeviceUptimeInterval {
  /** ISO 8601 — start of an online interval, clipped to the window. */
  start: string;
  /** ISO 8601 — end of an online interval, clipped to now / the window. */
  end: string;
}

export interface DeviceUptimeResponse {
  deviceId: string;
  /** Window length in days. */
  days: number;
  /** ISO 8601 window bounds. */
  from: string;
  to: string;
  /** False when the device has no bound operator → no session history to chart. */
  hasOperator: boolean;
  onlineSeconds: number;
  offlineSeconds: number;
  /** 0–100, rounded to 1 decimal. */
  onlinePct: number;
  /** Online intervals (merged, sorted, clipped to [from, to]). */
  intervals: DeviceUptimeInterval[];
}
