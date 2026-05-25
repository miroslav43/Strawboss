/**
 * T6 enter — 10 s auto-confirm overlay shown when the baler operator's GPS
 * enters a parcel geofence. Wraps the shared `ConfirmCountdown` and tweaks
 * the label to surface the parcel `code` + crop (RO-only).
 *
 * The action label is purposefully short ("Începi balotarea în <code>") so
 * the countdown digit stays the visual anchor.
 */

import { ConfirmCountdown } from '@/components/shared/ConfirmCountdown';

const CROP_LABELS: Record<string, string> = {
  grau: 'Grâu',
  orz: 'Orz',
  rapita: 'Rapiță',
  plante_nutret: 'Plante de nutreț',
};

export interface BalerEntryCountdownProps {
  /** Total countdown in ms (default 10 000). */
  timeoutMs?: number;
  /** Display label for the parcel (use `code`, not `name`). */
  parcelCode: string;
  /** Optional crop enum value — appended to the label when present. */
  cropType: string | null;
  /** Called when countdown completes — POSTs /confirm-parcel-entry. */
  onConfirm: () => void;
  /** Called when the operator taps Anulează. */
  onCancel: () => void;
}

export function BalerEntryCountdown({
  timeoutMs = 10_000,
  parcelCode,
  cropType,
  onConfirm,
  onCancel,
}: BalerEntryCountdownProps) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const cropSuffix = cropType ? ` (${CROP_LABELS[cropType] ?? cropType})` : '';
  const label = `Începi balotarea în ${parcelCode}${cropSuffix}`;

  return (
    <ConfirmCountdown
      visible
      actionLabel={label}
      countdownSeconds={seconds}
      onConfirmed={onConfirm}
      onCancel={onCancel}
    />
  );
}
