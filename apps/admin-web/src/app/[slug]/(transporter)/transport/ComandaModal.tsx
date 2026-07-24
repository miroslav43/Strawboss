'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  FileSignature,
  XCircle,
  Loader2,
  RefreshCw,
  Download,
  Building2,
  AlertTriangle,
} from 'lucide-react';
import type { TripRequest, Document } from '@strawboss/types';
import { useTransporterComanda, useGenerateTransporterComanda } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useOrgSlug } from '@/hooks/useOrgSlug';
import { normalizeList } from '@/lib/normalize-api-list';
import { DocumentViewer } from '@/components/shared/DocumentViewer';

/**
 * View / (re)generate the comandă (transport order) for one of the transporter's
 * own requests. The comandă is generated automatically on submit; this modal is
 * the place to view/download it and to regenerate it on demand.
 */
export function ComandaModal({ request, onClose }: { request: TripRequest; onClose: () => void }) {
  const { t } = useI18n();
  const slug = useOrgSlug();
  const comanda = useTransporterComanda(apiClient, request.id);
  const generate = useGenerateTransporterComanda(apiClient);

  const doc = useMemo(() => normalizeList<Document>(comanda.data)[0] ?? null, [comanda.data]);
  const resolvedUrl = doc?.fileUrl ? apiClient.resolveAssetUrl(doc.fileUrl) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        style={{ maxHeight: 'min(90vh, 860px)' }}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-neutral-800">
            <FileSignature className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate">
              {t('tripRequests.comandaTitle')}
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

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {comanda.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.loading')}
            </div>
          ) : doc && resolvedUrl ? (
            <DocumentViewer document={{ ...doc, fileUrl: resolvedUrl }} />
          ) : (
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-6 text-center">
              <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-amber-500" />
              <p className="text-sm font-semibold text-amber-800">
                {t('tripRequests.comandaNone')}
              </p>
              <p className="mt-1 text-sm text-amber-700">
                {t('tripRequests.comandaNeedsSettings')}
              </p>
              <Link
                href={`/${slug}/beneficiari`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
              >
                <Building2 className="h-4 w-4" />
                {t('tripRequests.comandaConfigure')}
              </Link>
            </div>
          )}
          {generate.isError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
              <span>{(generate.error as Error)?.message ?? t('tripRequests.comandaError')}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-neutral-200 bg-neutral-50 px-6 py-3">
          {resolvedUrl && (
            <a
              href={resolvedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-white"
            >
              <Download className="h-4 w-4" />
              {t('tripRequests.comandaDownload')}
            </a>
          )}
          <button
            onClick={() => generate.mutate(request.id)}
            disabled={generate.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {generate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {doc ? t('tripRequests.comandaRegenerate') : t('tripRequests.comandaGenerate')}
          </button>
        </div>
      </div>
    </div>
  );
}
