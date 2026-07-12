/**
 * Fleet-presence cadence hierarchy — the SINGLE SOURCE OF TRUTH.
 *
 * Every "is this device/user online?" decision across admin-web, backend, and
 * mobile derives from these constants. They were drifting apart before (the web
 * device dot's window equalled the phone's own check-in gate → the dot flapped
 * grey while the phone was actually on), so they now live in one place that all
 * three apps depend on (`@strawboss/types`, `workspace:*`).
 *
 * THE INVARIANT (do not break — each `<` has a deliberate safety margin):
 *
 *   C_awake ( ~120s )  <  W_green ( 150s )  <  S ( 240s )  <  R_max ( ~360s )  <  W_idle ( 420s )  <  ∞
 *
 *   C_awake  worst-case cadence of an AWAKE healthy phone:
 *            DEVICE_CHECKIN_GATE_MS (90s) + a driver tick (55-60s) ≈ 120s.
 *   W_green  device shows "online" (green): DEVICE_ONLINE_WINDOW_MS.
 *            > C_awake so a healthy phone never flaps green→grey.
 *   S        backend dead-man starts FCM-reviving: PRESENCE_DEADMAN_STALE_MS.
 *            > W_green so the dot turns amber ("dozing") BEFORE the wake fires —
 *            UI and backend agree the phone has gone quiet.
 *   R_max    worst-case revive+report = S + PRESENCE_DEADMAN_RUN_MS + FCM/checkin
 *            slack ≈ 360s.
 *   W_idle   device shows amber up to here: DEVICE_IDLE_WINDOW_MS.
 *            > R_max so a phone the dead-man CAN revive never reaches red.
 *            Beyond it → red = the dead-man tried a full cycle and failed =
 *            genuinely down.
 *
 * Story the admin can trust: green = reporting on its own; amber = quiet but the
 * dead-man is actively keeping it alive; red = really down.
 */

// ── Mobile report cadence (informational here; the mobile app owns the live
//    values — see apps/mobile/src/lib/device-checkin.ts & heartbeat.ts, which
//    point back to this file). Kept here so the hierarchy reads in one place. ──

/** Min gap between successful `/fleet/checkin`s the device enforces (±10% jitter). */
export const DEVICE_CHECKIN_GATE_MS = 90_000;

/** Operator heartbeat interval (the mobile timer adds 0-5s jitter). */
export const HEARTBEAT_INTERVAL_MS = 60_000;

// ── Backend ──

/** Per-user, per-replica throttle on `users.last_seen_at` writes. */
export const USER_TOUCH_THROTTLE_MS = 45_000;

/** Dead-man staleness: FCM-wake a device-owner phone once this stale (S). */
export const PRESENCE_DEADMAN_STALE_MS = 240_000;

/** How often the dead-man scan runs. Tighter = more deterministic revival. */
export const PRESENCE_DEADMAN_RUN_MS = 90_000;

// ── Web dots (client-computed as `serverNow() - lastSeen < window`) ──

/** Device "online" (green) window (W_green). Must exceed C_awake (~120s). */
export const DEVICE_ONLINE_WINDOW_MS = 150_000;

/**
 * Device "dozing/idle" (amber) outer bound (W_idle). Between W_green and this →
 * amber; beyond → red. Must exceed R_max (~360s) so an FCM-revivable phone never
 * shows red.
 */
export const DEVICE_IDLE_WINDOW_MS = 420_000;

/** User (operator) "online" window — a ~60s heartbeat with a missed-tick grace. */
export const USER_ONLINE_WINDOW_MS = 180_000;

/** Machine GPS "online" window — GPS fixes arrive every few minutes. */
export const MACHINE_ONLINE_WINDOW_MS = 900_000;

// ── Web polling / re-render cadence ──

/** Fleet devices list/detail refetch interval. */
export const DEVICES_POLL_MS = 20_000;

/** Shared client re-render tick so a dot ages out between polls. */
export const PRESENCE_RETICK_MS = 30_000;
