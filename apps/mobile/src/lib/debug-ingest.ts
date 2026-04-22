/**
 * Debug-mode NDJSON ingest (session 7a39e5). No secrets/PII.
 * Physical device / emulator: adb reverse tcp:7683 tcp:7683
 */
const INGEST =
  'http://127.0.0.1:7683/ingest/3d71bb49-f968-4f69-8e84-89a66bd466af';
const SESSION_ID = '7a39e5';

export function debugIngest(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
  runId?: string
): void {
  const payload = {
    sessionId: SESSION_ID,
    location,
    message,
    data,
    timestamp: Date.now(),
    hypothesisId,
    ...(runId ? { runId } : {}),
  };
  // Mirror to Metro / adb logcat when ingest is unreachable (device → host).
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('[SB-DEBUG]', JSON.stringify(payload));
  }
  fetch(INGEST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': SESSION_ID,
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
