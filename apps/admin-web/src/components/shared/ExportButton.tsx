'use client';

import { Download, FileText } from 'lucide-react';
import { useFeatures } from '@/hooks/useFeatures';
import { cn } from '@/lib/utils';

/**
 * Every data-export trigger in the app.
 *
 * There were nine independent copies — one per report tab, one on the
 * transporter page, plus the PDF export — each with its own inline button and
 * its own `exportCsv`/`exportXlsx` import. Gating them individually would have
 * been nine chances to miss one, and a missed one leaks exactly the capability
 * the `analytics.export` flag exists to withhold. One component, one gate.
 *
 * PDF is included deliberately: it is the same act, taking the organization's
 * data out of the product, and splitting it under its own key would give a
 * customer who did not buy exports a working export button.
 *
 * Returns null rather than a disabled button when the feature is off — a
 * greyed-out control invites a support ticket asking why it does not work.
 */
export interface ExportButtonProps {
  label: string;
  onClick: () => void;
  /** Nothing to export yet — distinct from "not allowed to export". */
  disabled?: boolean;
  variant?: 'csv' | 'pdf';
  className?: string;
}

export function ExportButton({
  label,
  onClick,
  disabled,
  variant = 'csv',
  className,
}: ExportButtonProps) {
  const { isEnabled } = useFeatures();
  if (!isEnabled('analytics.export')) return null;

  const Icon = variant === 'pdf' ? FileText : Download;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5',
        'text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'disabled:opacity-50',
        className,
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
