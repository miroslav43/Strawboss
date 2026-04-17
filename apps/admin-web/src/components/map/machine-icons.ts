// Machine icon definitions for the Leaflet map.
// SVG path data comes from @mdi/js (Material Design Icons) — tree-shakeable.
// Three variants per vehicle type. Index 0 is the default.

import {
  mdiTruckDelivery,   // Truck V0 — delivery/cargo truck
  mdiTruckTrailer,    // Truck V1 — semi / articulated truck
  mdiTruckFlatbed,    // Truck V2 — flatbed truck
  mdiTractor,         // Baler V0 — tractor (round baler)
  mdiTractorVariant,  // Baler V1 — tractor variant (square baler)
  mdiGrain,           // Baler V2 — grain / baler concept
  mdiForklift,        // Loader V0 — front wheel loader / forklift
  mdiDumpTruck,       // Loader V1 — dump truck / telehandler
  mdiCrane,           // Loader V2 — crane / compact loader
} from '@mdi/js';

export type MachineType = 'truck' | 'baler' | 'loader';
export type IconVariant = 0 | 1 | 2;

export interface MachineIconDef {
  color: string;
  /** Exactly 3 full <svg> strings. Index 0 is the default. */
  variants: [string, string, string];
}

/** Build a complete <svg> HTML string from an MDI path string. */
function mdiSvg(path: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="white"><path d="${path}"/></svg>`;
}

export const MACHINE_ICONS: Record<MachineType, MachineIconDef> = {
  truck: {
    color: '#22c55e',
    variants: [
      mdiSvg(mdiTruckDelivery),
      mdiSvg(mdiTruckTrailer),
      mdiSvg(mdiTruckFlatbed),
    ],
  },
  baler: {
    color: '#f59e0b',
    variants: [
      mdiSvg(mdiTractor),
      mdiSvg(mdiTractorVariant),
      mdiSvg(mdiGrain),
    ],
  },
  loader: {
    color: '#3b82f6',
    variants: [
      mdiSvg(mdiForklift),
      mdiSvg(mdiDumpTruck),
      mdiSvg(mdiCrane),
    ],
  },
};

export const FALLBACK_ICON = {
  color: '#9ca3af',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="white"><circle cx="12" cy="12" r="8"/></svg>',
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
