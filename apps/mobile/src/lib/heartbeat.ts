import { mobileApiClient } from './api-client';

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

async function ping() {
  try {
    await mobileApiClient.post('/api/v1/profile/heartbeat', {});
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
