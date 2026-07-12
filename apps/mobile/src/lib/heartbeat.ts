import { mobileApiClient } from './api-client';
import { markHeartbeatSuccess, readHealthTimestamps } from './health-state';
import { getDeviceUuid } from './device-checkin';

/**
 * Plan C — mobile presence heartbeat.
 *
 * Pings `POST /api/v1/profile/heartbeat` roughly every 60 s so the backend
 * keeps `users.last_seen_at` fresh and the admin tasks board can render a
 * green dot next to operators currently using the app.
 *
 * The tick is stopped when the app backgrounds (battery savings) and
 * restarted on foreground from `_layout.tsx`.
 */
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Fire a single presence heartbeat. Exposed so the native-alarm-driven headless
 * checkin task ({@link ../lib/presence-checkin-task}) can keep `last_seen_at`
 * fresh with the screen off, on OEM ROMs that pause the JS `setInterval` timer
 * when the app is backgrounded. Throws on failure so callers can decide.
 *
 * Both drivers (the JS interval and the native alarm) call this same function,
 * so it dedups itself against the last *successful* send — a failure does not
 * stamp, so every driver keeps retrying until one of them gets through.
 */
export async function sendHeartbeatOnce(): Promise<void> {
  const { lastHeartbeatAt } = await readHealthTimestamps();
  if (lastHeartbeatAt != null && Date.now() - new Date(lastHeartbeatAt).getTime() < 55_000) {
    // Another driver (JS interval or native alarm) already sent one recently —
    // skip this call so a 30 s JS tick and a 60 s native alarm don't double up.
    return;
  }
  // Send our deviceUuid so the (authenticated) backend can bind this device to the
  // verified operator — the secure source for "who's logged into this phone".
  const deviceUuid = await getDeviceUuid();
  await mobileApiClient.post('/api/v1/profile/heartbeat', deviceUuid ? { deviceUuid } : {});
  void markHeartbeatSuccess();
}

async function ping() {
  try {
    await sendHeartbeatOnce();
  } catch {
    // Network/auth errors are non-fatal — the next tick or the user's
    // re-login will eventually update last_seen_at. Suppress to avoid
    // log spam every ~60 s when offline.
  }
}

export function startHeartbeat(): void {
  stopHeartbeat();
  void ping();
  // Jittered ~60-65 s tick: the 55 s dedup gate in sendHeartbeatOnce() means
  // this only needs to be "roughly" 60 s, and the jitter keeps ~30 phones on
  // the same shift from all ticking in the same second. Mirrors
  // HEARTBEAT_INTERVAL_MS in @strawboss/types (presence SSOT) — keep in sync.
  timer = setInterval(
    () => {
      void ping();
    },
    60_000 + Math.floor(Math.random() * 5_000),
  );
}

export function stopHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
