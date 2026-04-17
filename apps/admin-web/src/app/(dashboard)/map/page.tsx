'use client';
export const dynamic = 'force-dynamic';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import dynamicImport from 'next/dynamic';
import { MapPin, Plus, XCircle, ChevronLeft, ChevronRight, X, AlertTriangle, Wheat, Map, FolderOpen, CheckCircle2 } from 'lucide-react';
import area from '@turf/area';
import { polygon as turfPolygon, multiPolygon as turfMultiPolygon } from '@turf/helpers';
import {
  useParcels,
  useMachineLocations,
  useCreateParcel,
  useUpdateParcel,
  useDeleteParcel,
  useFarms,
  useDeliveryDestinations,
} from '@strawboss/api';
import type { Parcel, MachineLastLocation, RoutePoint, DeliveryDestination } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { RouteHistoryPanel } from '@/components/map/RouteHistoryPanel';
import { DepositGeofenceModal } from '@/components/map/DepositGeofenceModal';
import { FilterableParcelList } from '@/components/map/FilterableParcelList';
import { FilterableMachineList } from '@/components/map/FilterableMachineList';
import { FilterableFarmList } from '@/components/map/FilterableFarmList';
import { apiClient } from '@/lib/api';
import { type KmlParsedParcel } from '@/lib/kml-parser';
import { useI18n } from '@/lib/i18n';
import { clientLogger } from '@/lib/client-logger';
import { useMachineIconPrefs } from '@/hooks/useMachineIconPrefs';

// Leaflet cannot run on the server — disable SSR for the map component.
const LeafletMap = dynamicImport(
  () => import('@/components/map/LeafletMap').then((m) => ({ default: m.LeafletMap })),
  { ssr: false, loading: () => <MapLoadingPlaceholder /> },
);

function MapLoadingPlaceholder() {
  const { t } = useI18n();
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-100">
      <div className="text-center text-sm text-neutral-400">
        <MapPin className="mx-auto mb-2 h-8 w-8 opacity-30" />
        {t('map.loading')}
      </div>
    </div>
  );
}

/** Calculate approximate hectares from a GeoJSON geometry using turf. */
function calcHectares(geometry: GeoJSON.Geometry): number | null {
  try {
    let feature: GeoJSON.Feature | null = null;
    if (geometry.type === 'Polygon') {
      feature = turfPolygon(
        (geometry as GeoJSON.Polygon).coordinates,
      );
    } else if (geometry.type === 'MultiPolygon') {
      feature = turfMultiPolygon(
        (geometry as GeoJSON.MultiPolygon).coordinates,
      );
    }
    if (!feature) return null;
    return Math.round((area(feature) / 10_000) * 100) / 100;
  } catch {
    return null;
  }
}

// ── New-parcel modal ───────────────────────────────────────────────────────

interface NewParcelModalProps {
  geometry: GeoJSON.Geometry;
  onClose: () => void;
}

/**
 * Confirmation modal shown after drawing a field boundary.
 * All fields (code, area, centroid, municipality) are computed automatically
 * by the backend. Name can be set later via the Edit modal.
 */
