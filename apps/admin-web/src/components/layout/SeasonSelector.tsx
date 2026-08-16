'use client';

import { useProfile } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSeason } from '@/lib/season';

/**
 * The season picker in the top bar.
 *
 * Visible to `admin` only. Everyone else — dispatchers, depot managers,
 * transporters — sees the active season and cannot switch, which is deliberate:
 * a dispatcher planning tomorrow's work from a dropdown they accidentally left
 * on 2026 is a worse failure than not being able to look back.
 *
 * Renders nothing when the organization has exactly one season, so the chrome
 * stays empty until there is actually a choice to make.
 */
export function SeasonSelector() {
  const { t } = useI18n();
  const { data: profile } = useProfile(apiClient);
  const { availableYears, selectedYear, setSelectedYear, isActiveSeason, closedYears } =
    useSeason();

  if (profile?.role !== 'admin') return null;
  if (availableYears.length < 2) return null;

  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">{t('season.selectorLabel')}</span>
      <select
        value={selectedYear}
        onChange={(e) => setSelectedYear(Number(e.target.value))}
        className={
          'rounded-md border px-2 py-1 text-sm font-medium ' +
          (isActiveSeason
            ? 'border-neutral-200 bg-surface text-neutral-700'
            : // Amber, matching PastSeasonBanner: the two are one signal.
              'border-amber-400 bg-amber-50 text-amber-900')
        }
      >
        {availableYears.map((year) => (
          <option key={year} value={year}>
            {closedYears.includes(year)
              ? t('season.optionClosed', { year: String(year) })
              : String(year)}
          </option>
        ))}
      </select>
    </label>
  );
}
