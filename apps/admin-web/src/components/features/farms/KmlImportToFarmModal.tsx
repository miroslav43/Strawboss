'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, Plus, Upload, XCircle } from 'lucide-react';
import type { Farm, ParcelImportRequest, ParcelImportResult } from '@strawboss/types';
import { useImportParcels } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { parseKml, type KmlParsedParcel } from '@/lib/kml-parser';
import { useI18n } from '@/lib/i18n';
import { clientLogger } from '@/lib/client-logger';

interface KmlImportToFarmModalProps {
  farms: Farm[];
  /** Pre-selected farm id, e.g. when the user opened the modal from a farm row. */
  defaultFarmId?: string | null;
  /** When true (with a defaultFarmId), the farm is fixed and the selector is hidden. */
  lockFarm?: boolean;
  onClose: () => void;
}

/** Crop + campaign year as a single notes line, e.g. "PORUMB · 2025". */
function composeNotes(p: KmlParsedParcel): string | null {
  return [p.cropRaw, p.year].filter(Boolean).join(' · ') || null;
}

/**
 * Two-step modal:
 *   1. Pick a `.kml` file and (optionally) a destination Farm.
 *   2. Confirm — one `useImportParcels` call upserts every parsed parcel
 *      (insert or update by code) and returns a created/updated/failed summary.
 */
export function KmlImportToFarmModal({
  farms,
  defaultFarmId = null,
  lockFarm = false,
  onClose,
}: KmlImportToFarmModalProps) {
  const { t } = useI18n();
  const importParcels = useImportParcels(apiClient);

  const [parsed, setParsed] = useState<KmlParsedParcel[] | null>(null);
  const [selectedFarmId, setSelectedFarmId] = useState<string>(defaultFarmId ?? '');
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ParcelImportResult | null>(null);

  const total = parsed?.length ?? 0;
  const importing = importParcels.isPending;
  const finished = result !== null;

  const lockedFarm = useMemo(
    () =>
      lockFarm && selectedFarmId ? (farms.find((f) => f.id === selectedFarmId) ?? null) : null,
    [lockFarm, selectedFarmId, farms],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setParseError(null);
      // DOMParser.parseFromString is synchronous — a multi-megabyte KML
      // freezes the main thread. Reject anything past this threshold up front
      // so the user gets a clear message instead of "Page Unresponsive".
      const MAX_FILE_BYTES = 20 * 1024 * 1024;
      if (file.size > MAX_FILE_BYTES) {
        setParseError(t('farms.kml.modal.fileTooLarge'));
        setParsed(null);
        return;
      }
      try {
        const text = await file.text();
        const parcels = parseKml(text);
        if (parcels.length === 0) {
          setParseError(t('farms.kml.modal.noParcels'));
          setParsed([]);
          return;
        }
        setParsed(parcels);
      } catch (err) {
        setParseError((err as Error)?.message ?? t('mapList.kmlReadError'));
        setParsed(null);
      }
    },
    [t],
  );

  const handleImport = useCallback(async () => {
    if (!parsed || parsed.length === 0) return;
    clientLogger.info('KML import requested', {
      feature: 'farms.kml-import',
      count: parsed.length,
      farmId: selectedFarmId || null,
    });

    const payload: ParcelImportRequest = {
      farmId: selectedFarmId || null,
      parcels: parsed.map((p, i) => ({
        code: p.code ?? `KML-${i + 1}`,
        name: p.name || undefined,
        boundary: JSON.stringify(p.boundary),
        ...(p.declaredHa != null ? { areaHectares: p.declaredHa } : {}),
        notes: composeNotes(p),
      })),
    };

    try {
      setResult(await importParcels.mutateAsync(payload));
    } catch (err) {
      clientLogger.error('KML import failed', {
        feature: 'farms.kml-import',
        message: (err as Error)?.message,
      });
      setResult({
        total: parsed.length,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: parsed.length,
        errors: [],
      });
    }
  }, [parsed, selectedFarmId, importParcels]);

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
              {lockedFarm ? (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                  {t('farms.kml.modal.lockedFarm', { name: lockedFarm.name })}
                </div>
              ) : (
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
              )}

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
                        {p.cropRaw ? ` · ${p.cropRaw}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Progress */}
              {importing && (
                <div className="text-sm text-neutral-600">
                  {t('farms.kml.modal.importingNow')}
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-2 w-1/2 animate-pulse rounded-full bg-primary" />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Finished */}
          {finished && result && (
            <div className="text-sm">
              <p className="font-medium text-neutral-800">{t('map.importDone')}</p>
              <p className="mt-1 text-neutral-500">
                <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-green-600" />
                {t('farms.kml.modal.result', {
                  created: result.created,
                  updated: result.updated,
                  failed: result.failed,
                })}
              </p>
              {result.skipped > 0 && (
                <p className="mt-1 text-xs text-amber-600">
                  {t('farms.kml.modal.skippedNote', { skipped: result.skipped })}
                </p>
              )}
              {result.failed > 0 && result.errors.length > 0 && (
                <p className="mt-1 text-xs text-red-600">
                  {t('farms.kml.modal.failedCodes', {
                    codes: result.errors.map((e) => e.code).join(', '),
                  })}
                </p>
              )}
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
                {t('farms.kml.modal.confirm', { n: parsed?.length ?? 0 })}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