function NewParcelModal({ geometry, onClose }: NewParcelModalProps) {
  const { t } = useI18n();
  const createParcel = useCreateParcel(apiClient);

  // Preview area computed client-side with turf for instant feedback.
  const previewHa = useMemo(() => calcHectares(geometry), [geometry]);

  const handleSave = () => {
    createParcel.mutate(
      { boundary: JSON.stringify(geometry) },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
        {/* Header */}
        <div className="flex items-center justify-between bg-primary px-6 py-4">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-white/80" />
            <h2 className="text-base font-semibold text-white">{t('map.newFieldDrawn')}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {/* Area badge */}
          {previewHa !== null ? (
            <div className="mb-5 flex items-center gap-4 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Wheat className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-primary/70">
                  {t('map.estimatedArea')}
                </p>
                <p className="text-2xl font-bold text-primary">
                  {t('map.estimatedAreaHa', { value: previewHa })}
                </p>
              </div>
            </div>
          ) : (
            <div className="mb-5 flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-5 py-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100">
                <Map className="h-5 w-5 text-neutral-400" />
              </div>
              <p className="text-sm text-neutral-600">{t('map.drawnOnMap')}</p>
            </div>
          )}

          <p className="text-sm text-neutral-500">{t('map.serverFillsCode')}</p>

          {createParcel.isError && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-500" />
              <span>
                {(createParcel.error as Error)?.message ?? t('map.saveFieldErrorFallback')}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-neutral-100 bg-neutral-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 bg-white px-5 py-2 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-100"
          >
            {t('map.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={createParcel.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {createParcel.isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {t('map.saving')}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {t('map.saveField')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── KML import modal ──────────────────────────────────────────────────────

interface KmlImportModalProps {
  parcels: KmlParsedParcel[];
  onClose: () => void;
}

function KmlImportModal({ parcels, onClose }: KmlImportModalProps) {
  const { t } = useI18n();
  const createParcel = useCreateParcel(apiClient);
  const [progress, setProgress] = useState<{ done: number; failed: number } | null>(null);
  const [done, setDone] = useState(false);

  const handleImport = async () => {
    let failed = 0;
    setProgress({ done: 0, failed: 0 });

    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      await new Promise<void>((resolve) => {
        createParcel.mutate(
          {
            boundary: JSON.stringify(p.boundary),
            name: p.name || undefined,
            municipality: p.municipality || undefined,
          },
          {
            onSuccess: () => resolve(),
            onError: () => { failed++; resolve(); },
          },
        );
      });
      setProgress({ done: i + 1, failed });
    }

    setDone(true);
  };

  const importing = progress !== null && !done;
  const total = parcels.length;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
        {/* Header */}
        <div className="flex items-center justify-between bg-primary px-6 py-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-white" />
            <h2 className="text-base font-semibold text-white">
              {total === 1
                ? t('map.importKmlTitle', { count: total })
                : t('map.importKmlTitlePlural', { count: total })}
            </h2>
          </div>
          {!importing && (
            <button
              onClick={onClose}
              className="rounded-full p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            >
              <XCircle className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Parcel list */}
        {!done && (
          <ul className="max-h-64 divide-y divide-neutral-100 overflow-y-auto">
            {parcels.map((p, i) => (
              <li key={i} className="flex items-center justify-between px-5 py-2 text-sm">
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
        )}

        {/* Progress / result */}
        {importing && progress && (
          <div className="px-6 py-4 text-sm text-neutral-600">
            {t('map.importing', { done: progress.done, total })}
            <div className="mt-2 h-2 w-full rounded-full bg-neutral-100">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${(progress.done / total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {done && progress && (
          <div className="px-6 py-5 text-sm">
            <p className="font-medium text-neutral-800">{t('map.importDone')}</p>
            <p className="mt-1 text-neutral-500">
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-green-600" />
              {t('map.importSuccess', { ok: progress.done - progress.failed })}
              {progress.failed > 0 && (
                <>, <AlertTriangle className="inline h-3 w-3 text-amber-500" /> {t('map.importFailed', { n: progress.failed })}</>
              )}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-neutral-100 bg-neutral-50 px-6 py-4">
          {done ? (
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
                onClick={handleImport}
                disabled={importing}
                className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    {t('map.importingEllipsis')}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    {total === 1
                      ? t('map.importN', { count: total })
                      : t('map.importNPlural', { count: total })}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Edit-parcel-info modal ─────────────────────────────────────────────────

interface EditParcelInfoModalProps {
  parcel: Parcel;
  onClose: () => void;
}

function EditParcelInfoModal({ parcel, onClose }: EditParcelInfoModalProps) {
  const { t } = useI18n();
  const [name,         setName]         = useState(parcel.name ?? '');
  const [ownerName,    setOwnerName]    = useState(parcel.ownerName ?? '');
  const [ownerContact, setOwnerContact] = useState(parcel.ownerContact ?? '');
  const [municipality, setMunicipality] = useState(parcel.municipality ?? '');
  const [areaHectares, setAreaHectares] = useState(parcel.areaHectares?.toString() ?? '');
  const [notes,        setNotes]        = useState(parcel.notes ?? '');

  const updateParcel = useUpdateParcel(apiClient);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateParcel.mutate(
      {
        id: parcel.id,
        data: {
          name:         name.trim()         || undefined,
          ownerName:    ownerName.trim()    || undefined,
          ownerContact: ownerContact.trim() || undefined,
          municipality: municipality.trim() || undefined,
          areaHectares: areaHectares        ? Number(areaHectares) : undefined,
          notes:        notes.trim()        || null,
        },
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-neutral-800">{t('map.editField')}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100">
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <FormField label={t('map.fieldName')} value={name} onChange={setName} placeholder={t('parcels.form.placeholders.name')} />
          <FormField label={t('map.owner')} value={ownerName} onChange={setOwnerName} placeholder={t('parcels.form.placeholders.owner')} />
          <FormField label={t('map.ownerContact')} value={ownerContact} onChange={setOwnerContact} placeholder={t('parcels.form.placeholders.phone')} />
          <FormField label={t('map.municipality')} value={municipality} onChange={setMunicipality} placeholder={t('parcels.form.placeholders.municipality')} />
          <FormField label={t('map.areaHa')} value={areaHectares} onChange={setAreaHectares} type="number" placeholder={t('parcels.form.placeholders.area')} />
          <FormField label={t('map.notes')} value={notes} onChange={setNotes} placeholder={t('parcels.form.placeholders.notes')} />

          {updateParcel.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(updateParcel.error as Error)?.message ?? t('map.saveError')}
            </p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <ModalCancelBtn onClick={onClose} />
            <button type="submit" disabled={updateParcel.isPending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60">
              {updateParcel.isPending ? t('map.savingShort') : t('map.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Shared form helpers ────────────────────────────────────────────────────

function FormField({
  label, value, onChange, required, type = 'text', placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700">{label}</label>
      <input
        type={type} required={required} placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}

function ModalCancelBtn({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onClick}
      className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
      {t('map.cancel')}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function MapPage() {
  const { t } = useI18n();
  const { data: parcelsRaw, isLoading: parcelsLoading }  = useParcels(apiClient);
  const { data: machines = [] }                          = useMachineLocations(apiClient);
  const { data: farmsRaw = [] }                          = useFarms(apiClient);
  const { data: depositsRaw = [] }                       = useDeliveryDestinations(apiClient);
  const deleteParcel                                     = useDeleteParcel(apiClient);

  const { prefs: iconPrefs } = useMachineIconPrefs();

  const [selectedParcelId,   setSelectedParcelId]   = useState<string | null>(null);
  const [editParcel,         setEditParcel]          = useState<Parcel | null>(null);
  const [editingParcelInfo,  setEditingParcelInfo]   = useState<Parcel | null>(null);
  const [drawnGeometry,         setDrawnGeometry]         = useState<GeoJSON.Geometry | null>(null);
  const [drawnDepositGeometry,  setDrawnDepositGeometry] = useState<GeoJSON.Geometry | null>(null);
  const [drawMode,              setDrawMode]              = useState<'parcel' | 'deposit' | null>(null);
  const [deleteError,           setDeleteError]           = useState<string | null>(null);
  const [selectedMachineId,  setSelectedMachineId]  = useState<string | null>(null);
  const [routePoints,        setRoutePoints]         = useState<RoutePoint[] | undefined>(undefined);
  const [navigateToParcelId,  setNavigateToParcelId]  = useState<string | null>(null);
  const [navigateToMachineId, setNavigateToMachineId] = useState<string | null>(null);
  const [kmlParcels,         setKmlParcels]          = useState<KmlParsedParcel[] | null>(null);

  // Visibility toggles
  const [hiddenFarmIds,    setHiddenFarmIds]    = useState<Set<string>>(new Set());
  const [hiddenParcelIds,  setHiddenParcelIds]  = useState<Set<string>>(new Set());
  const [hiddenMachineIds, setHiddenMachineIds] = useState<Set<string>>(new Set());
  const [mapSidebarOpen,   setMapSidebarOpen]   = useState(true);

  const hiddenFarmIdsRef = useRef(hiddenFarmIds);
  useEffect(() => { hiddenFarmIdsRef.current = hiddenFarmIds; }, [hiddenFarmIds]);

  const parcels = (
    Array.isArray(parcelsRaw) ? parcelsRaw : (parcelsRaw as { data?: Parcel[] })?.data ?? []
  ) as Parcel[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const farms = (Array.isArray(farmsRaw) ? farmsRaw : (farmsRaw as any)?.data ?? []) as import('@strawboss/types').Farm[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deposits = (Array.isArray(depositsRaw) ? depositsRaw : (depositsRaw as any)?.data ?? []) as DeliveryDestination[];

  useEffect(() => {
    if (editParcel) setDrawMode(null);
  }, [editParcel]);

  const handleParcelSelect = useCallback((id: string) => setSelectedParcelId(id), []);

  const handleParcelEdit = useCallback((parcel: Parcel) => {
    setEditingParcelInfo(parcel);
  }, []);

  const handleParcelDelete = useCallback((id: string) => {
    const parcel = parcels.find((p) => p.id === id);
    const label  = parcel?.name ?? parcel?.code ?? id;
    if (!confirm(t('map.deleteParcelConfirm', { label }))) return;
    setDeleteError(null);
    deleteParcel.mutate(id, {
      onError: (err) => {
        const msg = (err as Error)?.message ?? t('map.deleteFailed');
        clientLogger.error('Map: delete parcel failed', {
          parcelId: id,
          message: msg,
        });
        setDeleteError(t('map.deleteErrorWithMessage', { message: msg }));
      },
    });
  }, [parcels, deleteParcel, t]);

  const handleNewParcelDrawn = useCallback((geometry: GeoJSON.Geometry) => {
    setDrawMode(null);
    setDrawnGeometry(geometry);
  }, []);

  const handleNewDepositDrawn = useCallback((geometry: GeoJSON.Geometry) => {
    setDrawMode(null);
    setDrawnDepositGeometry(geometry);
  }, []);

  const handleDrawCancel = useCallback(() => setDrawMode(null), []);

  const handleShowRoute = useCallback((machineId: string) => {
    setSelectedMachineId(machineId);
  }, []);

  const handleCloseRoute = useCallback(() => {
    setSelectedMachineId(null);
    setRoutePoints(undefined);
  }, []);

  const handleParcelNavigate = useCallback((parcel: Parcel) => {
    setSelectedParcelId(parcel.id);
    setNavigateToParcelId(parcel.id);
  }, []);

  const handleMachineNavigate = useCallback((machine: MachineLastLocation) => {
    setNavigateToMachineId(machine.machineId);
  }, []);

  const handleNavigationComplete = useCallback(() => {
    setNavigateToParcelId(null);
    setNavigateToMachineId(null);
  }, []);

  const handleParcelEditBoundary = useCallback((parcel: Parcel) => {
    setEditParcel(parcel);
  }, []);

  const handleToggleFarm = useCallback((farmId: string) => {
    const farmParcelIds = parcels
      .filter((p) => p.farmId === farmId)
      .map((p) => p.id);

    setHiddenFarmIds((prev) => {
      const next = new Set(prev);
      const willHide = !prev.has(farmId);
      if (willHide) next.add(farmId); else next.delete(farmId);
      return next;
    });

    setHiddenParcelIds((prev) => {
      const next = new Set(prev);
      // Use ref to avoid stale closure over hiddenFarmIds
      const willHide = !hiddenFarmIdsRef.current.has(farmId);
      farmParcelIds.forEach((id) => {
        if (willHide) next.add(id); else next.delete(id);
      });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcels]);

  const handleToggleParcel = useCallback((parcelId: string) => {
    setHiddenParcelIds((prev) => {
      const next = new Set(prev);
      if (next.has(parcelId)) next.delete(parcelId); else next.add(parcelId);
      return next;
    });
  }, []);

  const handleToggleMachineVisibility = useCallback((machineId: string) => {
    setHiddenMachineIds((prev) => {
      const next = new Set(prev);
      if (next.has(machineId)) next.delete(machineId); else next.add(machineId);
      return next;
    });
  }, []);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader title={t('map.title')} />
      {deleteError && (
        <div className="mx-4 mt-2 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span>{deleteError}</span>
          <button onClick={() => setDeleteError(null)} className="ml-3 text-red-400 hover:text-red-600"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-xl border border-neutral-200 shadow-sm">
        {/* Left panel: parcel + machine lists with filters */}
        <aside
          className={`flex-shrink-0 overflow-y-auto border-neutral-200 bg-white transition-[width] duration-200 ease-out ${
            mapSidebarOpen
              ? 'w-72 border-r'
              : 'pointer-events-none w-0 min-w-0 overflow-hidden border-0'
          }`}
        >
          <FilterableParcelList
            parcels={parcels}
            isLoading={parcelsLoading}
            selectedParcelId={selectedParcelId}
            onParcelSelect={handleParcelSelect}
            onParcelEdit={handleParcelEdit}
            onParcelEditBoundary={handleParcelEditBoundary}
            onParcelDelete={handleParcelDelete}
            onParcelNavigate={handleParcelNavigate}
            onKmlParsed={setKmlParcels}
            deleteIsPending={deleteParcel.isPending}
          />
          <FilterableMachineList
            machines={machines}
            hiddenMachineIds={hiddenMachineIds}
            onToggleMachineVisibility={handleToggleMachineVisibility}
            onMachineNavigate={handleMachineNavigate}
            onMachineShowRoute={handleShowRoute}
          />
          <FilterableFarmList
            farms={farms}
            parcels={parcels}
            hiddenFarmIds={hiddenFarmIds}
            hiddenParcelIds={hiddenParcelIds}
            onToggleFarm={handleToggleFarm}
            onToggleParcel={handleToggleParcel}
          />
        </aside>

        <button
          type="button"
          onClick={() => setMapSidebarOpen((v) => !v)}
          title={mapSidebarOpen ? t('map.hidePanel') : t('map.showPanel')}
          aria-label={mapSidebarOpen ? t('map.hidePanel') : t('map.showPanel')}
          className={`absolute top-1/2 z-[1000] flex h-10 w-6 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 border-neutral-200 bg-white text-neutral-500 shadow-sm transition-[left] duration-200 ease-out hover:bg-neutral-50 hover:text-neutral-800 ${
            mapSidebarOpen ? 'left-72' : 'left-0'
          }`}
        >
          {mapSidebarOpen ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {/* Right panel: map */}
        <div className="relative min-w-0 flex-1">
          <LeafletMap
            parcels={parcels}
            machines={machines}
            selectedParcelId={selectedParcelId}
            onParcelSelect={handleParcelSelect}
            onParcelEdit={handleParcelEdit}
            onParcelDelete={handleParcelDelete}
            editParcel={editParcel}
            onEditDone={() => setEditParcel(null)}
            drawMode={drawMode}
            onDrawModeChange={setDrawMode}
            onNewParcelDrawn={handleNewParcelDrawn}
            onNewDepositDrawn={handleNewDepositDrawn}
            onDrawCancel={handleDrawCancel}
            routePoints={routePoints}
            onShowRoute={handleShowRoute}
            navigateToParcelId={navigateToParcelId}
            navigateToMachineId={navigateToMachineId}
            onNavigationComplete={handleNavigationComplete}
            hiddenParcelIds={hiddenParcelIds}
            hiddenMachineIds={hiddenMachineIds}
            deposits={deposits}
            iconPrefs={iconPrefs}
          />
          {selectedMachineId && (
            <RouteHistoryPanel
              machineId={selectedMachineId}
              machineCode={machines.find((m) => m.machineId === selectedMachineId)?.machineCode ?? null}
              machineType={machines.find((m) => m.machineId === selectedMachineId)?.machineType ?? null}
              onClose={handleCloseRoute}
              onRouteData={setRoutePoints}
            />
          )}
        </div>
      </div>

      {/* New-parcel modal — shown after drawing */}
      {drawnGeometry && (
        <NewParcelModal geometry={drawnGeometry} onClose={() => setDrawnGeometry(null)} />
      )}

      {drawnDepositGeometry && (
        <DepositGeofenceModal
          geometry={drawnDepositGeometry}
          deposits={deposits}
          onClose={() => setDrawnDepositGeometry(null)}
        />
      )}

      {/* Edit-parcel-info modal */}
      {editingParcelInfo && (
        <EditParcelInfoModal parcel={editingParcelInfo} onClose={() => setEditingParcelInfo(null)} />
      )}

      {/* KML import modal */}
      {kmlParcels && (
        <KmlImportModal parcels={kmlParcels} onClose={() => setKmlParcels(null)} />
      )}
    </div>
  );
}
