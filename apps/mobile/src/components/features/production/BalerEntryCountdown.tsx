/**
 * T6 enter — 10 s auto-confirm overlay shown when the baler operator's GPS
 * enters a parcel geofence. Wraps the shared `ConfirmCountdown` and tweaks
 * the label to surface the parcel `code` + crop (RO-only).
 *
 * The action label is purposefully short ("Începi balotarea în <code>") so
 * the countdown digit stays the visual anchor.
 */

import { ConfirmCountdown } from '@/components/shared/ConfirmCountdown';
import { useI18n } from '@/lib/i18n';

export interface BalerEntryCountdownProps {
  /** Total countdown in ms (default 10 000). */
  timeoutMs?: number;
  /** Display label for the parcel (use `code`, not `name`). */
  parcelCode: string;
  /** Optional crop enum value — appended to the label when present. */
  cropType: string | null;
  /**
   * Optional full label override. When set, it replaces the default baler copy
   * — used to reuse this countdown for loader ("Începi încărcarea în …") and
   * truck ("Confirmi sosirea la …") entry overlays.
   */
  label?: string;
  /** Called when countdown completes — POSTs /confirm-parcel-entry. */
  onConfirm: () => void;
  /** Called when the operator taps Anulează. */
  onCancel: () => void;
}

export function BalerEntryCountdown({
  timeoutMs = 10_000,
  parcelCode,
  cropType,
  label: labelOverride,
  onConfirm,
  onCancel,
}: BalerEntryCountdownProps) {
  const { t } = useI18n();
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const cropKey = cropType ? `production.balerEntry.crop.${cropType}` : null;
  const cropLabel = cropKey ? t(cropKey) : null;
  const cropSuffix = cropLabel ? ` (${cropLabel})` : '';
  const label =
    labelOverride ??
    `${t('production.balerEntry.defaultLabel').replace('{parcelCode}', parcelCode)}${cropSuffix}`;

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
