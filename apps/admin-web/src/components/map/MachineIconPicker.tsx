'use client';

import type { MachineType, IconVariant } from './machine-icons';
import { MACHINE_ICONS } from './machine-icons';

interface Props {
  /** The vehicle type whose 3 icon variants to display. */
  machineType: MachineType;
  /** Currently selected variant (0–2). */
  currentVariant: IconVariant;
  /** Called when the user picks a different variant. */
  onSet: (variant: IconVariant) => void;
}

/**
 * Shows the 3 icon variants for a single machine type.
 * The active variant gets a ring highlight + slight scale-up.
 *
 * SVG content comes entirely from the static machine-icons.ts constant —
 * never from user input — so dangerouslySetInnerHTML is safe here.
 */
export function MachineIconPicker({ machineType, currentVariant, onSet }: Props) {
  const def = MACHINE_ICONS[machineType];
  if (!def) return null;

  return (
    <div className="flex items-center gap-2">
      {def.variants.map((svg, i) => {
        const active = currentVariant === i;
        return (
          <button
            key={i}
            type="button"
            title={`Varianta ${i + 1}`}
            onClick={() => onSet(i as IconVariant)}
            style={{ background: def.color }}
            className={[
              'h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-150',
              active
                ? 'ring-2 ring-offset-2 ring-neutral-700 scale-110 shadow-md'
                : 'opacity-50 hover:opacity-85 hover:scale-105',
            ].join(' ')}
            // Safe: SVG string is a compile-time constant from machine-icons.ts
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        );
      })}
    </div>
  );
}
