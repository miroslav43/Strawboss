'use client';

import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useMeteoFingerprint, useMeteoFingerprints } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { STATUS_STYLES, useMeteoFormat } from './format';

/** Frozen per-bale-production weather fingerprints of a parcel, with JSON export. */
export function FingerprintList({ parcelId }: { parcelId: string }) {
  const { t } = useI18n();
  const f = useMeteoFormat();
  const list = useMeteoFingerprints(apiClient, parcelId);
  // Only the single-fingerprint endpoint carries snapshotCanonical.
  const [wanted, setWanted] = useState<string | null>(null);
  const one = useMeteoFingerprint(apiClient, wanted);

  useEffect(() => {
    const fp = one.data;
    if (!wanted || !fp || fp.baleProductionId !== wanted) return;
    const blob = new Blob([JSON.stringify(fp, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meteo-fingerprint-${wanted}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setWanted(null);
  }, [one.data, wanted]);

  useEffect(() => {
    if (one.isError) setWanted(null);
  }, [one.isError]);

  const rows = list.data ?? [];

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-base font-semibold text-neutral-800">{t('meteo.fingerprint.title')}</h2>
      <p className="mb-3 text-xs text-neutral-500">{t('meteo.fingerprint.hint')}</p>
      {list.isLoading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-4 text-sm text-neutral-400">{t('meteo.fingerprint.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-3 py-2">{t('meteo.fingerprint.baledAt')}</th>
                <th className="px-3 py-2">{t('meteo.fingerprint.window')}</th>
                <th className="px-3 py-2">{t('meteo.fingerprint.moisture')}</th>
                <th className="px-3 py-2">{t('meteo.fingerprint.rain')}</th>
                <th className="px-3 py-2">{t('meteo.fingerprint.dryingHours')}</th>
                <th className="px-3 py-2">{t('meteo.fingerprint.integrity')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((fp) => (
                <tr key={fp.baleProductionId}>
                  <td className="whitespace-nowrap px-3 py-2">{f.dateTime(fp.baledAt)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[fp.windowStatus].badge}`}>
                      {t(`meteo.status.${fp.windowStatus}`)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {f.pct(fp.mcP50)}{' '}
                    <span className="text-xs text-neutral-400">
                      [{f.pct(fp.mcP10)} – {f.pct(fp.mcP90)}]
                    </span>
                    {fp.mcMeasured !== null && (
                      <span className="ml-1 text-xs text-amber-700">
                        ({t('meteo.fingerprint.measured')}: {f.pct(fp.mcMeasured)})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {fp.rainSinceHarvestMm === null ? '—' : `${fp.rainSinceHarvestMm.toFixed(1)} mm`}
                  </td>
                  <td className="px-3 py-2">{f.hours(fp.dryingHours)}</td>
                  <td className="space-x-1 whitespace-nowrap px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        fp.hashValid ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {fp.hashValid ? t('meteo.fingerprint.hashValid') : t('meteo.fingerprint.hashInvalid')}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        fp.sourceStatus === 'ok' ? 'bg-neutral-100 text-neutral-700' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {t(`meteo.fingerprint.source.${fp.sourceStatus}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setWanted(fp.baleProductionId)}
                      disabled={wanted !== null}
                      aria-label={t('meteo.fingerprint.download')}
                      title={t('meteo.fingerprint.download')}
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-primary disabled:opacity-50"
                    >
                      {wanted === fp.baleProductionId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
