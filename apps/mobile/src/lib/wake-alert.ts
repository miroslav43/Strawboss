/**
 * Geofence "wake" dispatcher + pending-wake queue.
 *
 * When the background GPS task (src/lib/geofence-wake.ts) detects a boundary
 * crossing it calls `presentGeofenceWake()`, which:
 *   1. persists a PendingWake to disk (so the UI can surface a matching overlay
 *      once the app is foregrounded, even if it was killed), and
 *   2. brings the app to the foreground OVER whatever is on screen:
 *        - Device Owner  → launch GeofenceAlertActivity directly (over any app +
 *          lock screen, no notification). This is the path the 30 dedicated
 *          phones take.
 *        - otherwise     → a native full-screen-intent notification that wakes
 *          the screen over the lock screen (degrades to heads-up if the
 *          USE_FULL_SCREEN_INTENT permission isn't granted).
 *
 * The UI drains the queue via `drainPendingWakes()` on mount and on app
 * foreground (see src/hooks/useGeofenceNotifications.ts).
 */
import * as FileSystem from 'expo-file-system/legacy';
import {
  isDeviceOwner,
  launchAlertActivityOverEverything,
  presentFullScreenAlert,
} from './device-owner';
import { mobileLogger } from './logger';

const doc = FileSystem.documentDirectory ?? '';
const PENDING_WAKES_FILE = `${doc}strawboss-pending-wakes.json`;
const MAX_PENDING_WAKES = 20;

const WAKE_DEEPLINK = 'strawboss://';

/**
 * Minimal, side-effect-free alert seed that is safe to enqueue from a client
 * detection (a banner — never an auto-confirming overlay). The authoritative
 * confirm flows (entry_confirm / exit_confirm / deposit countdown) stay owned by
 * the server push + the level-triggered DriverDepotArrivalOverlay.
 */
export interface GeofenceAlertSeed {
  type: 'field_entry';
  parcelName: string;
  assignmentId: string;
}

export interface PendingWake {
  dedupeKey: string;
  kind: 'depot_enter' | 'field_enter' | 'field_exit';
  title: string;
  body: string;
  at: number;
  /** Optional banner to surface when the app foregrounds. */
  alert?: GeofenceAlertSeed;
}

async function readPendingWakes(): Promise<PendingWake[]> {
  try {
    const info = await FileSystem.getInfoAsync(PENDING_WAKES_FILE);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(PENDING_WAKES_FILE);
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingWake[]) : [];
  } catch {
    return [];
  }
}

async function writePendingWakes(wakes: PendingWake[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      PENDING_WAKES_FILE,
      JSON.stringify(wakes.slice(-MAX_PENDING_WAKES)),
    );
  } catch {
    /* non-critical */
  }
}

/**
 * Persist the wake, then foreground the app over everything (device owner) or
 * fire a full-screen-intent notification (fallback).
 */
export async function presentGeofenceWake(event: Omit<PendingWake, 'at'>): Promise<void> {
  const wake: PendingWake = { ...event, at: Date.now() };

  // Persist (dedup by key — keep the newest for a given key).
  try {
    const cur = (await readPendingWakes()).filter((w) => w.dedupeKey !== wake.dedupeKey);
    cur.push(wake);
    await writePendingWakes(cur);
  } catch {
    /* non-critical — the foreground step below is what the user sees */
  }

  mobileLogger.flow('Geofence wake fired', { kind: wake.kind, dedupeKey: wake.dedupeKey });

  if (await isDeviceOwner()) {
    const ok = await launchAlertActivityOverEverything(WAKE_DEEPLINK);
    if (ok) return;
    // Defensive fallthrough if the direct launch was refused.
  }
  await presentFullScreenAlert(wake.title, wake.body, WAKE_DEEPLINK);
}

/** Read and clear the pending-wake queue. Returns oldest-first. */
export async function drainPendingWakes(): Promise<PendingWake[]> {
  const wakes = await readPendingWakes();
  if (wakes.length === 0) return [];
  await writePendingWakes([]);
  return wakes;
}
