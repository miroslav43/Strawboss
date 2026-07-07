/**
 * Escape a string for safe interpolation into Leaflet marker/tooltip/popup HTML
 * templates (which are set via `innerHTML`, not React). Any user-controlled
 * field rendered on a map (machine internalCode, parcel name, etc.) MUST go
 * through this before landing in a template literal — see H8/H9,
 * audit-plans/02-HIGH.md (stored XSS via unescaped Leaflet tooltip content).
 */
export function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
