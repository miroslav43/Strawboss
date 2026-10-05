'use client';

import { useMemo } from 'react';
import type { MeteoOverviewRow, MeteoStatusColor } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { STATUS_ORDER, STATUS_STYLES } from './format';

/** One count tile per traffic-light colour. */
export function MeteoKpis({ rows }: { rows: MeteoOverviewRow[] }) {
  const { t } = useI18n();
  const counts = useMemo(() => {
    const c: Record<MeteoStatusColor, number> = { green: 0, yellow: 0, red: 0, grey: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {STATUS_ORDER.map((s) => (
        <div
          key={s}
          className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm"
        >
          <span className={`h-4 w-4 flex-shrink-0 rounded-full ${STATUS_STYLES[s].dot}`} />
          <div>
            <p className="text-2xl font-bold leading-none text-neutral-900">{counts[s]}</p>
            <p className="mt-0.5 text-xs text-neutral-500">{t(`meteo.status.${s}`)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
