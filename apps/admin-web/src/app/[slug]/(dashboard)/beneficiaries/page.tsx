'use client';
export const dynamic = 'force-dynamic';

import { useState, useMemo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Building2,
  RefreshCw,
  Copy,
  Check,
  Pencil,
  Trash2,
  XCircle,
  Loader2,
  Power,
  PowerOff,
} from 'lucide-react';
import {
  useBeneficiaries,
  useCreateBeneficiary,
  useUpdateBeneficiary,
  useDeleteBeneficiary,
  useRegenBeneficiaryPin,
} from '@strawboss/api';
import type { Beneficiary } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { cn } from '@/lib/utils';
import { LoggingErrorBoundary } from '@/components/shared/LoggingErrorBoundary';

// ── Shared UI atoms ────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

// ── Add / Edit modal ───────────────────────────────────────────────────────

type BeneficiaryFormData = {
  displayName: string;
  slug: string;
  companyName: string;
  companyAddress: string;
  companyCui: string;
};

const BLANK_FORM: BeneficiaryFormData = {
  displayName: '',
  slug: '',
  companyName: '',
  companyAddress: '',
  companyCui: '',
};

function BeneficiaryModal({
  editing,
  onClose,
}: {
  editing: Beneficiary | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const isEdit = !!editing;

  const [form, setForm] = useState<BeneficiaryFormData>(
    editing
      ? {
          displayName: editing.displayName,
          slug: editing.slug,
          companyName: editing.companyName,
          companyAddress: editing.companyAddress ?? '',
          companyCui: editing.companyCui ?? '',
        }
      : BLANK_FORM,
  );

  const patch = (p: Partial<BeneficiaryFormData>) => setForm((s) => ({ ...s, ...p }));

  const create = useCreateBeneficiary(apiClient);
  const update = useUpdateBeneficiary(apiClient);

  const isPending = create.isPending || update.isPending;
  const isError = create.isError || update.isError;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trim = (s: string) => s.trim();
    const payload = {
      displayName: trim(form.displayName),
      slug: trim(form.slug),
      companyName: trim(form.companyName),
      companyAddress: trim(form.companyAddress) || undefined,
      companyCui: trim(form.companyCui) || undefined,
    };

    if (isEdit) {
      const { slug: _slug, ...data } = payload;
      update.mutate({ id: editing.id, data }, { onSuccess: () => onClose() });
    } else {
      create.mutate(payload, { onSuccess: () => onClose() });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
            <Building2 className="h-5 w-5 text-primary" />
            {isEdit ? t('beneficiaries.editTitle') : t('beneficiaries.formTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div>
            <label className="block text-sm font-medium text-neutral-700">
              {t('beneficiaries.displayNameLabel')}
              <span className="ml-0.5 text-rose-500">*</span>
            </label>
            <input
              required
              value={form.displayName}
              onChange={(e) => patch({ displayName: e.target.value })}
              className={cn(inputCls, 'mt-1')}
            />
          </div>

          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-neutral-700">
                {t('beneficiaries.slugLabel')}
                <span className="ml-0.5 text-rose-500">*</span>
              </label>
              <p className="mb-1 text-xs text-neutral-500">{t('beneficiaries.slugHint')}</p>
              <input
                required
                placeholder={t('beneficiaries.slugPlaceholder')}
                value={form.slug}
                onChange={(e) => patch({ slug: e.target.value })}
                className={inputCls}
                pattern="[a-z0-9-]+"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-neutral-700">
              {t('beneficiaries.companyNameLabel')}
              <span className="ml-0.5 text-rose-500">*</span>
            </label>
            <input
              required
              value={form.companyName}
              onChange={(e) => patch({ companyName: e.target.value })}
              className={cn(inputCls, 'mt-1')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700">
              {t('beneficiaries.companyAddressLabel')}
            </label>
            <input
              value={form.companyAddress}
              onChange={(e) => patch({ companyAddress: e.target.value })}
              className={cn(inputCls, 'mt-1')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700">
              {t('beneficiaries.companyCuiLabel')}
            </label>
            <input
              value={form.companyCui}
              onChange={(e) => patch({ companyCui: e.target.value })}
              className={cn(inputCls, 'mt-1')}
            />
          </div>

          {isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {t('beneficiaries.saveError')}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete confirm modal ───────────────────────────────────────────────────

function DeleteModal({ beneficiary, onClose }: { beneficiary: Beneficiary; onClose: () => void }) {
  const { t } = useI18n();
  const del = useDeleteBeneficiary(apiClient);

  function handleDelete() {
    del.mutate(beneficiary.id, { onSuccess: () => onClose() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
            <Trash2 className="h-5 w-5 text-red-500" />
            {t('beneficiaries.deleteTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-sm text-neutral-700">
            {t('beneficiaries.deleteConfirm').replace('{name}', beneficiary.displayName)}
          </p>

          {del.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {t('beneficiaries.deleteError')}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={del.isPending}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('beneficiaries.deleteButton')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Copy link button ───────────────────────────────────────────────────────

function CopyLinkButton({ url }: { url: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={url}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
        copied
          ? 'border-green-200 bg-green-50 text-green-700'
          : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100',
      )}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" />
          {t('beneficiaries.copied')}
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          {t('beneficiaries.copyLink')}
        </>
      )}
    </button>
  );
}

// ── Regen PIN button ───────────────────────────────────────────────────────

function RegenPinButton({ beneficiaryId }: { beneficiaryId: string }) {
  const { t } = useI18n();
  const regen = useRegenBeneficiaryPin(apiClient);

  function handleRegen(e: React.MouseEvent) {
    e.stopPropagation();
    regen.mutate(beneficiaryId);
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={handleRegen}
        title={t('beneficiaries.regenPin')}
        disabled={regen.isPending}
        className="rounded-lg border border-neutral-200 p-1.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', regen.isPending && 'animate-spin')} />
      </button>
      {regen.isError && (
        <span title={t('beneficiaries.regenError')} className="text-red-500">
          <XCircle className="h-3.5 w-3.5" />
        </span>
      )}
    </span>
  );
}

// ── Active toggle ──────────────────────────────────────────────────────────

function ActiveToggle({ beneficiary }: { beneficiary: Beneficiary }) {
  const { t } = useI18n();
  const update = useUpdateBeneficiary(apiClient);

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    update.mutate({ id: beneficiary.id, data: { isActive: !beneficiary.isActive } });
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      title={beneficiary.isActive ? t('beneficiaries.deactivate') : t('beneficiaries.activate')}
      disabled={update.isPending}
      className={cn(
        'rounded-lg border p-1.5 disabled:opacity-50',
        beneficiary.isActive
          ? 'border-green-200 text-green-600 hover:bg-green-50'
          : 'border-neutral-200 text-neutral-400 hover:bg-neutral-100',
      )}
    >
      {beneficiary.isActive ? (
        <Power className="h-3.5 w-3.5" />
      ) : (
        <PowerOff className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function BeneficiariesPage() {
  const { t } = useI18n();
  const params = useParams<{ slug: string }>();
  const orgSlug = params.slug;
  const portalBase =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
    (typeof window !== 'undefined' ? window.location.origin : 'https://nortiauno.com');

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Beneficiary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Beneficiary | null>(null);

  const { data: rawData, isLoading, isError } = useBeneficiaries(apiClient);
  const beneficiaries = useMemo(() => normalizeList<Beneficiary>(rawData), [rawData]);

  const openAdd = useCallback(() => {
    setEditTarget(null);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((b: Beneficiary) => {
    setEditTarget(b);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditTarget(null);
  }, []);

  return (
    <LoggingErrorBoundary>
      <div className="space-y-5">
        <PageHeader
          title={t('beneficiaries.title')}
          actions={
            <button
              type="button"
              onClick={openAdd}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              <Building2 className="h-4 w-4" />
              {t('beneficiaries.addButton')}
            </button>
          }
        />

        <p className="text-sm text-neutral-500">{t('beneficiaries.subtitle')}</p>

        {/* Loading / error */}
        {isLoading && (
          <div className="flex items-center gap-2 py-12 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        )}
        {isError && (
          <div className="py-8 text-center text-sm text-red-500">{t('common.error')}</div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && beneficiaries.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-200 py-16 text-neutral-400">
            <Building2 className="mb-2 h-8 w-8" />
            <p className="text-sm font-medium text-neutral-600">{t('beneficiaries.emptyTitle')}</p>
            <p className="mt-1 text-xs">{t('beneficiaries.emptyBody')}</p>
          </div>
        )}

        {/* Table */}
        {!isLoading && !isError && beneficiaries.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                  <th className="px-4 py-3">{t('beneficiaries.colName')}</th>
                  <th className="px-4 py-3">{t('beneficiaries.colCompany')}</th>
                  <th className="px-4 py-3">{t('beneficiaries.colCui')}</th>
                  <th className="px-4 py-3">{t('beneficiaries.colSlug')}</th>
                  <th className="px-4 py-3">{t('beneficiaries.colPin')}</th>
                  <th className="px-4 py-3">{t('beneficiaries.colLink')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {beneficiaries.map((b) => {
                  const portalUrl = `${portalBase}/${orgSlug}/request/${b.slug}`;
                  return (
                    <tr
                      key={b.id}
                      className={cn(
                        'border-b border-neutral-100 hover:bg-neutral-50',
                        !b.isActive && 'opacity-50',
                      )}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-neutral-800">{b.displayName}</p>
                      </td>
                      <td className="px-4 py-3 text-neutral-600">{b.companyName}</td>
                      <td className="px-4 py-3 text-neutral-500">
                        {b.companyCui ?? <span className="text-neutral-300">&mdash;</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-neutral-500">{b.slug}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold tracking-[0.25em] text-primary">
                            {b.dailyPin}
                          </span>
                          <RegenPinButton beneficiaryId={b.id} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <CopyLinkButton url={portalUrl} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <ActiveToggle beneficiary={b} />
                          <button
                            type="button"
                            onClick={() => openEdit(b)}
                            title={t('common.edit')}
                            className="rounded-lg border border-neutral-200 p-1.5 text-neutral-500 hover:bg-neutral-100"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(b)}
                            title={t('common.delete')}
                            className="rounded-lg border border-red-100 p-1.5 text-red-400 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Modals */}
        {modalOpen && <BeneficiaryModal editing={editTarget} onClose={closeModal} />}
        {deleteTarget && (
          <DeleteModal beneficiary={deleteTarget} onClose={() => setDeleteTarget(null)} />
        )}
      </div>
    </LoggingErrorBoundary>
  );
}
