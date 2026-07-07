'use client';

import { useMemo, useState } from 'react';
import { FileText, XCircle, UploadCloud, Loader2 } from 'lucide-react';
import type { TripRequest, Document } from '@strawboss/types';
import { useRequestAvize, useUploadAviz } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { cn } from '@/lib/utils';
import { DocumentViewer } from '@/components/shared/DocumentViewer';

function isPdf(f: File): boolean {
  return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
}

export function AvizUploadModal({
  request,
  onClose,
}: {
  request: TripRequest;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const upload = useUploadAviz(apiClient);
  const avize = useRequestAvize(apiClient, request.id);

  const existing = useMemo(() => normalizeList<Document>(avize.data)[0] ?? null, [avize.data]);

  const handleUpload = () => {
    if (!file || !isPdf(file)) return;
    // Uploading replaces any existing aviz (uploadAviz soft-deletes the prior
    // one server-side, single-aviz-per-request) — confirm before overwriting.
    if (
      existing &&
      typeof window !== 'undefined' &&
      !window.confirm(t('tripRequests.avizReplaceConfirm'))
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
    if (/413|exceeds|too large/i.test(msg)) return t('tripRequests.avizTooLarge');
    return t('tripRequests.avizUploadError');
  })();

  const badFile = file != null && !isPdf(file);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        style={{ maxHeight: 'min(90vh, 820px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-neutral-800">
            <FileText className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate">
              {t('tripRequests.avizTitle')}
              {request.truckRegistrationPlate ? ` · ${request.truckRegistrationPlate}` : ''}
            </span>
          </h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* Existing aviz */}
          {avize.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.loading')}
            </div>
          ) : existing ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                {t('tripRequests.avizExisting')}
              </p>
              <DocumentViewer
                document={{ ...existing, fileUrl: apiClient.resolveAssetUrl(existing.fileUrl) }}
              />
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-neutral-200 py-6 text-center text-sm text-neutral-400">
              {t('tripRequests.avizNoFiles')}
            </p>
          )}

          {/* Upload / replace */}
          <div className="space-y-2 border-t border-neutral-100 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              {existing ? t('tripRequests.avizReplace') : t('tripRequests.uploadAviz')}
            </p>
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition',
                badFile
                  ? 'border-red-300 bg-red-50 text-red-600'
                  : 'border-neutral-300 text-neutral-500 hover:border-primary hover:bg-neutral-50',
              )}
            >
              <UploadCloud className="h-6 w-6" />
              <span className="font-medium text-neutral-700">
                {file ? file.name : t('tripRequests.avizSelectFile')}
              </span>
              <span className="text-xs text-neutral-400">{t('tripRequests.avizPdfOnly')}</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {badFile && <p className="text-xs text-red-600">{t('tripRequests.avizPdfOnly')}</p>}
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
            disabled={!file || badFile || upload.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {upload.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {upload.isPending ? t('tripRequests.avizUploading') : t('tripRequests.avizUploadBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
