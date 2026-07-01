'use client';

import { useMemo, useState } from 'react';
import {
  Fuel,
  Plus,
  Pencil,
  Trash2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import {
  useFuelLogsList,
  useAdminUsers,
  useProfile,
  useCreateFuelLog,
  useUpdateFuelLog,
  useDeleteFuelLog,
} from '@strawboss/api';
import type { Machine, User } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { romaniaDateString, addDays } from '@/lib/date';

// ── Raw backend row (snake_case; the `SELECT *` endpoint does not camelCase) ──
interface FuelLogRow {
  id: string;
  machine_id: string | null;
  operator_id: string | null;
  parcel_id: string | null;
  logged_at: string;
  fuel_type: string | null;
  quantity_liters: string | number;
  is_full_tank: boolean | null;
  notes: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * "YYYY-MM-DD" of `iso` anchored to Romania's timezone. Chart bucketing uses
 * this (not the browser's local calendar) so bars line up with the month picker,
 * whose value comes from `romaniaDateString()` — otherwise a refuel in the last
 * few UTC hours of a month would fall inside the fetched range yet bucket into
 * the next day and silently vanish from the chart.
 */
function roYmd(iso: string): string {
  return romaniaDateString(new Date(iso));
}

/** Current local datetime as an `<input type="datetime-local">` value. */
function nowLocalInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** ISO → `<input type="datetime-local">` value (local time). */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Inclusive ISO range for a "YYYY-MM" month, matching the backend filter
 * (`logged_at >= dateFrom AND logged_at <= dateTo`). Boundaries are UTC `Z`,
 * the same convention as the fuel-logs list page — a refuel logged in the first
 * or last ~3h of a month (Romania is UTC+2/+3) may land in the adjacent month.
 */
function monthRange(month: string): { dateFrom: string; dateTo: string } {
  const [y, m] = month.split('-').map(Number);
  const firstOfNext = m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`;
  const lastDay = addDays(firstOfNext, -1);
  return { dateFrom: `${month}-01T00:00:00Z`, dateTo: `${lastDay}T23:59:59Z` };
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`;
}

// ── Shared UI atoms (mirrored from machines/page.tsx — file-local by convention) ─

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
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

function ErrorBanner({ message }: { message?: string }) {
  const { t } = useI18n();
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
      {message ?? t('machines.errorFallback')}
    </p>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
            <Fuel className="h-5 w-5 text-primary" />
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({
  onCancel,
  submitLabel,
  disabled,
}: {
  onCancel: () => void;
  submitLabel: string;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex justify-end gap-3 pt-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
      >
        {t('common.cancel')}
      </button>
      <button
        type="submit"
        disabled={disabled}
        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
      >
        {submitLabel}
      </button>
    </div>
  );
}

// ── Simple liters bar chart ─────────────────────────────────────────────────

function LitersBarChart({
  title,
  bars,
}: {
  title: string;
  bars: { key: string; label: string; value: number; title: string }[];
}) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div>
      <h4 className="mb-2 text-xs font-medium text-neutral-500">{title}</h4>
      <div className="flex h-20 items-end gap-px">
        {bars.map((b) => {
          const heightPct = b.value > 0 ? (b.value / max) * 100 : 0;
          return (
            <div key={b.key} className="flex flex-1 flex-col items-center" title={b.title}>
              <div
                className="w-full rounded-t"
                style={{
                  height: `${Math.max(heightPct, b.value > 0 ? 6 : 2)}%`,
                  backgroundColor: b.value > 0 ? 'var(--color-primary, #16a34a)' : '#eef0f2',
                }}
              />
              <span className="mt-0.5 text-[9px] leading-none text-neutral-400">{b.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Add / Edit form state ───────────────────────────────────────────────────

interface FuelFormState {
  loggedAt: string; // datetime-local value
  quantityLiters: string;
  isFullTank: boolean;
  notes: string;
}

// ── Card ────────────────────────────────────────────────────────────────────

export function FuelConsumptionCard({
  machineId,
  machine,
}: {
  machineId: string;
  machine: Machine;
}) {
  const { t } = useI18n();

  const [mode, setMode] = useState<'month' | 'all'>('month');
  const [month, setMonth] = useState<string>(() => romaniaDateString().slice(0, 7));

  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<FuelLogRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FuelLogRow | null>(null);

  const { data: profile } = useProfile(apiClient);
  const isAdmin = profile?.role === 'admin';

  const range = mode === 'month' ? monthRange(month) : { dateFrom: undefined, dateTo: undefined };
  const logsQuery = useFuelLogsList(apiClient, { machineId, ...range });
  const rows = useMemo(() => normalizeList<FuelLogRow>(logsQuery.data), [logsQuery.data]);

  const usersQuery = useAdminUsers(apiClient);
  const userMap = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of normalizeList<User>(usersQuery.data)) map.set(u.id, u);
    return map;
  }, [usersQuery.data]);

  const totalLiters = useMemo(
    () => rows.reduce((sum, r) => sum + toNumber(r.quantity_liters), 0),
    [rows],
  );

  const chart = useMemo(() => {
    const litersByKey = new Map<string, number>();
    if (mode === 'month') {
      for (const r of rows) {
        const k = roYmd(r.logged_at);
        litersByKey.set(k, (litersByKey.get(k) ?? 0) + toNumber(r.quantity_liters));
      }
      const [y, m] = month.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const bars = Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const key = `${month}-${pad2(day)}`;
        const value = litersByKey.get(key) ?? 0;
        // Keep the axis readable: label only 1, mid, last.
        const label =
          day === 1 || day === daysInMonth || day === Math.ceil(daysInMonth / 2) ? String(day) : '';
        return { key, label, value, title: `${key}: ${value.toLocaleString()} L` };
      });
      return { title: t('machineDetail.fuelChartByDay'), bars };
    }
    for (const r of rows) {
      const k = roYmd(r.logged_at).slice(0, 7);
      litersByKey.set(k, (litersByKey.get(k) ?? 0) + toNumber(r.quantity_liters));
    }
    const keys = Array.from(litersByKey.keys()).sort();
    const bars = keys.map((key) => {
      const [yy, mm] = key.split('-');
      return {
        key,
        label: `${mm}/${yy.slice(2)}`,
        value: litersByKey.get(key) ?? 0,
        title: `${key}: ${(litersByKey.get(key) ?? 0).toLocaleString()} L`,
      };
    });
    return { title: t('machineDetail.fuelChartByMonth'), bars };
  }, [rows, mode, month, t]);

  const operatorName = (id: string | null): string => {
    if (!id) return '—';
    return userMap.get(id)?.fullName ?? id.slice(0, 8);
  };

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      {/* Header + period controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
          <Fuel className="h-4 w-4" />
          {t('machineDetail.fuelSection')}
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, -1))}
            disabled={mode === 'all'}
            aria-label={t('machineDetail.fuelPrevMonth')}
            className="rounded-md border border-neutral-200 p-1 text-neutral-500 hover:bg-neutral-50 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setMode('month');
            }}
            disabled={mode === 'all'}
            className="rounded-lg border border-neutral-200 px-2 py-1 text-xs text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40"
          />
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={mode === 'all'}
            aria-label={t('machineDetail.fuelNextMonth')}
            className="rounded-md border border-neutral-200 p-1 text-neutral-500 hover:bg-neutral-50 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setMode((prev) => (prev === 'all' ? 'month' : 'all'))}
            className={`rounded-lg border px-2 py-1 text-xs font-medium ${
              mode === 'all'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            {t('machineDetail.fuelAllTime')}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-white hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('machineDetail.fuelAddEntry')}
            </button>
          )}
        </div>
      </div>

      {logsQuery.isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-neutral-100" />
      ) : (
        <>
          {/* Total */}
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-lg bg-amber-50 p-2">
              <Fuel className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-neutral-800">
                {totalLiters.toLocaleString()} L
              </p>
              <p className="text-xs text-neutral-400">
                {t('machineDetail.fuelEntries', { count: rows.length })}
              </p>
            </div>
          </div>

          {/* Chart */}
          {rows.length > 0 && (
            <div className="mb-4">
              <LitersBarChart title={chart.title} bars={chart.bars} />
            </div>
          )}

          {/* Entry list */}
          {rows.length === 0 ? (
            <p className="text-sm text-neutral-400">{t('machineDetail.noFuelLogs')}</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
                >
                  <div className="min-w-0">
                    <span className="text-neutral-700">
                      {new Date(row.logged_at).toLocaleDateString()}
                    </span>
                    <span className="ml-2 truncate text-neutral-400">
                      {operatorName(row.operator_id)}
                    </span>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {row.is_full_tank && (
                      <span className="rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600">
                        {t('machineDetail.fuelFullTank')}
                      </span>
                    )}
                    <span className="font-medium text-neutral-800">
                      {toNumber(row.quantity_liters).toLocaleString()} L
                    </span>
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditTarget(row)}
                          aria-label={t('machineDetail.fuelEditTooltip')}
                          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(row)}
                          aria-label={t('machineDetail.fuelDeleteTooltip')}
                          className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {showAdd && profile && (
        <AddFuelModal
          machineId={machineId}
          machine={machine}
          operatorId={profile.id}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editTarget && <EditFuelModal row={editTarget} onClose={() => setEditTarget(null)} />}
      {deleteTarget && (
        <DeleteFuelDialog row={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}

// ── Add modal ───────────────────────────────────────────────────────────────

function AddFuelModal({
  machineId,
  machine,
  operatorId,
  onClose,
}: {
  machineId: string;
  machine: Machine;
  operatorId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const create = useCreateFuelLog(apiClient);
  const [form, setForm] = useState<FuelFormState>({
    loggedAt: nowLocalInput(),
    quantityLiters: '',
    isFullTank: false,
    notes: '',
  });
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const liters = Number(form.quantityLiters);
    if (!(liters > 0)) {
      setLocalError(t('machineDetail.fuelLitersRequired'));
      return;
    }
    create.mutate(
      {
        machineId,
        operatorId,
        loggedAt: new Date(form.loggedAt).toISOString(),
        fuelType: machine.fuelType,
        quantityLiters: liters,
        isFullTank: form.isFullTank,
        notes: form.notes.trim() || null,
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <ModalShell title={t('machineDetail.fuelModalAddTitle')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <FuelFields form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
        {(localError || create.isError) && (
          <ErrorBanner message={localError ?? (create.error as Error)?.message} />
        )}
        <ModalFooter
          onCancel={onClose}
          disabled={create.isPending}
          submitLabel={
            create.isPending ? t('machineDetail.fuelSaving') : t('machineDetail.fuelSubmitAdd')
          }
        />
      </form>
    </ModalShell>
  );
}

// ── Edit modal ──────────────────────────────────────────────────────────────

function EditFuelModal({ row, onClose }: { row: FuelLogRow; onClose: () => void }) {
  const { t } = useI18n();
  const update = useUpdateFuelLog(apiClient);
  const [form, setForm] = useState<FuelFormState>({
    loggedAt: isoToLocalInput(row.logged_at),
    quantityLiters: String(toNumber(row.quantity_liters)),
    isFullTank: !!row.is_full_tank,
    notes: row.notes ?? '',
  });
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const liters = Number(form.quantityLiters);
    if (!(liters > 0)) {
      setLocalError(t('machineDetail.fuelLitersRequired'));
      return;
    }
    update.mutate(
      {
        id: row.id,
        data: {
          loggedAt: new Date(form.loggedAt).toISOString(),
          quantityLiters: liters,
          isFullTank: form.isFullTank,
          notes: form.notes.trim() || null,
        },
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <ModalShell title={t('machineDetail.fuelModalEditTitle')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <FuelFields form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
        {(localError || update.isError) && (
          <ErrorBanner message={localError ?? (update.error as Error)?.message} />
        )}
        <ModalFooter
          onCancel={onClose}
          disabled={update.isPending}
          submitLabel={
            update.isPending ? t('machineDetail.fuelSaving') : t('machineDetail.fuelSubmitEdit')
          }
        />
      </form>
    </ModalShell>
  );
}

// ── Shared fuel fields (liters-focused; no price) ───────────────────────────

function FuelFields({
  form,
  onChange,
}: {
  form: FuelFormState;
  onChange: (patch: Partial<FuelFormState>) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t('machineDetail.fuelDate')} required>
        <input
          type="datetime-local"
          value={form.loggedAt}
          onChange={(e) => onChange({ loggedAt: e.target.value })}
          className={inputCls}
          required
        />
      </Field>
      <Field label={t('machineDetail.fuelLiters')} required>
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={form.quantityLiters}
          onChange={(e) => onChange({ quantityLiters: e.target.value })}
          className={inputCls}
          required
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={form.isFullTank}
          onChange={(e) => onChange({ isFullTank: e.target.checked })}
          className="h-4 w-4 rounded border-neutral-300 text-primary focus:ring-primary"
        />
        {t('machineDetail.fuelFullTank')}
      </label>
      <Field label={t('machineDetail.fuelNotes')}>
        <textarea
          value={form.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          rows={2}
          className={inputCls}
        />
      </Field>
    </>
  );
}

// ── Delete dialog ───────────────────────────────────────────────────────────

function DeleteFuelDialog({ row, onClose }: { row: FuelLogRow; onClose: () => void }) {
  const { t } = useI18n();
  const del = useDeleteFuelLog(apiClient);
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
        <div className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-full bg-red-100 p-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="font-semibold text-neutral-800">{t('machineDetail.fuelDeleteTitle')}</p>
              <p className="text-sm text-neutral-500">
                {new Date(row.logged_at).toLocaleDateString()} ·{' '}
                {toNumber(row.quantity_liters).toLocaleString()} L —{' '}
                {t('machineDetail.fuelDeleteDesc')}
              </p>
            </div>
          </div>
          {del.isError && <ErrorBanner message={(del.error as Error)?.message} />}
          <div className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={del.isPending}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => del.mutate(row.id, { onSuccess: () => onClose() })}
              disabled={del.isPending}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {del.isPending ? t('machineDetail.fuelSaving') : t('common.delete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
