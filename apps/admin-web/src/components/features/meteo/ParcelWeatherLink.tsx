'use client';

import Link from 'next/link';
import { CloudSun } from 'lucide-react';
import { useMeteoStatus } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useIsDispatcher } from '@/hooks/useIsDispatcher';
import { useOrgSlug } from '@/hooks/useOrgSlug';

/**
 * CloudSun shortcut to a parcel's weather page, for the Parcels table and the
 * map list. Renders NOTHING (not a disabled icon) unless the module is
 * configured, the org opted in and `meteo.forecast` is on. The status query is
 * shared by every instance (same key) and only fires for admin/dispatcher.
 */
export function ParcelWeatherLink({
  parcelId,
  from,
  size = 'md',
}: {
  parcelId: string;
  from: 'parcels' | 'map';
  size?: 'sm' | 'md';
}) {
  const { t } = useI18n();
  const slug = useOrgSlug();
  const { isDispatcher } = useIsDispatcher();
  const status = useMeteoStatus(apiClient, { enabled: isDispatcher });
  const s = status.data;

  if (!isDispatcher || !s || !s.configured || !s.enabled || s.forecastEnabled !== true) return null;

  const label = t('meteo.wx.openWeather');
  return (
    <Link
      href={`/${slug}/meteo/${parcelId}?from=${from}`}
      onClick={(e) => e.stopPropagation()}
      className={
        size === 'sm'
          ? 'flex-shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-sky-500'
          : 'rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-sky-50 hover:text-sky-500'
      }
      title={label}
      aria-label={label}
    >
      <CloudSun className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} />
    </Link>
  );
}
