'use client';
export const dynamic = 'force-dynamic';

import { useState, useMemo, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, X, Loader2, Check,
  ChevronUp, ChevronDown, Search, XCircle,
  CheckCircle2, Warehouse, MapPin,
} from 'lucide-react';
import {
  useDeliveryDestinations,
  useCreateDeliveryDestination,
  useUpdateDeliveryDestination,
  useDeleteDeliveryDestination,
} from '@strawboss/api';
import type { DeliveryDestination } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

// ─── helpers ─────────────────────────────────────────────────────────────────

function normalize<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const r = raw as { data?: T[] } | null | undefined;
  return r?.data ?? [];
}

// ─── DepositFormModal ────────────────────────────────────────────────────────

interface DepositFormModalProps {
  deposit?: DeliveryDestination;
  onClose: () => void;
}

function DepositFormModal({ deposit, onClose }: DepositFormModalProps) {
  const { t } = useI18n();
  const isEdit = !!deposit;

  const [code, setCode] = useState(deposit?.code ?? '');
  const [name, setName] = useState(deposit?.name ?? '');
  const [address, setAddress] = useState(deposit?.address ?? '');
  const [contactName, setContactName] = useState(deposit?.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(deposit?.contactPhone ?? '');
  const [contactEmail, setContactEmail] = useState(deposit?.contactEmail ?? '');
  const [isActive, setIsActive] = useState(deposit?.isActive ?? true);
  const [error, setError] = useState('');

  const createDeposit = useCreateDeliveryDestination(apiClient);
  const updateDeposit = useUpdateDeliveryDestination(apiClient);
  const isPending = createDeposit.isPending || updateDeposit.isPending;

  const handleSubmit = useCallback(async () => {
    if (!code.trim() || !name.trim()) {
      setError(isEdit ? t('deposits.form.updateError') : t('deposits.form.createError'));
      return;
    }
    setError('');

    const payload = {
      code: code.trim(),
      name: name.trim(),
      address: address.trim(),
      contactName: contactName.trim() || null,
      contactPhone: contactPhone.trim() || null,
      contactEmail: contactEmail.trim() || null,
      ...(isEdit ? { isActive } : {}),
    };

    if (isEdit && deposit) {
      updateDeposit.mutate({ id: deposit.id, data: payload }, {
        onSuccess: onClose,
        onError: () => setError(t('deposits.form.updateError')),
      });
    } else {
      createDeposit.mutate(payload as Parameters<typeof createDeposit.mutate>[0], {
        onSuccess: onClose,
        onError: () => setError(t('deposits.form.createError')),
      });
    }
  }, [code, name, address, contactName, contactPhone, contactEmail, isActive, isEdit, deposit, createDeposit, updateDeposit, onClose, t]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        style={{ maxHeight: 'min(90vh, 700px)' }}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-800">
            {isEdit ? t('deposits.form.editTitle') : t('deposits.form.createTitle')}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Code + Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('deposits.form.code')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t('deposits.form.codePlaceholder')}
                autoFocus
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('deposits.form.name')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('deposits.form.namePlaceholder')}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              {t('deposits.form.address')}
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t('deposits.form.addressPlaceholder')}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Contact Name + Phone */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('deposits.form.contactName')}
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder={t('deposits.form.contactNamePlaceholder')}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('deposits.form.contactPhone')}
              </label>
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder={t('deposits.form.contactPhonePlaceholder')}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Contact Email */}
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              {t('deposits.form.contactEmail')}
            </label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder={t('deposits.form.contactEmailPlaceholder')}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Active toggle (edit only) */}
          {isEdit && (
            <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3">
              <span className="text-sm font-medium text-neutral-700">
                {t('deposits.form.activeDeposit')}
              </span>
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isActive ? 'bg-primary' : 'bg-neutral-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              <XCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
          >
            {t('deposits.cancel')}
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {isEdit ? t('deposits.save') : t('deposits.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DeleteDialog ─────────────────────────────────────────────────────────────

interface DeleteDialogProps {
  deposit: DeliveryDestination;
  onClose: () => void;
}

function DeleteDialog({ deposit, onClose }: DeleteDialogProps) {
  const { t } = useI18n();
  const deleteDeposit = useDeleteDeliveryDestination(apiClient);

  const handleDelete = useCallback(() => {
    deleteDeposit.mutate(deposit.id, { onSettled: onClose });
  }, [deposit.id, deleteDeposit, onClose]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-100">
          <Trash2 className="h-6 w-6 text-red-500" />
        </div>
        <h2 className="text-base font-semibold text-neutral-800">
          {t('deposits.delete')}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {t('deposits.deleteConfirm', { name: deposit.name })}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteDeposit.isPending}
            className="flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            {deleteDeposit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {t('deposits.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sort ─────────────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';
type DepositSortKey = 'code' | 'name' | 'address' | 'contactName' | 'isActive';

function ThSortIndicator({
  columnKey,
  sortKey,
  sortDir,
}: {
  columnKey: DepositSortKey;
  sortKey: DepositSortKey;
  sortDir: SortDir;
}) {
  const active = sortKey === columnKey;
  return (
    <span className="ml-1 inline-flex flex-col leading-[0.65]" aria-hidden>
      <ChevronUp
        className={`h-3 w-3 shrink-0 ${
          active && sortDir === 'asc' ? 'text-primary' : 'text-neutral-300'
        }`}
      />
      <ChevronDown
        className={`h-3 w-3 shrink-0 -mt-0.5 ${
          active && sortDir === 'desc' ? 'text-primary' : 'text-neutral-300'
        }`}
      />
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DepositsPage() {
  const { t } = useI18n();
  const { data: rawDeposits, isLoading } = useDeliveryDestinations(apiClient);

  const deposits = useMemo(() => normalize<DeliveryDestination>(rawDeposits), [rawDeposits]);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('');

  // Sort
  const [tableSort, setTableSort] = useState<{ key: DepositSortKey; dir: SortDir }>({
    key: 'code',
    dir: 'asc',
  });

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [editDeposit, setEditDeposit] = useState<DeliveryDestination | null>(null);
  const [deleteDeposit, setDeleteDeposit] = useState<DeliveryDestination | null>(null);

  const handleSort = useCallback((key: DepositSortKey) => {
    setTableSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  }, []);

  // Filtered + sorted
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = deposits.filter((d) => {
      if (q && ![d.name, d.code, d.address, d.contactName].some((v) => v?.toLowerCase().includes(q))) return false;
      if (statusFilter === 'active' && !d.isActive) return false;
      if (statusFilter === 'inactive' && d.isActive) return false;
      return true;
    });

    const { key: sortKey, dir: sortDir } = tableSort;

    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'isActive') {
        cmp = (a.isActive ? 1 : 0) - (b.isActive ? 1 : 0);
      } else {
        const sa = (a[sortKey] ?? '') as string;
        const sb = (b[sortKey] ?? '') as string;
        cmp = sa.localeCompare(sb, 'ro', { sensitivity: 'base' });
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [deposits, search, statusFilter, tableSort]);

  // Stats
  const stats = useMemo(() => ({
    total: deposits.length,
    active: deposits.filter((d) => d.isActive).length,
    withBoundary: deposits.filter((d) => d.boundary).length,
  }), [deposits]);

  const thClass =
    'cursor-pointer select-none px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-700 whitespace-nowrap';

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* Header */}
      <PageHeader
        title={t('deposits.title')}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('deposits.newDeposit')}
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-primary">
            <Warehouse className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-bold text-neutral-900 leading-none">{stats.total}</p>
            <p className="mt-0.5 text-xs text-neutral-500">{t('deposits.title')}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-bold text-neutral-900 leading-none">{stats.active}</p>
            <p className="mt-0.5 text-xs text-neutral-500">{t('deposits.active')}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-blue-600">
            <MapPin className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-bold text-neutral-900 leading-none">{stats.withBoundary}</p>
            <p className="mt-0.5 text-xs text-neutral-500">{t('deposits.hasBoundary')}</p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('deposits.searchPlaceholder')}
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as '' | 'active' | 'inactive')}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">{t('deposits.filterAllStatuses')}</option>
          <option value="active">{t('deposits.filterActive')}</option>
          <option value="inactive">{t('deposits.filterInactive')}</option>
        </select>

        {(search || statusFilter) && (
          <button
            onClick={() => { setSearch(''); setStatusFilter(''); }}
            className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-500 hover:bg-neutral-50"
          >
            <X className="h-3 w-3" />
            {t('deposits.all')}
          </button>
        )}

        <span className="ml-auto text-xs text-neutral-400">
          {filtered.length} {t('deposits.title').toLowerCase()}
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-neutral-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          {t('deposits.loading')}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-20 text-neutral-400">
          <Search className="h-10 w-10 mb-3 opacity-20" />
          <p className="text-sm font-medium">
            {(search || statusFilter) ? t('deposits.emptyFiltered') : t('deposits.empty')}
          </p>
          {(search || statusFilter) ? (
            <button
              onClick={() => { setSearch(''); setStatusFilter(''); }}
              className="mt-2 text-xs text-primary hover:underline"
            >
              {t('deposits.all')}
            </button>
          ) : (
            <div>
              <p className="text-xs mt-1">{t('deposits.emptyHint')}</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-3 flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs hover:border-primary hover:text-primary mx-auto"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('deposits.newDeposit')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                {([
                  { key: 'code' as const, label: t('deposits.code') },
                  { key: 'name' as const, label: t('deposits.name') },
                  { key: 'address' as const, label: t('deposits.address') },
                  { key: 'contactName' as const, label: t('deposits.contactName') },
                  { key: 'isActive' as const, label: t('deposits.status') },
                ]).map(({ key, label }) => (
                  <th
                    key={key}
                    className={thClass}
                    onClick={() => handleSort(key)}
                  >
                    <div className="flex items-center">
                      {label}
                      <ThSortIndicator columnKey={key} sortKey={tableSort.key} sortDir={tableSort.dir} />
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('deposits.hasBoundary')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtered.map((d) => (
                <tr key={d.id} className="hover:bg-neutral-50/60 transition-colors">
                  {/* Code */}
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs bg-neutral-100 px-2 py-0.5 rounded font-medium text-neutral-700">
                      {d.code}
                    </span>
                  </td>

                  {/* Name */}
                  <td className="px-4 py-3 max-w-[180px]">
                    <p className="truncate font-medium text-neutral-800">{d.name}</p>
                  </td>

                  {/* Address */}
                  <td className="px-4 py-3 max-w-[200px]">
                    {d.address ? (
                      <span className="flex items-center gap-1 text-xs text-neutral-600">
                        <MapPin className="h-3 w-3 text-neutral-400 flex-shrink-0" />
                        <span className="truncate">{d.address}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-300">&mdash;</span>
                    )}
                  </td>

                  {/* Contact */}
                  <td className="px-4 py-3 max-w-[160px]">
                    {d.contactName ? (
                      <div>
                        <p className="truncate text-sm text-neutral-700">{d.contactName}</p>
                        {d.contactPhone && (
                          <p className="text-xs text-neutral-400 mt-0.5">{d.contactPhone}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-300">&mdash;</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    {d.isActive ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        {t('common.active')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-neutral-400" />
                        {t('common.inactive')}
                      </span>
                    )}
                  </td>

                  {/* Has Boundary */}
                  <td className="px-4 py-3 text-center">
                    {d.boundary ? (
                      <CheckCircle2 className="h-4 w-4 text-blue-500 mx-auto" />
                    ) : (
                      <span className="text-xs text-neutral-300">&mdash;</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditDeposit(d)}
                        className="rounded-lg p-1.5 text-neutral-400 hover:bg-primary/10 hover:text-primary transition-colors"
                        title={t('common.edit')}
                        aria-label={t('common.edit')}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteDeposit(d)}
                        className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                        title={t('common.delete')}
                        aria-label={t('common.delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <DepositFormModal onClose={() => setShowCreate(false)} />
      )}
      {editDeposit && (
        <DepositFormModal deposit={editDeposit} onClose={() => setEditDeposit(null)} />
      )}
      {deleteDeposit && (
        <DeleteDialog deposit={deleteDeposit} onClose={() => setDeleteDeposit(null)} />
      )}
    </div>
  );
}
