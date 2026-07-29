'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ScanLine, PackageCheck, XCircle, UploadCloud, Loader2 } from 'lucide-react';
import type { TripRequest, Document } from '@strawboss/types';
import { useRequestCmrScans, useUploadCmrScan, type CmrKind } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { cn } from '@/lib/utils';
import { DocumentViewer } from '@/components/shared/DocumentViewer';

function isPdf(f: File): boolean {
  return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
function isImage(f: File): boolean {
  return IMAGE_TYPES.has(f.type);
}

/** Mirror of the server's CMR_SCAN_MAX_BYTES — reject client-side before streaming. */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Upload (or override) one of the two scanned CMRs on an auxiliary transport:
 *
 * - `loading` (default) — the paper CMR the loader photographs at pickup.
 *   Normally posted from the phone at the end of the load; this modal is the
 *   admin's manual override for when that didn't happen (or produced an
 *   unusable scan). PDF only.
 * - `delivery` — the photo the external driver uploads at the destination
 *   through the one-time public link. This modal lets an admin/transporter
 *   attach it on the driver's behalf (e.g. it arrived by WhatsApp instead).
 *   Accepts a photo OR an already-built PDF — uploading it here also
 *   completes the trip, exactly like the driver's own upload does.
 */
export function CmrUploadModal({
  request,
  onClose,
  variant = 'admin',
  kind = 'loading',
}: {
  request: TripRequest;
  onClose: () => void;
  /** 'transporter' targets the ownership-scoped transporter endpoints. */
  variant?: 'admin' | 'transporter';
  /** Which end of the trip this upload is for — see the doc comment above. */
  kind?: CmrKind;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const upload = useUploadCmrScan(apiClient, variant, kind);
  const scans = useRequestCmrScans(apiClient, request.id, variant, kind);
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const isAccepted = (f: File) => (kind === 'delivery' ? isPdf(f) || isImage(f) : isPdf(f));

  const existing = useMemo(() => normalizeList<Document>(scans.data)[0] ?? null, [scans.data]);

  // Dialog semantics: move focus in on mount, restore it to the trigger on
  // unmount, and close on Escape — so keyboard/screen-reader users can find and
  // dismiss the modal. onClose is read through a ref so this runs once.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  const badFile = file != null && !isAccepted(file);
  const tooLarge = file != null && file.size > MAX_UPLOAD_BYTES;
  const fileTypeHint =
    kind === 'delivery' ? t('tripRequests.cmrArrivalFileTypes') : t('tripRequests.cmrPdfOnly');

  const handleUpload = () => {
    if (!file || !isAccepted(file) || tooLarge) return;
    // Uploading replaces any existing scan (the server soft-deletes the prior one,
    // single-CMR-per-request) — and it may be overwriting what the loader scanned
    // in the field, so confirm before clobbering it.
    if (
      existing &&
      typeof window !== 'undefined' &&
      !window.confirm(t('tripRequests.cmrReplaceConfirm'))
    ) {
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    upload.mutate({ requestId: request.id, formData }, { onSuccess: () => setFile(null) });
  };

  const errorMessage = (() => {
    if (!upload.isError) return null;
    const msg = upload.error instanceof Error ? upload.error.message : '';
    if (/413|exceeds|too large/i.test(msg)) return t('tripRequests.cmrTooLarge');
    return t('tripRequests.cmrUploadError');
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        style={{ maxHeight: 'min(90vh, 820px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2
            id={titleId}
            className="flex min-w-0 items-center gap-2 text-lg font-semibold text-neutral-800"
          >
            {kind === 'delivery' ? (
              <PackageCheck className="h-5 w-5 shrink-0 text-primary" />
            ) : (
              <ScanLine className="h-5 w-5 shrink-0 text-primary" />
            )}
            <span className="truncate">
              {kind === 'delivery' ? t('tripRequests.cmrArrivalTitle') : t('tripRequests.cmrTitle')}
              {request.truckRegistrationPlate ? ` · ${request.truckRegistrationPlate}` : ''}
            </span>
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* Existing scan */}
          {scans.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.loading')}
            </div>
          ) : existing ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                {t('tripRequests.cmrExisting')}
              </p>
              <DocumentViewer
                document={{ ...existing, fileUrl: apiClient.resolveAssetUrl(existing.fileUrl) }}
              />
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-neutral-200 py-6 text-center text-sm text-neutral-400">
              {t('tripRequests.cmrNoFiles')}
            </p>
          )}

          {/* Upload / replace */}
          <div className="space-y-2 border-t border-neutral-100 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              {existing ? t('tripRequests.cmrReplace') : t('tripRequests.uploadCmr')}
            </p>
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition',
                badFile || tooLarge
                  ? 'border-red-300 bg-red-50 text-red-600'
                  : 'border-neutral-300 text-neutral-500 hover:border-primary hover:bg-neutral-50',
              )}
            >
              <UploadCloud className="h-6 w-6" />
              <span className="font-medium text-neutral-700">
                {file ? file.name : t('tripRequests.cmrSelectFile')}
              </span>
              <span className="text-xs text-neutral-400">{fileTypeHint}</span>
              <input
                type="file"
                accept={
                  kind === 'delivery'
                    ? 'image/jpeg,image/png,image/webp,application/pdf,.pdf'
                    : 'application/pdf,.pdf'
                }
                capture={kind === 'delivery' ? 'environment' : undefined}
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {badFile && <p className="text-xs text-red-600">{fileTypeHint}</p>}
            {tooLarge && <p className="text-xs text-red-600">{t('tripRequests.cmrTooLarge')}</p>}
            {errorMessage && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{errorMessage}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-neutral-200 bg-neutral-50 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-white"
          >
            {t('common.close')}
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || badFile || tooLarge || upload.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {upload.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {upload.isPending ? t('tripRequests.cmrUploading') : t('tripRequests.cmrUploadBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
