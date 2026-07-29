'use client';

import { cn } from '@/lib/utils';

/**
 * The app's toggle switch.
 *
 * Consolidates four near-identical hand-rolled copies (settings, deposits,
 * accounts, the feature console) that had drifted apart: different track sizes,
 * one using `bg-green-700` and another `bg-primary`, knob offsets computed with
 * arbitrary pixel values, and no keyboard focus ring anywhere.
 *
 * Geometry uses only scale values and adds up exactly: a 44px track with 4px
 * padding and a 16px knob leaves 24px of travel — `translate-x-6`. Nothing here
 * needs a bracketed length.
 */
export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Required: a switch with no accessible name is unusable by screen reader. */
  label: string;
  /**
   * Renders and behaves as off, but explains itself as "decided elsewhere"
   * rather than "broken" — used when a parent module already forces the value.
   */
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2',
        checked ? 'bg-primary' : 'bg-neutral-300',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
        className,
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}
