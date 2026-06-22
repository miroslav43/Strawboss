'use client';
export const dynamic = 'force-dynamic';

import { useRef, useState } from 'react';
import {
  ArrowLeft,
  Upload,
  PackageOpen,
  Loader2,
  CheckCircle2,
  Archive,
  FileUp,
  XCircle,
} from 'lucide-react';
import { useReleases, useUploadRelease, useUpdateRelease } from '@strawboss/api';
import type { AppRelease } from '@strawboss/types';
import { ReleaseStatus } from '@strawboss/types';
import type { UpdateReleaseInput } from '@strawboss/validation';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

// ── Shared atoms ──────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-700';

const submitBtnCls =
  'flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium ' +
  'text-white hover:bg-neutral-700 disabled:opacity-60';

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ── Release status badge ──────────────────────────────────────────────────────

const STATUS_STYLES: Record<ReleaseStatus, string> = {
  [ReleaseStatus.draft]: 'bg-neutral-100 text-neutral-600',
  [ReleaseStatus.published]: 'bg-green-100 text-green-700',
  [ReleaseStatus.archived]: 'bg-neutral-200 text-neutral-500',
};

function ReleaseStatusBadge({ status }: { status: ReleaseStatus }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {t(`superAdmin.devices.releaseStatus.${status}`)}
    </span>
  );
}

// ── Upload form ───────────────────────────────────────────────────────────────

