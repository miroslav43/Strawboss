'use client';
export const dynamic = 'force-dynamic';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, Check } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function NewOrganizationPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      if (!slugTouched) {
        setSlug(toSlug(value));
      }
    },
    [slugTouched],
  );

  const handleSlugChange = useCallback((value: string) => {
    setSlugTouched(true);
    setSlug(toSlug(value));
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    if (!trimmedName || !trimmedSlug) return;

    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/api/v1/organizations', { name: trimmedName, slug: trimmedSlug });
      router.replace('/super-admin/organizations');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('superAdmin.orgs.newOrg.createFailed'));
      setSubmitting(false);
    }
  }, [name, slug, router, t]);

  const isValid = name.trim().length > 0 && slug.trim().length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <a
          href="/super-admin/organizations"
          className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('superAdmin.orgs.newOrg.breadcrumb')}
        </a>
        <span className="text-neutral-300">/</span>
        <span className="text-sm font-medium text-neutral-800">
          {t('superAdmin.orgs.newOrg.title')}
        </span>
      </div>

      <div className="max-w-lg rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="mb-5 text-base font-bold text-neutral-800">
          {t('superAdmin.orgs.createTitle')}
        </h1>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              {t('superAdmin.orgs.newOrg.nameLabel')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder={t('superAdmin.orgs.newOrg.namePlaceholder')}
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              {t('superAdmin.orgs.newOrg.slugLabel')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder={t('superAdmin.orgs.newOrg.slugPlaceholder')}
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
            />
            <p className="mt-1.5 text-xs text-neutral-400">
              {t('superAdmin.orgs.newOrg.slugHint')}
            </p>
          </div>

          {slug && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
              <p className="text-xs text-neutral-500">{t('superAdmin.orgs.urlPreview')}</p>
              <p className="mt-0.5 font-mono text-sm text-neutral-700">
                nortiauno.com/<span className="font-semibold text-neutral-900">{slug}</span>/
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => void handleSubmit()}
              disabled={!isValid || submitting}
              className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {t('superAdmin.orgs.newOrg.submit')}
            </button>
            <a
              href="/super-admin/organizations"
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              {t('superAdmin.orgs.newOrg.cancel')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
