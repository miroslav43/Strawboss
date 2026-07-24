'use client';

import { FileText, ScanLine, Check, AlertTriangle } from 'lucide-react';
import type { TripRequest } from '@strawboss/types';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

/**
 * Aviz + CMR-scan presence, as two compact chips.
 *
 * Filled = present, outline = missing. The dispatcher's actual 07:00 question is
 * "which of these still lacks a document", which is a scan down a column — not a
 * row of buttons whose labels have to be read one by one.
 *
 * Both flags are REQUEST-keyed (`documents.trip_request_id`), and must stay that
 * way: an aviz uploaded before the trip is materialized has `documents.trip_id`
 * NULL forever — nothing back-fills it — so a trip-keyed lookup would lose it.
 *
 * The CMR here is the *scanned paper* one the external driver brings
 * (`document_type = 'cmr_scan'`), not the CMR the backend generates itself.
 */
export function RequestDocChips({
  request,
  onUploadAviz,
  onUploadCmr,
  readOnly = false,
  onViewComanda,
}: {
  request: TripRequest;
  onUploadAviz?: (r: TripRequest) => void;
  onUploadCmr?: (r: TripRequest) => void;
  /** Render static (non-clickable) aviz/CMR chips — the transporter can SEE a
   *  document exists but cannot upload. Defaults to the admin's interactive UI. */
  readOnly?: boolean;
  /** When provided, renders a 3rd view-only "Comandă" chip (the generated order).
   *  Always clickable — it opens/generates the comandă, never an upload. */
  onViewComanda?: (r: TripRequest) => void;
}) {
  const { t } = useI18n();

  const chip = (
    has: boolean,
    Icon: typeof FileText,
    label: string,
    title: string,
    onClick: () => void,
  ) => {
    const inner = (
      <>
        {has ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
        {label}
      </>
    );
    const base =
      'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition';
    const tone = has
      ? cn('border-green-600 bg-green-600 text-white', !readOnly && 'hover:bg-green-700')
      : cn(
          'border-dashed border-neutral-300 bg-white text-neutral-400',
          !readOnly && 'hover:border-neutral-400 hover:text-neutral-600',
        );
    if (readOnly) {
      return (
        <span title={title} aria-label={title} className={cn(base, tone)}>
          {inner}
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        title={title}
        aria-label={title}
        className={cn(base, tone)}
      >
        {inner}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-1">
      {chip(
        !!request.hasAviz,
        FileText,
        t('tripRequests.chipAviz'),
        request.hasAviz ? t('tripRequests.avizUploaded') : t('tripRequests.uploadAviz'),
        () => onUploadAviz?.(request),
      )}
      {chip(
        !!request.hasCmrScan,
        ScanLine,
        t('tripRequests.chipCmr'),
        request.hasCmrScan ? t('tripRequests.cmrUploaded') : t('tripRequests.uploadCmr'),
        () => onUploadCmr?.(request),
      )}
      {onViewComanda && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onViewComanda(request);
          }}
          title={
            request.hasComanda ? t('tripRequests.comandaView') : t('tripRequests.comandaGenerate')
          }
          aria-label={
            request.hasComanda ? t('tripRequests.comandaView') : t('tripRequests.comandaGenerate')
          }
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition',
            request.hasComanda
              ? 'border-green-600 bg-green-600 text-white hover:bg-green-700'
              : // Missing comandă is a problem (usually: no order settings) — make it loud.
                'border-red-600 bg-red-600 text-white hover:bg-red-700 animate-pulse',
          )}
        >
          {request.hasComanda ? (
            <Check className="h-3 w-3" />
          ) : (
            <AlertTriangle className="h-3 w-3" />
          )}
          {t('tripRequests.chipComanda')}
        </button>
      )}
    </div>
  );
}
