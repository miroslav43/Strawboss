/**
 * Client-side geofence detection for the always-on background GPS task.
 *
 * Generalises the level-triggered presence logic from
 * `src/hooks/useDriverDepotArrival.ts` into a hook-free function that runs inside
 * the location TaskManager task (see src/lib/location.ts). On every GPS batch it
 * checks — against the LOCAL SQLite geometry, so it works fully offline — whether
 * the operator has crossed into/out of:
 *   - a delivery depot (while they have an in_transit trip), or
 *   - one of today's assigned parcels (for the phone's machine).
 *
 * On a crossing it raises a "wake" (src/lib/wake-alert.ts) that brings the app to
 * the foreground over whatever is on screen. This is push-independent and
 * redundant with the server geofence push — the 60 s debounce keyed on
 * type:assignmentId in useGeofenceNotifications collapses any duplicate UI.
 *
 * Uses the same 30 m enter / 60 m exit hysteresis as the backend geofence service
 * so GPS drift at field edges doesn't flap. Never throws (called fire-and-forget).
 */
import * as FileSystem from 'expo-file-system/legacy';
import { getDatabase } from './storage';
import { TripsRepo } from '../db/trips-repo';
import { DeliveryDestinationsRepo } from '../db/delivery-destinations-repo';
import { TaskAssignmentsRepo } from '../db/task-assignments-repo';
import { ParcelsRepo } from '../db/parcels-repo';
import { distanceToBoundaryMeters, PARCEL_MATCH_TOLERANCE_M } from './point-in-geojson';
import { todayInRomania } from './date';
import { presentGeofenceWake } from './wake-alert';
import { mobileLogger } from './logger';

const doc = FileSystem.documentDirectory ?? '';
const WAKE_STATE_FILE = `${doc}strawboss-geofence-wake-state.json`;

/** Enter when within 30 m; exit only past 60 m; in between, keep prior state. */
const ENTER_M = PARCEL_MATCH_TOLERANCE_M; // 30
const EXIT_M = 60;
/** Minimum ms between two wakes for the same geofence key. */
const WAKE_DEBOUNCE_MS = 60_000;

interface GeofenceState {
  inside: boolean;
  lastFiredMs: number;
}
type WakeState = Record<string, GeofenceState>;

async function readState(): Promise<WakeState> {
  try {
    const info = await FileSystem.getInfoAsync(WAKE_STATE_FILE);
    if (!info.exists) return {};
    const raw = await FileSystem.readAsStringAsync(WAKE_STATE_FILE);
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as WakeState) : {};
  } catch {
    return {};
  }
}

async function writeState(state: WakeState): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(WAKE_STATE_FILE, JSON.stringify(state));
  } catch {
    /* non-critical */
  }
}

/** Hysteresis: inside when ≤30 m, outside when >60 m, otherwise unchanged. */
function computeInside(prevInside: boolean, distM: number): boolean {
  if (distM <= ENTER_M) return true;
  if (distM > EXIT_M) return false;
  return prevInside;
}

interface Candidate {
  key: string;
  kind: 'depot' | 'parcel';
  name: string;
  boundary: unknown;
  assignmentId: string | null;
}

