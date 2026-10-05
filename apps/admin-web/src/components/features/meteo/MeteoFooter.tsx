'use client';

import { METEO_ATTRIBUTION } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';

/** Permanent footer: data attribution + the beta/uncalibrated disclaimer. */
export function MeteoFooter() {
  const { t } = useI18n();
  return (
    <footer className="mt-8 border-t border-neutral-200 pt-4 text-xs text-neutral-400">
      <p>{METEO_ATTRIBUTION}</p>
      <p className="mt-1">{t('meteo.disclaimer')}</p>
    </footer>
  );
}
