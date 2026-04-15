'use client';
export const dynamic = 'force-dynamic';

import { useState, useCallback, useMemo } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
  Tractor,
  MapPin,
  Search,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  useFarms,
  useCreateFarm,
  useUpdateFarm,
  useDeleteFarm,
  useParcels,
  useAssignParcelToFarm,
} from '@strawboss/api';
import type { Farm, Parcel } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

// ── Assign Parcel Modal ────────────────────────────────────────────────────

interface AssignParcelModalProps {
  farm: Farm;
  unassignedParcels: Parcel[];
  onClose: () => void;
}

function AssignParcelModal({ farm, unassignedParcels, onClose }: AssignParcelModalProps) {
  const assignParcel = useAssignParcelToFarm(apiClient);
  const [search, setSearch] = useState('');
  const [municipalityFilter, setMunicipalityFilter] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  /** Unique municipalities from available parcels, sorted. */
  const municipalities = useMemo(() => {
    const set = new Set(unassignedParcels.map((p) => p.municipality).filter(Boolean));
    return Array.from(set).sort();
  }, [unassignedParcels]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return unassignedParcels.filter((p) => {
      if (municipalityFilter && p.municipality !== municipalityFilter) return false;
      if (!q) return true;
      return (
        (p.code ?? '').toLowerCase().includes(q) ||
        (p.name ?? '').toLowerCase().includes(q) ||
        (p.municipality ?? '').toLowerCase().includes(q)
      );
    });
  }, [unassignedParcels, search, municipalityFilter]);

  const allSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.add(p.id));
        return next;
      });
    }
  }, [allSelected, filtered]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (selected.size === 0) return;
    setSaving(true);
    const ids = Array.from(selected);
    await Promise.all(ids.map((parcelId) =>
      new Promise<void>((resolve) => {
        assignParcel.mutate({ parcelId, farmId: farm.id }, { onSettled: () => resolve() });
      }),
    ));
    setSaving(false);
    onClose();
  }, [selected, farm.id, assignParcel, onClose]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        style={{ maxHeight: 'min(90vh, 680px)' }}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-neutral-800">
              Adaugă câmpuri la fermă
            </h2>
            <p className="truncate text-sm text-neutral-500">{farm.name}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 flex-shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Caută după cod, nume sau localitate…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 py-2.5 pl-9 pr-4 text-sm text-neutral-800 placeholder-neutral-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-300 hover:text-neutral-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Municipality filter chips */}
        {municipalities.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto px-4 pt-2 pb-1 scrollbar-none">
            <button
              onClick={() => setMunicipalityFilter('')}
              className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                municipalityFilter === ''
                  ? 'bg-primary text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              Toate
            </button>
            {municipalities.map((m) => (
              <button
                key={m}
                onClick={() => setMunicipalityFilter(municipalityFilter === m ? '' : m)}
                className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  municipalityFilter === m
                    ? 'bg-primary text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {/* Select-all row */}
        {filtered.length > 0 && (
          <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-2">
            <button
              onClick={toggleAll}
              className="flex items-center gap-2 text-xs text-neutral-500 hover:text-neutral-700"
            >
              {allSelected ? (
                <CheckSquare className="h-4 w-4 text-primary" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              Selectează toate ({filtered.length})
            </button>
          </div>
        )}

        {/* Parcel list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-neutral-400">
              <Search className="mb-2 h-8 w-8 opacity-30" />
              <p className="text-sm">Niciun câmp găsit</p>
              {(search || municipalityFilter) && (
                <button
                  onClick={() => { setSearch(''); setMunicipalityFilter(''); }}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  Șterge filtrele
                </button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-neutral-50 px-2 py-1">
              {filtered.map((parcel) => {
                const isSelected = selected.has(parcel.id);
                return (
                  <li key={parcel.id}>
                    <button
                      onClick={() => toggleOne(parcel.id)}
                      className={`flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${
                        isSelected
                          ? 'bg-primary/5'
                          : 'hover:bg-neutral-50'
                      }`}
                    >
                      {isSelected ? (
                        <CheckSquare className="h-4 w-4 flex-shrink-0 text-primary" />
                      ) : (
                        <Square className="h-4 w-4 flex-shrink-0 text-neutral-300" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-medium ${isSelected ? 'text-primary' : 'text-neutral-700'}`}>
                          {parcel.name ?? parcel.code}
                        </p>
                        <p className="truncate text-xs text-neutral-400">
                          {parcel.code}
                          {parcel.municipality ? ` · ${parcel.municipality}` : ''}
                        </p>
                      </div>
                      {parcel.areaHectares != null && (
                        <span className="flex-shrink-0 text-xs text-neutral-400">
                          {parcel.areaHectares} ha
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-100 bg-neutral-50 px-4 py-3">
          <span className="text-sm text-neutral-500">
            {selected.size > 0
              ? `${selected.size} câmp${selected.size === 1 ? '' : 'uri'} selectat${selected.size === 1 ? '' : 'e'}`
              : 'Niciun câmp selectat'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
            >
              Anulează
            </button>
            <button
              onClick={() => void handleConfirm()}
              disabled={selected.size === 0 || saving}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Adaugă
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Farms Page ─────────────────────────────────────────────────────────────

export default function FarmsPage() {
  const { t } = useI18n();
  const { data: farmsRaw = [], isLoading: farmsLoading } = useFarms(apiClient);
  const { data: parcelsRaw = [] } = useParcels(apiClient);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const farms = (Array.isArray(farmsRaw) ? farmsRaw : (farmsRaw as any)?.data ?? []) as Farm[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parcels = (Array.isArray(parcelsRaw) ? parcelsRaw : (parcelsRaw as any)?.data ?? []) as Parcel[];

  const createFarm   = useCreateFarm(apiClient);
  const updateFarm   = useUpdateFarm(apiClient);
  const deleteFarm   = useDeleteFarm(apiClient);
  const assignParcel = useAssignParcelToFarm(apiClient);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createAddress, setCreateAddress] = useState('');

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');

  // Expanded farms (showing assigned parcels)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Which farm has the assign modal open
  const [assignModalFarmId, setAssignModalFarmId] = useState<string | null>(null);

  const handleCreate = useCallback(() => {
    if (!createName.trim()) return;
    createFarm.mutate(
      { name: createName.trim(), address: createAddress.trim() || undefined },
      {
        onSuccess: () => {
          setCreateName('');
          setCreateAddress('');
          setShowCreate(false);
        },
      },
    );
  }, [createName, createAddress, createFarm]);

  const startEdit = useCallback((farm: Farm) => {
    setEditingId(farm.id);
    setEditName(farm.name);
    setEditAddress(farm.address ?? '');
  }, []);

  const handleUpdate = useCallback(() => {
    if (!editingId || !editName.trim()) return;
    updateFarm.mutate(
      { id: editingId, data: { name: editName.trim(), address: editAddress.trim() || undefined } },
      { onSuccess: () => setEditingId(null) },
    );
  }, [editingId, editName, editAddress, updateFarm]);

  const handleDelete = useCallback((farm: Farm) => {
    const parcelCount = parcels.filter((p) => p.farmId === farm.id).length;
    const msg =
      parcelCount > 0
        ? t('farms.deleteConfirmWithParcels', { name: farm.name, count: parcelCount })
        : t('farms.deleteConfirm', { name: farm.name });
    if (!confirm(msg)) return;
    deleteFarm.mutate(farm.id);
  }, [parcels, deleteFarm, t]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleUnassign = useCallback((parcelId: string) => {
    assignParcel.mutate({ parcelId, farmId: null });
  }, [assignParcel]);

  const unassignedParcels = useMemo(
    () => parcels.filter((p) => !p.farmId),
    [parcels],
  );

  const assignModalFarm = farms.find((f) => f.id === assignModalFarmId) ?? null;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page title + create button */}
      <div className="flex items-center justify-between">
        <PageHeader title={t('farms.title')} />
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t('farms.newFarm')}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-neutral-700">Fermă nouă</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Nume *</label>
              <input
                type="text"
                placeholder="Ex: Ferma Ionescu"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Adresă (opțional)</label>
              <input
                type="text"
                placeholder="Ex: Deta, Timiș"
                value={createAddress}
                onChange={(e) => setCreateAddress(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!createName.trim() || createFarm.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {createFarm.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Salvează
            </button>
            <button
              onClick={() => { setShowCreate(false); setCreateName(''); setCreateAddress(''); }}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              Anulează
            </button>
          </div>
        </div>
      )}

      {/* Farms list */}
      {farmsLoading ? (
        <div className="flex items-center justify-center py-16 text-neutral-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Se încarcă fermele…
        </div>
      ) : farms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
          <Tractor className="h-12 w-12 mb-3 opacity-20" />
          <p className="text-sm">Nicio fermă creată încă.</p>
          <p className="text-xs mt-1">Apasă „Fermă nouă" pentru a crea prima fermă.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {farms.map((farm) => {
            const farmParcels = parcels.filter((p) => p.farmId === farm.id);
            const isExpanded = expandedIds.has(farm.id);
            const isEditing = editingId === farm.id;

            return (
              <div key={farm.id} className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
                {/* Farm header */}
                <div className="flex items-center gap-3 px-5 py-4">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100">
                    <Tractor className="h-5 w-5 text-amber-600" />
                  </div>

                  {isEditing ? (
                    <div className="flex flex-1 items-center gap-2 min-w-0">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 min-w-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleUpdate()}
                      />
                      <input
                        type="text"
                        value={editAddress}
                        onChange={(e) => setEditAddress(e.target.value)}
                        placeholder="Adresă"
                        className="w-40 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button
                        onClick={handleUpdate}
                        disabled={!editName.trim() || updateFarm.isPending}
                        className="rounded-lg bg-primary p-1.5 text-white hover:bg-primary/90 disabled:opacity-50"
                      >
                        {updateFarm.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-neutral-300 p-1.5 text-neutral-500 hover:bg-neutral-50"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-neutral-800">{farm.name}</p>
                      {farm.address && (
                        <p className="flex items-center gap-1 text-xs text-neutral-400 mt-0.5">
                          <MapPin className="h-3 w-3" />
                          {farm.address}
                        </p>
                      )}
                    </div>
                  )}

                  {!isEditing && (
                    <div className="flex items-center gap-1">
                      <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600">
                        {farmParcels.length} câmpuri
                      </span>
                      {/* Add fields button — opens search modal */}
                      {unassignedParcels.length > 0 && (
                        <button
                          onClick={() => setAssignModalFarmId(farm.id)}
                          className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-500 hover:border-primary hover:bg-primary/5 hover:text-primary"
                          title="Adaugă câmpuri"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Câmpuri
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(farm)}
                        className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                        title="Editează"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(farm)}
                        className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500"
                        title="Șterge"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => toggleExpand(farm.id)}
                        className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100"
                        title={isExpanded ? 'Ascunde câmpurile' : 'Arată câmpurile'}
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>
                  )}
                </div>

                {/* Assigned parcels list */}
                {isExpanded && (
                  <div className="border-t border-neutral-100 bg-neutral-50">
                    {farmParcels.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-6 text-neutral-400">
                        <p className="text-sm">Niciun câmp asignat acestei ferme.</p>
                        {unassignedParcels.length > 0 && (
                          <button
                            onClick={() => setAssignModalFarmId(farm.id)}
                            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 hover:border-primary hover:text-primary"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Adaugă câmpuri
                          </button>
                        )}
                      </div>
                    ) : (
                      <ul className="divide-y divide-neutral-100">
                        {farmParcels.map((p) => (
                          <li key={p.id} className="flex items-center gap-3 px-6 py-2.5 hover:bg-neutral-100/50">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-neutral-700">{p.name ?? p.code}</p>
                              <p className="text-xs text-neutral-400">
                                {p.code}
                                {p.areaHectares != null ? ` · ${p.areaHectares} ha` : ''}
                                {p.municipality ? ` · ${p.municipality}` : ''}
                              </p>
                            </div>
                            <button
                              onClick={() => handleUnassign(p.id)}
                              className="flex-shrink-0 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-500 hover:border-red-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                              title="Elimină din fermă"
                            >
                              Elimină
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Unassigned parcels summary */}
      {unassignedParcels.length > 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-5 py-4">
          <p className="text-sm font-medium text-neutral-600">
            {unassignedParcels.length} câmp{unassignedParcels.length === 1 ? '' : 'uri'} neasignat{unassignedParcels.length === 1 ? '' : 'e'} niciunei ferme
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            Apasă „+ Câmpuri" pe orice fermă pentru a le asigna.
          </p>
        </div>
      )}

      {/* Assign modal */}
      {assignModalFarm && (
        <AssignParcelModal
          farm={assignModalFarm}
          unassignedParcels={unassignedParcels}
          onClose={() => setAssignModalFarmId(null)}
        />
      )}
    </div>
  );
}
