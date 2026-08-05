/**
 * Satellite-only position source (Android), backed by the native
 * `StrawbossGps` module — see `plugins/withGpsCapture.js`.
 *
 * Why this exists rather than another expo-location call: expo-location speaks
 * only to Google Play Services' FUSED provider, which silently substitutes a
 * Wi-Fi/cell-tower centroid whenever satellites are unavailable. Those centroids
 * are kilometres wrong and carry no marker JavaScript can test — in production
 * they drew a polyline across an entire county. `LocationManager.GPS_PROVIDER`,
 * which this module wraps, has no network fallback by construction: it returns a
 * satellite-derived position or nothing at all.
 */
import { NativeModules, Platform } from 'react-native';
import { mobileLogger } from './logger';

interface StrawbossGpsNative {
  getSatelliteFix(timeoutMs: number): Promise<NativeGpsFix | null>;
  isGpsProviderEnabled(): Promise<boolean>;
}

export interface NativeGpsFix {
  lat: number;
  lon: number;
  accuracyM: number | null;
  speedMs: number | null;
  headingDeg: number | null;
  /** Device clock, milliseconds since epoch. */
  timestamp: number;
  /** Always 'gps' by construction — asserted below rather than trusted. */
  provider: string | null;
}

const native: StrawbossGpsNative | undefined = (
  NativeModules as { StrawbossGps?: StrawbossGpsNative }
).StrawbossGps;

/** True when the native satellite-only module is present in this build. */
export function isNativeGpsAvailable(): boolean {
  return Platform.OS === 'android' && native != null;
}

/**
 * One satellite fix, or null.
 *
 * Null is a normal answer, not an error: indoors, under a metal roof, or with a
 * cold chip there may genuinely be no position. Reporting nothing is correct —
 * the whole point of this module is that we would rather have a gap in the track
 * than a tower address pretending to be the machine.
 */
export async function getSatelliteFix(timeoutMs: number): Promise<NativeGpsFix | null> {
  if (!native) return null;
  try {
    const fix = await native.getSatelliteFix(timeoutMs);
    if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return null;

    // Assert the provider rather than trusting the native comment. If a future
    // edit ever points this at the fused provider, the failure should be a
    // dropped fix and a loud log — not tower addresses silently back on the map.
    if (fix.provider !== null && fix.provider !== 'gps') {
      mobileLogger.warn('Native GPS returned a non-satellite provider — discarding', {
        provider: fix.provider,
        accuracyM: fix.accuracyM,
      });
      return null;
    }
    return fix;
  } catch (err) {
    mobileLogger.warn('Native satellite fix failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Is the OS-level GPS provider switched on? Diagnostic for the health report. */
export async function isGpsProviderEnabled(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.isGpsProviderEnabled();
  } catch {
    return false;
  }
}
