'use client';
export const dynamic = 'force-dynamic';

import { useState, useCallback, useMemo } from 'react';
import dynamicImport from 'next/dynamic';
import { MapPin, Plus, XCircle } from 'lucide-react';
import area from '@turf/area';
import { polygon as turfPolygon, multiPolygon as turfMultiPolygon } from '@turf/helpers';
import {
  useParcels,
  useMachineLocations,
  useCreateParcel,
  useUpdateParcel,
  useDeleteParcel,
} from '@strawboss/api';
import type { Parcel, MachineLastLocation, RoutePoint } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { RouteHistoryPanel } from '@/components/map/RouteHistoryPanel';
import { FilterableParcelList } from '@/components/map/FilterableParcelList';
import { FilterableMachineList } from '@/components/map/FilterableMachineList';
import { apiClient } from '@/lib/api';
import { type KmlParsedParcel } from '@/lib/kml-parser';

// Leaflet cannot run on the server — disable SSR for the map component.
const LeafletMap = dynamicImport(
  () => import('@/components/map/LeafletMap').then((m) => ({ default: m.LeafletMap })),
  { ssr: false, loading: () => <MapLoadingPlaceholder /> },
);

function MapLoadingPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-100">
      <div className="text-center text-sm text-neutral-400">
        <MapPin className="mx-auto mb-2 h-8 w-8 opacity-30" />
        Se încarcă harta…
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
            <h2 className="text-base font-semibold text-white">Câmp nou desenat</h2>
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
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xl">
                🌾
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-primary/70">
                  Suprafață estimată
                </p>
                <p className="text-2xl font-bold text-primary">{previewHa} ha</p>
              </div>
            </div>
          ) : (
            <div className="mb-5 flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-5 py-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl">
                🗺️
              </div>
              <p className="text-sm text-neutral-600">Câmpul a fost desenat pe hartă.</p>
            </div>
          )}

          <p className="text-sm text-neutral-500">
            Codul, suprafața exactă și localitatea vor fi completate automat de server.
            Poți seta <span className="font-medium text-neutral-700">numele câmpului</span> oricând
            apăsând butonul <span className="font-medium text-neutral-700">✏️ Editează</span>.
          </p>

          {createParcel.isError && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span className="flex-shrink-0">⚠️</span>
              <span>{(createParcel.error as Error)?.message ?? 'Eroare la salvare. Încearcă din nou.'}</span>
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
            Anulează
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
                Se salvează…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Salvează câmpul
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
            <span className="text-lg">📂</span>
            <h2 className="text-base font-semibold text-white">
              Import KML — {total} parcel{total === 1 ? 'ă' : 'e'} găsit{total === 1 ? 'ă' : 'e'}
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
                <span className="truncate text-neutral-700">{p.name || `Parcelă ${i + 1}`}</span>
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
            Se importă {progress.done} / {total}…
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
            <p className="font-medium text-neutral-800">Import finalizat</p>
            <p className="mt-1 text-neutral-500">
              ✅ {progress.done - progress.failed} importate cu succes
              {progress.failed > 0 && (
                <>, ⚠️ {progress.failed} eșuate</>
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
              Închide
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={importing}
                className="rounded-lg border border-neutral-300 bg-white px-5 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-100 disabled:opacity-50"
              >
                Anulează
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
                    Se importă…
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Import {total} parcel{total === 1 ? 'ă' : 'e'}
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
          <h2 className="text-lg font-semibold text-neutral-800">Editează câmpul</h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100">
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <FormField label="Nume câmp"         value={name}         onChange={setName}         placeholder="ex. Câmpul Mare (opțional)" />
          <FormField label="Proprietar"       value={ownerName}    onChange={setOwnerName}    placeholder="ex. Ion Popescu (opțional)" />
          <FormField label="Contact proprietar" value={ownerContact} onChange={setOwnerContact} placeholder="ex. 0721-xxx-xxx (opțional)" />
          <FormField label="Localitate"       value={municipality} onChange={setMunicipality} placeholder="ex. Deta" />
          <FormField label="Suprafață (ha)"   value={areaHectares} onChange={setAreaHectares} type="number" placeholder="12.5" />
          <FormField label="Note"             value={notes}        onChange={setNotes}        placeholder="Observații opționale" />

          {updateParcel.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(updateParcel.error as Error)?.message ?? 'Eroare la salvare'}
            </p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <ModalCancelBtn onClick={onClose} />
            <button type="submit" disabled={updateParcel.isPending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60">
              {updateParcel.isPending ? 'Se salvează…' : 'Salvează'}
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
  return (
    <button type="button" onClick={onClick}
      className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
      Anulează
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function MapPage() {
  const { data: parcelsRaw, isLoading: parcelsLoading } = useParcels(apiClient);
  const { data: machines = [] }                         = useMachineLocations(apiClient);
  const deleteParcel                                    = useDeleteParcel(apiClient);

  const [selectedParcelId,  setSelectedParcelId]  = useState<string | null>(null);
  const [editParcel,        setEditParcel]         = useState<Parcel | null>(null);
  const [editingParcelInfo, setEditingParcelInfo]  = useState<Parcel | null>(null);
  const [drawnGeometry,     setDrawnGeometry]      = useState<GeoJSON.Geometry | null>(null);
  const [deleteError,       setDeleteError]        = useState<string | null>(null);
  const [selectedMachineId,  setSelectedMachineId]  = useState<string | null>(null);
  const [routePoints,        setRoutePoints]        = useState<RoutePoint[] | undefined>(undefined);
  const [navigateToParcelId,  setNavigateToParcelId]  = useState<string | null>(null);
  const [navigateToMachineId, setNavigateToMachineId] = useState<string | null>(null);
  const [kmlParcels,         setKmlParcels]         = useState<KmlParsedParcel[] | null>(null);

  const parcels = (
    Array.isArray(parcelsRaw) ? parcelsRaw : (parcelsRaw as { data?: Parcel[] })?.data ?? []
  ) as Parcel[];

  const handleParcelSelect = useCallback((id: string) => setSelectedParcelId(id), []);

  const handleParcelEdit = useCallback((parcel: Parcel) => {
    setEditingParcelInfo(parcel);
  }, []);

  const handleParcelDelete = useCallback((id: string) => {
    const parcel = parcels.find((p) => p.id === id);
    const label  = parcel?.name ?? parcel?.code ?? id;
    if (!confirm(`Ștergi câmpul "${label}"? Această acțiune nu poate fi anulată.`)) return;
    setDeleteError(null);
    deleteParcel.mutate(id, {
      onError: (err) => {
        const msg = (err as Error)?.message ?? 'Eroare la ștergere';
        console.error('[DELETE parcel]', id, msg);
        setDeleteError(`Eroare: ${msg}`);
      },
    });
  }, [parcels, deleteParcel]);

  const handleNewParcelDrawn = useCallback((geometry: GeoJSON.Geometry) => {
    setDrawnGeometry(geometry);
  }, []);

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

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader title="Hartă câmpuri" />
      {deleteError && (
        <div className="mx-4 mt-2 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span>{deleteError}</span>
          <button onClick={() => setDeleteError(null)} className="ml-3 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden rounded-xl border border-neutral-200 shadow-sm">
        {/* Left panel: parcel + machine lists with filters */}
        <aside className="w-72 flex-shrink-0 overflow-y-auto border-r border-neutral-200 bg-white">
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
            onMachineNavigate={handleMachineNavigate}
            onMachineShowRoute={handleShowRoute}
          />
        </aside>

        {/* Right panel: map */}
        <div className="relative flex-1">
          <LeafletMap
            parcels={parcels}
            machines={machines}
            selectedParcelId={selectedParcelId}
            onParcelSelect={handleParcelSelect}
            onParcelEdit={handleParcelEdit}
            onParcelDelete={handleParcelDelete}
            editParcel={editParcel}
            onEditDone={() => setEditParcel(null)}
            onNewParcelDrawn={handleNewParcelDrawn}
            routePoints={routePoints}
            onShowRoute={handleShowRoute}
            navigateToParcelId={navigateToParcelId}
            navigateToMachineId={navigateToMachineId}
            onNavigationComplete={handleNavigationComplete}
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