function UploadReleaseForm() {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState('');
  const [versionCode, setVersionCode] = useState('');
  const [changelog, setChangelog] = useState('');
  const [mandatory, setMandatory] = useState(false);
  const [fileName, setFileName] = useState('');
  const [success, setSuccess] = useState(false);

  const upload = useUploadRelease(apiClient);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    const fd = new FormData();
    fd.append('apk', file);
    fd.append('version', version);
    fd.append('versionCode', versionCode);
    if (changelog) fd.append('changelog', changelog);
    fd.append('mandatory', String(mandatory));

    upload.mutate(fd, {
      onSuccess: () => {
        setVersion('');
        setVersionCode('');
        setChangelog('');
        setMandatory(false);
        setFileName('');
        if (fileRef.current) fileRef.current.value = '';
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      },
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-base font-semibold text-neutral-800">
        {t('superAdmin.devices.releases.uploadTitle')}
      </h2>

      {/* APK file picker */}
      <FormField label={t('superAdmin.devices.releases.apkLabel')} required>
        <div
          className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-neutral-300 px-4 py-5 hover:border-neutral-500"
          onClick={() => fileRef.current?.click()}
        >
          <FileUp className="h-6 w-6 text-neutral-400" />
          <div>
            {fileName ? (
              <p className="text-sm font-medium text-neutral-700">{fileName}</p>
            ) : (
              <p className="text-sm text-neutral-400">
                {t('superAdmin.devices.releases.apkPlaceholder')}
              </p>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          className="hidden"
          required
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('superAdmin.devices.releases.versionLabel')} required>
          <input
            required
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className={inputCls}
            placeholder="1.0.0"
          />
        </FormField>
        <FormField label={t('superAdmin.devices.releases.versionCodeLabel')} required>
          <input
            required
            type="number"
            min="1"
            value={versionCode}
            onChange={(e) => setVersionCode(e.target.value)}
            className={inputCls}
            placeholder="100"
          />
        </FormField>
      </div>

      <FormField label={t('superAdmin.devices.releases.changelogLabel')}>
        <textarea
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
          className={`${inputCls} resize-none`}
          rows={3}
          placeholder={t('superAdmin.devices.releases.changelogPlaceholder')}
        />
      </FormField>

      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={mandatory}
          onChange={(e) => setMandatory(e.target.checked)}
          className="accent-neutral-800"
        />
        <span className="text-sm text-neutral-700">
          {t('superAdmin.devices.releases.mandatoryLabel')}
        </span>
      </label>

      {upload.isError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {(upload.error as Error)?.message ?? t('common.error')}
        </p>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" />
          {t('superAdmin.devices.releases.uploadSuccess')}
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={upload.isPending || !fileName} className={submitBtnCls}>
          <Upload className="h-4 w-4" />
          {upload.isPending
            ? t('superAdmin.devices.releases.uploading')
            : t('superAdmin.devices.releases.uploadButton')}
        </button>
      </div>
    </form>
  );
}

// ── Release row actions ───────────────────────────────────────────────────────

function ReleaseActions({ release }: { release: AppRelease }) {
  const { t } = useI18n();
  const update = useUpdateRelease(apiClient);

  const setStatus = (status: ReleaseStatus) => {
    const data: UpdateReleaseInput = { status };
    update.mutate({ id: release.id, data });
  };

  return (
    <div className="flex items-center gap-1">
      {release.status === ReleaseStatus.draft && (
        <button
          type="button"
          onClick={() => setStatus(ReleaseStatus.published)}
          disabled={update.isPending}
          className="flex items-center gap-1 rounded-md border border-green-300 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-60"
          title={t('superAdmin.devices.releases.publishTitle')}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t('superAdmin.devices.releases.publishButton')}
        </button>
      )}
      {release.status === ReleaseStatus.published && (
        <button
          type="button"
          onClick={() => setStatus(ReleaseStatus.archived)}
          disabled={update.isPending}
          className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-60"
          title={t('superAdmin.devices.releases.archiveTitle')}
        >
          <Archive className="h-3.5 w-3.5" />
          {t('superAdmin.devices.releases.archiveButton')}
        </button>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReleasesPage() {
  const { t } = useI18n();
  const { data: releasesRaw, isLoading, isError, error } = useReleases(apiClient);
  const releases: AppRelease[] = Array.isArray(releasesRaw) ? releasesRaw : [];

  return (
    <div className="space-y-6">
      {/* Breadcrumb + header */}
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <a
          href="/super-admin/devices"
          className="inline-flex items-center gap-1 hover:text-neutral-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('superAdmin.devices.navLabel')}
        </a>
        <span className="text-neutral-300">/</span>
        <span className="font-medium text-neutral-800">
          {t('superAdmin.devices.releases.title')}
        </span>
      </div>

      <div>
        <h1 className="text-xl font-bold text-neutral-800">
          {t('superAdmin.devices.releases.title')}
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          {t('superAdmin.devices.releases.subtitle')}
        </p>
      </div>

      {/* Upload form */}
      <UploadReleaseForm />

      {/* Release list */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-400">
          {t('superAdmin.devices.releases.listTitle')}
        </h2>

        {isLoading && (
          <div className="flex items-center justify-center py-12 text-neutral-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {t('common.loading')}
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {(error as Error)?.message ?? t('common.error')}
          </div>
        )}

        {!isLoading && !isError && releases.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
            <PackageOpen className="mb-3 h-10 w-10 opacity-20" />
            <p className="text-sm">{t('superAdmin.devices.releases.empty')}</p>
          </div>
        )}

        {!isLoading && !isError && releases.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-100 bg-neutral-50">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                  <th className="px-4 py-3">{t('superAdmin.devices.releases.col.version')}</th>
                  <th className="px-4 py-3">{t('superAdmin.devices.releases.col.status')}</th>
                  <th className="px-4 py-3">{t('superAdmin.devices.releases.col.mandatory')}</th>
                  <th className="px-4 py-3">{t('superAdmin.devices.releases.col.size')}</th>
                  <th className="px-4 py-3">{t('superAdmin.devices.releases.col.changelog')}</th>
                  <th className="px-4 py-3">{t('superAdmin.devices.releases.col.uploaded')}</th>
                  <th className="px-4 py-3 text-right">
                    {t('superAdmin.devices.releases.col.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {releases.map((r) => (
                  <tr key={r.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-neutral-800">{r.version}</p>
                      <p className="text-xs text-neutral-400">v{r.versionCode}</p>
                    </td>
                    <td className="px-4 py-3">
                      <ReleaseStatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3">
                      {r.mandatory ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {t('superAdmin.devices.releases.mandatory')}
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-400">
                          {t('superAdmin.devices.releases.optional')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      {r.sizeBytes ? `${(r.sizeBytes / 1_048_576).toFixed(1)} MB` : '—'}
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      {r.changelog ? (
                        <p className="truncate text-xs text-neutral-600">{r.changelog}</p>
                      ) : (
                        <span className="text-xs text-neutral-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-400">
                      {new Date(r.createdAt).toLocaleDateString('ro-RO')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ReleaseActions release={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