/** Collect the geofences worth checking right now from local SQLite. */
async function collectCandidates(machineId: string): Promise<Candidate[]> {
  const db = await getDatabase();
  const out: Candidate[] = [];

  // Depots — only while there is an active in_transit trip (mirrors useDriverDepotArrival).
  try {
    const trips = await new TripsRepo(db).listActive();
    const inTransit = trips.find((t) => t.status === 'in_transit');
    if (inTransit) {
      const depots = (await new DeliveryDestinationsRepo(db).listAll()).filter((d) => d.boundary);
      const candidates =
        inTransit.destination_id != null
          ? depots.filter((d) => d.id === inTransit.destination_id)
          : depots;
      for (const d of candidates) {
        out.push({
          key: `depot:${d.id}`,
          kind: 'depot',
          name: d.name,
          boundary: d.boundary,
          assignmentId: null,
        });
      }
    }
  } catch (err) {
    mobileLogger.warn('geofence-wake: depot candidates failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Parcels — today's assignments for this machine.
  try {
    const today = todayInRomania();
    const assignments = (await new TaskAssignmentsRepo(db).listByDate(today)).filter(
      (a) => a.machine_id === machineId && a.parcel_id,
    );
    if (assignments.length) {
      // Dedupe by parcel; keep the first assignmentId for that parcel.
      const byParcel = new Map<string, string>();
      for (const a of assignments) {
        if (a.parcel_id && !byParcel.has(a.parcel_id)) byParcel.set(a.parcel_id, a.id);
      }
      const parcels = await new ParcelsRepo(db).listByIds([...byParcel.keys()]);
      for (const p of parcels) {
        if (!p.geometry) continue;
        out.push({
          key: `parcel:${p.id}`,
          kind: 'parcel',
          name: p.name || p.code,
          boundary: p.geometry,
          assignmentId: byParcel.get(p.id) ?? null,
        });
      }
    }
  } catch (err) {
    mobileLogger.warn('geofence-wake: parcel candidates failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return out;
}

/**
 * Evaluate the current GPS fix against local geofences and raise a wake on any
 * fresh boundary crossing. Safe to call fire-and-forget from the location task.
 */
export async function maybeRaiseGeofenceWake(
  machineId: string,
  gps: { lat: number; lon: number },
): Promise<void> {
  if (!Number.isFinite(gps.lat) || !Number.isFinite(gps.lon)) return;
  try {
    const candidates = await collectCandidates(machineId);
    if (candidates.length === 0) return;

    const state = await readState();
    const now = Date.now();
    let changed = false;

    for (const c of candidates) {
      const prev = state[c.key] ?? { inside: false, lastFiredMs: 0 };
      const dist = distanceToBoundaryMeters(gps.lon, gps.lat, c.boundary);
      const nowInside = computeInside(prev.inside, dist);

      if (nowInside === prev.inside) {
        // No transition — keep the row (so exits can be detected later).
        state[c.key] = prev;
        continue;
      }

      // Transition detected. Depots only wake on ENTER (arrival); parcels on both.
      const isEnter = nowInside;
      const shouldWake = (c.kind === 'depot' && isEnter) || c.kind === 'parcel';
      const debounced = now - prev.lastFiredMs < WAKE_DEBOUNCE_MS;

      if (shouldWake && !debounced) {
        const event = buildWakeEvent(c, isEnter);
        if (event) {
          await presentGeofenceWake(event);
          state[c.key] = { inside: nowInside, lastFiredMs: now };
          changed = true;
          continue;
        }
      }
      // Update presence even when we don't (re)fire.
      state[c.key] = { inside: nowInside, lastFiredMs: prev.lastFiredMs };
      changed = true;
    }

    if (changed) await writeState(state);
  } catch (err) {
    mobileLogger.warn('maybeRaiseGeofenceWake failed (isolated)', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function buildWakeEvent(
  c: Candidate,
  isEnter: boolean,
): Parameters<typeof presentGeofenceWake>[0] | null {
  if (c.kind === 'depot') {
    // Arrival — let the level-triggered DriverDepotArrivalOverlay own the
    // countdown UI once foregrounded; we only wake + foreground here.
    return {
      dedupeKey: c.key,
      kind: 'depot_enter',
      title: 'StrawBoss — Sosire la depozit',
      body: `Ai ajuns la ${c.name}.`,
    };
  }
  if (isEnter) {
    return {
      dedupeKey: c.key,
      kind: 'field_enter',
      title: 'StrawBoss — Intrare în câmp',
      body: `Ai intrat în ${c.name}.`,
      // Safe, non-confirming banner; server push still drives entry_confirm.
      alert: c.assignmentId
        ? { type: 'field_entry', parcelName: c.name, assignmentId: c.assignmentId }
        : undefined,
    };
  }
  return {
    dedupeKey: c.key,
    kind: 'field_exit',
    title: 'StrawBoss — Ieșire din câmp',
    body: `Ai ieșit din ${c.name}.`,
    // No client-side enqueue on exit: the server push owns exit_confirm /
    // loader_exit_confirm. We only wake + foreground.
  };
}
