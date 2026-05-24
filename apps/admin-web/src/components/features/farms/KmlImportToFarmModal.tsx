'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, Plus, Upload, XCircle } from 'lucide-react';
import type { Farm } from '@strawboss/types';
import { useCreateParcel } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { parseKml, type KmlParsedParcel } from '@/lib/kml-parser';
import { useI18n } from '@/lib/i18n';
import { clientLogger } from '@/lib/client-logger';

interface KmlImportToFarmModalProps {
  farms: Farm[];
  /** Pre-selected farm id, e.g. when the user opened the modal from a farm row. */
  defaultFarmId?: string | null;
  onClose: () => void;
}

/**
 * Two-step modal:
 *   1. Pick a `.kml` file and (optionally) a destination Farm.
 *   2. Confirm — loop `useCreateParcel.mutateAsync` for every parsed polygon
 *      with `{ boundary, name, municipality, farmId }`.
 */
export function KmlImportToFarmModal({
  farms,
  defaultFarmId = null,
  onClose,
}: KmlImportToFarmModalProps) {
  const { t } = useI18n();
  const createParcel = useCreateParcel(apiClient);

  const [parsed, setParsed] = useState<KmlParsedParcel[] | null>(null);
  const [selectedFarmId, setSelectedFarmId] = useState<string>(defaultFarmId ?? '');
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; failed: number } | null>(null);
  const [finished, setFinished] = useState(false);

  const total = parsed?.length ?? 0;
  const importing = progress !== null && !finished;

  const handleFile = useCallback(
    async (file: File) => {
      setParseError(null);
      try {
        const text = await file.text();
        const result = parseKml(text);
        if (result.length === 0) {
          setParseError(t('farms.kml.modal.noPolygons'));
          setParsed([]);
          return;
        }
        setParsed(result);
      } catch (err) {
        setParseError((err as Error)?.message ?? t('mapList.kmlReadError'));
        setParsed(null);
      }
    },
    [t],
  );

  const handleImport = useCallback(async () => {
    if (!parsed || parsed.length === 0) return;
    let failed = 0;
    setProgress({ done: 0, failed: 0 });
    clientLogger.info('KML import requested', {
      feature: 'farms.kml-import',
      count: parsed.length,
      farmId: selectedFarmId || null,
    });
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      try {
        await createParcel.mutateAsync({
          boundary: JSON.stringify(p.boundary),
          name: p.name || undefined,
          municipality: p.municipality || undefined,
          // Only attach farmId when one is selected — keeps the "unassigned"
          // import path working from this entry point too.
          ...(selectedFarmId ? { farmId: selectedFarmId } : {}),
        });
      } catch {
        failed++;
      }
      setProgress({ done: i + 1, failed });
    }
    setFinished(true);
  }, [parsed, selectedFarmId, createParcel]);

  const farmOptions = useMemo(() => {
    return [...farms].sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  }, [farms]);

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
        {/* Header */}
        <div className="flex items-center justify-between bg-primary px-6 py-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-white" />
            <h2 className="text-base font-semibold text-white">{t('farms.kml.modal.title')}</h2>
          </div>
          {!importing && (
            <button
              onClick={onClose}
              className="rounded-full p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
              aria-label={t('map.cancel')}
            >
              <XCircle className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {/* Step 1 — file picker */}
          {!parsed && (
            <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 px-6 py-8 text-center">
              <Upload className="h-8 w-8 text-neutral-400" />
              <p className="text-sm text-neutral-600">{t('farms.kml.modal.selectFile')}</p>
              <label className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90">
                {t('farms.kml.modal.selectFile')}
                <input
                  type="file"
                  accept=".kml"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          )}

          {/* Parse error */}
          {parseError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-500" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Step 2 — farm selector + preview */}
          {parsed && parsed.length > 0 && !finished && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">
                  {t('farms.kml.modal.selectFarm')}
                </label>
                <select
                  value={selectedFarmId}
                  onChange={(e) => setSelectedFarmId(e.target.value)}
                  disabled={importing}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">— {t('farms.kml.modal.selectFarmHint')} —</option>
                  {farmOptions.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-neutral-400">
                  {t('farms.kml.modal.selectFarmHint')}
                </p>
              </div>

              <div className="rounded-lg border border-neutral-200">
                <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-500">
                  {t('farms.kml.modal.preview', { n: total })}
                </div>
                <ul className="max-h-56 divide-y divide-neutral-100 overflow-y-auto">
                  {parsed.map((p, i) => (
                    <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span className="truncate text-neutral-700">
                        {p.name || t('map.kmlParcelUnnamed', { n: i + 1 })}
                      </span>
                      <span className="ml-4 flex-shrink-0 text-xs text-neutral-400">
                        {p.previewHa != null ? `${p.previewHa} ha` : ''}
                        {p.municipality ? ` · ${p.municipality}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Progress */}
              {importing && progress && (
                <div className="text-sm text-neutral-600">
                  {t('farms.kml.modal.importing', { done: progress.done, total })}
                  <div className="mt-2 h-2 w-full rounded-full bg-neutral-100">
                    <div
                      className="h-2 rounded-full bg-primary transition-all"
                      style={{ width: `${(progress.done / total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Finished */}
          {finished && progress && (
            <div className="text-sm">
              <p className="font-medium text-neutral-800">{t('map.importDone')}</p>
              <p className="mt-1 text-neutral-500">
                <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-green-600" />
                {t('farms.kml.modal.done', {
                  ok: progress.done - progress.failed,
                  failed: progress.failed,
                })}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-neutral-100 bg-neutral-50 px-6 py-4">
          {finished ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              {t('map.close')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={importing}
                className="rounded-lg border border-neutral-300 bg-white px-5 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-100 disabled:opacity-50"
              >
                {t('map.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={!parsed || parsed.length === 0 || importing}
                className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                {parsed && parsed.length > 0
                  ? t('farms.kml.modal.confirm', { n: parsed.length })
                  : t('farms.kml.modal.confirm', { n: 0 })}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
