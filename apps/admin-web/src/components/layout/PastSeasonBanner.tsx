'use client';

import { useI18n } from '@/lib/i18n';
import { useSeason } from '@/lib/season';

/**
 * "You are looking at a finished season."
 *
 * Two seasons render identically apart from the figures — same charts, same
 * tables, same headings — so nothing on the page distinguishes a historical
 * view from live operations. Somebody will eventually act on last year's depot
 * stock. This is the only thing standing between them and that.
 *
 * Renders nothing on the active season, so the everyday view is untouched.
 */
export function PastSeasonBanner() {
  const { t } = useI18n();
  const { isActiveSeason, selectedYear, closedYears, setSelectedYear, activeYear } = useSeason();

  if (isActiveSeason) return null;

  const isClosed = closedYears.includes(selectedYear);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>
        {t('season.viewingHistorical', { year: String(selectedYear) })}
        {isClosed ? ` ${t('season.closedSuffix')}` : ''}
      </span>
      <button
        type="button"
        onClick={() => setSelectedYear(activeYear)}
        className="rounded border border-amber-400 px-2 py-0.5 font-medium hover:bg-amber-100"
      >
        {t('season.backToActive', { year: String(activeYear) })}
      </button>
    </div>
  );
}
