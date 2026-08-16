'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Lock } from 'lucide-react';
import { useCloseSeason, useSeasonPreflight } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSeason } from '@/lib/season';

/**
 * Closing a season, from the organization's own settings page.
 *
 * The flow is deliberately three steps — read the preflight, type the year,
 * confirm — because closing is close to irreversible in practice: it freezes a
 * year's reported numbers, carries depot stock forward and resets every field's
 * harvest status. A single "Yes" button is too cheap for that.
 */
export function SeasonSection() {
  const { t } = useI18n();
  const { activeYear, closedYears } = useSeason();
  const [targetYear, setTargetYear] = useState<number | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const preflight = useSeasonPreflight(apiClient, targetYear);
  const close = useCloseSeason(apiClient);

  // Only a FINISHED calendar year can be closed. Offering the current one would
  // invite closing a season that is still receiving work.
  const closable = activeYear - 1;
  const alreadyClosed = closedYears.includes(closable);

  function start() {
    setDone(null);
    setConfirmText('');
    setReason('');
    setTargetYear(closable);
  }

  async function submit() {
    if (targetYear === null) return;
    const result = await close.mutateAsync({ year: targetYear, reason });
    setDone(
      t('season.rollover.success', {
        year: String(result.closedYear),
        next: String(result.newActiveYear),
        bales: String(result.balesCarriedForward),
        depots: String(result.depotBalancesWritten),
      }),
    );
    setTargetYear(null);
  }

  const p = preflight.data;
  const canSubmit =
    p?.canClose === true && confirmText.trim() === String(targetYear) && reason.trim().length >= 3;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-neutral-800">
            {t('season.current', { year: String(activeYear) })}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {closedYears.length > 0
              ? t('season.closedList', { years: closedYears.join(', ') })
              : t('season.noneClosed')}
          </p>
        </div>
        {alreadyClosed ? (
          <span className="flex items-center gap-1 text-xs text-neutral-500">
            <Lock className="h-3.5 w-3.5" />
            {t('season.alreadyClosed', { year: String(closable) })}
          </span>
        ) : (
          <button
            type="button"
            onClick={start}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            {t('season.rollover.cta', { year: String(closable) })}
          </button>
        )}
      </div>

      {done && (
        <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
          {done}
        </div>
      )}

      {targetYear !== null && (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            {t('season.rollover.title', { year: String(targetYear) })}
          </p>

          {preflight.isLoading && (
            <p className="text-sm text-amber-800">{t('season.rollover.checking')}</p>
          )}

          {preflight.isError && (
            <p className="text-sm text-red-700">
              {(preflight.error as { message?: string })?.message ?? t('common.error')}
            </p>
          )}

          {p && (
            <ul className="space-y-1.5 text-sm text-amber-900">
              {/* Blocking. A closed season rejects writes, so the transitions
                  an open trip still needs would be refused — the truck would be
                  stranded mid-haul. */}
              <li className={p.openTrips > 0 ? 'font-semibold text-red-700' : ''}>
                {p.openTrips > 0 ? '✕ ' : '✓ '}
                {t('season.rollover.openTrips', { count: String(p.openTrips) })}
              </li>
              {/* Warning only. A lost or broken phone must not make the year
                  impossible to close — but its unsynced work will be dated when
                  it finally arrives, i.e. into the new season. */}
              <li className={p.devicesNotCheckedIn > 0 ? 'font-semibold' : ''}>
                {p.devicesNotCheckedIn > 0 ? '⚠ ' : '✓ '}
                {t('season.rollover.devices', { count: String(p.devicesNotCheckedIn) })}
              </li>
              <li>
                →{' '}
                {t('season.rollover.carry', {
                  bales: String(p.balesCarriedForward),
                  depots: String(p.depotsWithStock),
                })}
              </li>
              <li>→ {t('season.rollover.parcels', { count: String(p.parcelsToReset) })}</li>
              <li className="text-amber-800">{t('season.rollover.fieldsFromZero')}</li>
            </ul>
          )}

          <label className="block text-sm text-amber-900">
            {t('season.rollover.reasonLabel')}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-md border border-amber-300 px-2 py-1 text-sm"
              placeholder={t('season.rollover.reasonPlaceholder')}
            />
          </label>

          <label className="block text-sm text-amber-900">
            {t('season.rollover.typeYear', { year: String(targetYear) })}
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="mt-1 w-32 rounded-md border border-amber-300 px-2 py-1 text-sm"
              inputMode="numeric"
            />
          </label>

          {close.isError && (
            <p className="flex items-start gap-1.5 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {(close.error as { message?: string })?.message ?? t('common.error')}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canSubmit || close.isPending}
              onClick={submit}
              className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {close.isPending
                ? t('season.rollover.running')
                : t('season.rollover.confirm', { year: String(targetYear) })}
            </button>
            <button
              type="button"
              onClick={() => setTargetYear(null)}
              className="rounded-lg border border-amber-400 px-3 py-1.5 text-sm"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
