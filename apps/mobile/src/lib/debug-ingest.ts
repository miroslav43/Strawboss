/**
 * Debug-mode NDJSON ingest (session 9b3404). No secrets/PII.
 * On a physical device, run: adb reverse tcp:7759 tcp:7759
 */
const INGEST =
  'http://127.0.0.1:7759/ingest/b10ec6be-b647-4627-becf-fa99f7450535';

export function debugIngest(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string
): void {
  fetch(INGEST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '9b3404',
    },
    body: JSON.stringify({
      sessionId: '9b3404',
      location,
      message,
      data,
      timestamp: Date.now(),
      hypothesisId,
    }),
  }).catch(() => {});
}
