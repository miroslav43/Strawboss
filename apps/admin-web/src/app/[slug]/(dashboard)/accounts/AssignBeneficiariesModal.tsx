'use client';

import { useEffect, useMemo, useState } from 'react';
import { XCircle, Link2, Loader2 } from 'lucide-react';
import {
  useBeneficiaries,
  useTransporterAssignments,
  useSetTransporterAssignments,
} from '@strawboss/api';
import type { User, Beneficiary } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const cancelBtnCls =
  'rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 transition-colors';
const submitBtnCls =
  'inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white ' +
  'hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors';

/**
 * Multi-select assignment of which beneficiaries a transporter account may act
 * for. Set-replace: the whole selection is PUT on save. Mirrors AssignDepotModal
 * but with checkboxes instead of radios.
 */
export function AssignBeneficiariesModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useI18n();
  const { data: beneficiariesRaw } = useBeneficiaries(apiClient);
  const { data: assigned, isPending: assignedLoading } = useTransporterAssignments(
    apiClient,
    user.id,
  );
  const setAssignments = useSetTransporterAssignments(apiClient);

  const active: Beneficiary[] = useMemo(() => {
    const list = Array.isArray(beneficiariesRaw)
      ? (beneficiariesRaw as Beneficiary[])
      : ((beneficiariesRaw as unknown as { data?: Beneficiary[] })?.data ?? []);
    return list.filter((b) => b.isActive);
  }, [beneficiariesRaw]);

  // Seed the selection from the current assignments once they load.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!seeded && assigned) {
      setSelected(new Set(assigned));
      setSeeded(true);
    }
  }, [assigned, seeded]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isDirty = useMemo(() => {
    const base = new Set(assigned ?? []);
    if (base.size !== selected.size) return true;
    for (const id of selected) if (!base.has(id)) return true;
    return false;
  }, [assigned, selected]);

  const handleSave = () => {
    if (!isDirty) return;
    setAssignments.mutate(
      { id: user.id, beneficiaryIds: Array.from(selected) },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-800">
            {t('accounts.beneficiaries.title')}
            {' — '}
            <span className="text-primary">{user.fullName}</span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <p className="mb-4 text-sm text-neutral-500">{t('accounts.beneficiaries.hint')}</p>

          {assignedLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.loading')}
            </div>
          ) : active.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {t('accounts.beneficiaries.none')}
            </p>
          ) : (
            <div className="space-y-2">
              {active.map((b) => {
                const checked = selected.has(b.id);
                return (
                  <label
                    key={b.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                      checked
                        ? 'border-primary bg-primary/5'
                        : 'border-neutral-200 hover:bg-neutral-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(b.id)}
                      className="accent-primary"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-neutral-800">{b.displayName}</p>
                      <p className="text-xs text-neutral-400">{b.companyName}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {setAssignments.isError && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(setAssignments.error as Error)?.message ?? t('accounts.assign.errorSave')}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-neutral-100 bg-neutral-50 px-6 py-4">
          <button type="button" onClick={onClose} className={cancelBtnCls}>
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={setAssignments.isPending || !isDirty}
            className={submitBtnCls}
          >
            <Link2 className="h-4 w-4" />
            {setAssignments.isPending
              ? t('accounts.assign.saving')
              : t('accounts.beneficiaries.assignAction')}
          </button>
        </div>
      </div>
    </div>
  );
}
