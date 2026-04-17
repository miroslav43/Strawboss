// Machine icon definitions for the Leaflet map.
// All SVGs: viewBox="0 0 24 24" width="18" height="18" fill="white"
// Three variants per vehicle type. Index 0 is the default.

export type MachineType = 'truck' | 'baler' | 'loader';
export type IconVariant = 0 | 1 | 2;

export interface MachineIconDef {
  color: string;
  /** Exactly 3 full <svg> strings. Index 0 is the default. */
  variants: [string, string, string];
}

// ── Truck SVGs ──────────────────────────────────────────────────────────────

/** V0 – Side-view delivery/cargo truck (cab on right, body on left, 2 wheels) */
const SVG_TRUCK_0 = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9 1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
</svg>`;

/** V1 – Semi / articulated truck (long flat trailer + tall cab with window + 3 wheels) */
const SVG_TRUCK_1 = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 9h13v8H1V9zM14 4h8v13h-8V4zM15 5h6v6h-6V5zM2 20a2 2 0 1 0 4 0 2 2 0 1 0-4 0zM8 20a2 2 0 1 0 4 0 2 2 0 1 0-4 0zM16 20a2 2 0 1 0 4 0 2 2 0 1 0-4 0z"/>
</svg>`;

/** V2 – Pickup truck (separate cab + open load bed, 2 wheels) */
const SVG_TRUCK_2 = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 10h10V6h4v4h6v7h-1.27A2.5 2.5 0 0 1 16 19a2.5 2.5 0 0 1-4.73-2H6.73A2.5 2.5 0 0 1 2 19v-9zm4 7a1 1 0 1 0 2 0 1 1 0 0 0-2 0zm10 0a1 1 0 1 0 2 0 1 1 0 0 0-2 0zM2 12v3h8v-3H2zm10 3h8v-3h-8v3z"/>
</svg>`;

// ── Baler SVGs ───────────────────────────────────────────────────────────────

/** V0 – Round baler (concentric drum rings, two ground wheels) */
const SVG_BALER_0 = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" d="M12 2a8 8 0 1 0 0 16A8 8 0 0 0 12 2zm0 2a6 6 0 1 1 0 12A6 6 0 0 1 12 4zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>
  <rect x="5" y="19" width="3" height="3" rx="1"/>
  <rect x="16" y="19" width="3" height="3" rx="1"/>
</svg>`;

/** V1 – Square/rectangular baler (box body + plunger ram at rear + two wheels) */
const SVG_BALER_1 = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 8h14v10H2V8zm14 2 6 3v5h-6V10zM2 10h12v6H2V10zm4 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
</svg>`;

/** V2 – Tractor side view (large rear wheel, small front wheel, body + cab) */
const SVG_BALER_2 = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path d="M15 12a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM4 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2zM7 9h10v9H7V9zM9 5h5v4H9V5z"/>
</svg>`;

// ── Loader SVGs ──────────────────────────────────────────────────────────────

/** V0 – Front wheel loader (boxy cab, boom arm raised forward, bucket, two wheels) */
const SVG_LOADER_0 = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 7h10v9H10V7zM2 6l3-4h4l-4 5H2zm0 0h5l-1 4H2V6zm-1 4h6v3H1v-3zM8 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm11 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>
</svg>`;

/** V1 – Telehandler (extending diagonal boom + fork attachment + two wheels) */
const SVG_LOADER_1 = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path d="M11 8h9v9h-9V8zM2 12l7-6h3l-7 6H2zm0 0h4v4H2v-4zm0 4h4v3H2v-3zM8 17a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm11 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>
</svg>`;

/** V2 – Skid-steer / compact loader (square body, side lift arms, bucket) */
const SVG_LOADER_2 = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path d="M5 8h14v10H5V8zm-3 0h3v4H2V8zm17 0h3v4h-3V8zM2 11h3v6H2v-6zm17 0h3v6h-3v-6zM1 3h5v5H1V3zm4 0h5l-2 5H5V3zM6 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
</svg>`;

// ── Exports ──────────────────────────────────────────────────────────────────

export const MACHINE_ICONS: Record<MachineType, MachineIconDef> = {
  truck: {
    color: '#22c55e',
    variants: [SVG_TRUCK_0, SVG_TRUCK_1, SVG_TRUCK_2],
  },
  baler: {
    color: '#f59e0b',
    variants: [SVG_BALER_0, SVG_BALER_1, SVG_BALER_2],
  },
  loader: {
    color: '#3b82f6',
    variants: [SVG_LOADER_0, SVG_LOADER_1, SVG_LOADER_2],
  },
};

export const FALLBACK_ICON = {
  color: '#9ca3af',
  svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="white" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8"/></svg>',
};

/** Returns the color + SVG string for a machine type and optional variant. */
export function getMachineVisual(
  type: string | null,
  variant: IconVariant = 0,
): { color: string; svg: string } {
  const def = MACHINE_ICONS[type as MachineType];
  if (!def) return FALLBACK_ICON;
  return { color: def.color, svg: def.variants[variant] };
}
