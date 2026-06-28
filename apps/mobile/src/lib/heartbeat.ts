import { mobileApiClient } from './api-client';
import { markHeartbeatSuccess } from './health-state';
import { getDeviceUuid } from './device-checkin';

/**
 * Plan C — mobile presence heartbeat.
 *
 * Pings `POST /api/v1/profile/heartbeat` every 30 s so the backend keeps
 * `users.last_seen_at` fresh and the admin tasks board can render a green
 * dot next to operators currently using the app.
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
 */
export async function sendHeartbeatOnce(): Promise<void> {
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
    // log spam every 30 s when offline.
  }
}

export function startHeartbeat(): void {
  stopHeartbeat();
  void ping();
  timer = setInterval(() => {
    void ping();
  }, 30_000);
}

export function stopHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
