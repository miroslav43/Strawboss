'use client';

import { useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { apiV1Url } from '@/lib/api';
import type { RecordKind } from './BeneficiaryRecordModal';

const KIND_PATH: Record<RecordKind, string> = {
  contact: 'contacts',
  truck: 'trucks',
  driver: 'drivers',
};

interface BeneficiaryRecordDeleteDialogProps {
  kind: RecordKind;
  recordId: string;
  recordLabel: string;
  orgSlug: string;
  beneficiarySlug: string;
  pin: string;
  onDeleted: (id: string) => void;
  onClose: () => void;
}

export function BeneficiaryRecordDeleteDialog({
  kind,
  recordId,
  recordLabel,
  orgSlug,
  beneficiarySlug,
  pin,
  onDeleted,
  onClose,
}: BeneficiaryRecordDeleteDialogProps) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(
        apiV1Url(
          `/public/portal/${orgSlug}/beneficiary/${beneficiarySlug}/${KIND_PATH[kind]}/${recordId}/delete`,
        ),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin }),
        },
      );
      // A 404 means it was already removed (e.g. by another portal session) —
      // treat as success so the UI converges.
      if (res.ok || res.status === 404) {
        onDeleted(recordId);
        return;
      }
      setError(
        res.status === 429
          ? t('beneficiaryPortal.pinThrottled')
          : res.status === 410
            ? t('beneficiaryPortal.pinExpired')
            : t('beneficiaryPortal.saved.deleteError'),
      );
    } catch {
      setError(t('beneficiaryPortal.saved.deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100">
          <Trash2 className="h-6 w-6 text-rose-500" />
        </div>
        <h2 className="text-base font-semibold text-bark">
          {t('beneficiaryPortal.saved.deleteTitle')}
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          {t('beneficiaryPortal.saved.deleteConfirm', { name: recordLabel })}
        </p>
        {error && (
          <p className="mt-3 text-sm font-medium text-rose-600" role="alert">
            {error}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
          >
            {t('beneficiaryPortal.saved.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={deleting}
            className="flex items-center gap-2 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {t('beneficiaryPortal.saved.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
