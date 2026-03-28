'use client';
export const dynamic = 'force-dynamic';

import { useState, useCallback, useMemo } from 'react';
import dynamicImport from 'next/dynamic';
import { MapPin, Pencil, Plus, Trash2, XCircle } from 'lucide-react';
import area from '@turf/area';
import { polygon as turfPolygon, multiPolygon as turfMultiPolygon } from '@turf/helpers';
import {
  useParcels,
  useMachineLocations,
  useCreateParcel,
  useUpdateParcel,
  useDeleteParcel,
} from '@strawboss/api';
import type { Parcel } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiClient } from '@/lib/api';

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

// ── Edit-parcel-info modal ─────────────────────────────────────────────────

interface EditParcelInfoModalProps {
  parcel: Parcel;
  onClose: () => void;
}

function EditParcelInfoModal({ parcel, onClose }: EditParcelInfoModalProps) {
  const [name,         setName]         = useState(parcel.name ?? '');
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
          name:         name.trim()        || undefined,
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
          <FormField label="Nume câmp"      value={name}         onChange={setName}         placeholder="ex. Câmpul Mare (opțional)" />
          <FormField label="Localitate"     value={municipality} onChange={setMunicipality} placeholder="ex. Deta" />
          <FormField label="Suprafață (ha)" value={areaHectares} onChange={setAreaHectares} type="number" placeholder="12.5" />
          <FormField label="Note"           value={notes}        onChange={setNotes}        placeholder="Observații opționale" />

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
  const [drawingNewParcel,  setDrawingNewParcel]   = useState(false);
  const [drawnGeometry,     setDrawnGeometry]      = useState<GeoJSON.Geometry | null>(null);
  const [deleteError,       setDeleteError]        = useState<string | null>(null);

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
    setDrawingNewParcel(false);
    setDrawnGeometry(geometry);
  }, []);

  const handleDrawCancel = useCallback(() => {
    setDrawingNewParcel(false);
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
        {/* Left panel: parcel list */}
        <aside className="w-64 flex-shrink-0 overflow-y-auto border-r border-neutral-200 bg-white">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Câmpuri / Parcele
            </p>
            <button
              onClick={() => setDrawingNewParcel(true)}
              title="Adaugă câmp nou"
              className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-white hover:bg-primary/90"
            >
              <Plus className="h-3 w-3" />
              Câmp nou
            </button>
          </div>

          {parcelsLoading && (
            <div className="px-4 py-6 text-center text-sm text-neutral-400">Se încarcă…</div>
          )}

          <ul className="divide-y divide-neutral-100">
            {parcels.map((parcel) => (
              <li
                key={parcel.id}
                className={`cursor-pointer px-4 py-3 transition-colors hover:bg-neutral-50 ${
                  selectedParcelId === parcel.id ? 'border-l-2 border-primary bg-amber-50' : ''
                }`}
                onClick={() => setSelectedParcelId(parcel.id)}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-800">
                      {parcel.name ?? <span className="italic text-neutral-400">Câmp fără nume</span>}
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      {parcel.code}{parcel.municipality ? ` · ${parcel.municipality}` : ''}
                    </p>
                    <p className="text-xs text-neutral-400">
                      {parcel.areaHectares != null ? `${parcel.areaHectares} ha` : '—'}
                    </p>
                  </div>
                  {/* Edit info */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingParcelInfo(parcel); }}
                    className="flex-shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-primary"
                    title="Editează informații"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {/* Edit boundary */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditParcel(parcel); }}
                    className="flex-shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-blue-600"
                    title="Editează limita pe hartă"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                  </button>
                  {/* Delete */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleParcelDelete(parcel.id); }}
                    disabled={deleteParcel.isPending}
                    className="flex-shrink-0 rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                    title="Șterge câmpul"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
            {!parcelsLoading && parcels.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-neutral-400">
                Nicio parcelă. Desenează pe hartă sau apasă "+ Câmp nou".
              </li>
            )}
          </ul>

          {/* Machine list (compact) */}
          {machines.length > 0 && (
            <div className="border-t border-neutral-200">
              <div className="px-4 py-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Mașini active
                </p>
              </div>
              <ul className="divide-y divide-neutral-100 pb-2">
                {machines.map((m) => {
                  const online = (Date.now() - new Date(m.recordedAt).getTime()) < 15 * 60 * 1000;
                  return (
                    <li key={m.machineId} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 flex-shrink-0 rounded-full"
                          style={{ background: online ? '#16a34a' : '#9ca3af' }} />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-neutral-700">
                            {m.machineCode ?? m.machineType ?? 'Mașină'}
                          </p>
                          {m.operatorName && (
                            <p className="truncate text-xs text-neutral-400">{m.operatorName}</p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
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
            drawingNewParcel={drawingNewParcel}
            onNewParcelDrawn={handleNewParcelDrawn}
            onDrawCancel={handleDrawCancel}
          />
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
    </div>
  );
}
