'use client';
export const dynamic = 'force-dynamic';

import { useState, useMemo, useCallback } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  Check,
  MapPin,
  Wheat,
  ChevronUp,
  ChevronDown,
  Tractor,
  XCircle,
  Layers,
  Search,
  Boxes,
} from 'lucide-react';
import {
  useParcels,
  useCreateParcel,
  useUpdateParcel,
  useDeleteParcel,
  useFarms,
} from '@strawboss/api';
import type { Parcel, Farm } from '@strawboss/types';
import { HarvestStatus, CropType, HARVEST_STATUS_RANK } from '@strawboss/types';
import { HarvestStatusBadge } from '@/components/shared/StatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList as normalize } from '@/lib/normalize-api-list';
import { BaleOverrideModal } from '@/components/features/parcels/BaleOverrideModal';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Hectares from API may be number or string (Postgres numeric → JSON). */
function parseHa(ha: unknown): number | null {
  if (ha == null || ha === '') return null;
  const n = typeof ha === 'number' ? ha : Number(String(ha).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function fmtHa(ha: unknown) {
  const n = parseHa(ha);
  if (n == null) return '—';
  return `${n.toFixed(2).replace('.', ',')} ha`;
}

const HARVEST_STATUS_OPTIONS = [
  HarvestStatus.planned,
  HarvestStatus.to_harvest,
  HarvestStatus.harvesting,
  HarvestStatus.partial_harvested,
  HarvestStatus.harvested,
  HarvestStatus.in_loading,
  HarvestStatus.loaded,
  HarvestStatus.completed,
] as const;

const CROP_TYPE_OPTIONS = [
  CropType.grau,
  CropType.orz,
  CropType.rapita,
  CropType.plante_nutret,
  CropType.altele,
] as const;

// ─── StatCard ────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}
function StatCard({ icon, label, value, sub, accent = 'text-primary' }: StatCardProps) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100 ${accent}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-neutral-900 leading-none">{value}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{label}</p>
        {sub && <p className="mt-0.5 text-xs text-neutral-400">{sub}</p>}
      </div>
    </div>
  );
}

// ─── ParcelFormModal ──────────────────────────────────────────────────────────

interface ParcelFormModalProps {
  parcel?: Parcel;
  farms: Farm[];
  onClose: () => void;
}

function ParcelFormModal({ parcel, farms, onClose }: ParcelFormModalProps) {
  const { t } = useI18n();
  const isEdit = !!parcel;

  // T9.3 — `name` is no longer surfaced; we keep the field undefined in the
  // payload so the server preserves whatever's there (or leaves it empty).
  const [areaHectares, setAreaHectares] = useState(
    parcel?.areaHectares != null ? String(parcel.areaHectares) : '',
  );
  const [farmId, setFarmId] = useState(parcel?.farmId ?? '');
  const [municipality, setMunicipality] = useState(parcel?.municipality ?? '');
  const [address, setAddress] = useState(parcel?.address ?? '');
  const [notes, setNotes] = useState(parcel?.notes ?? '');
  const [harvestStatus, setHarvestStatus] = useState<HarvestStatus>(
    parcel?.harvestStatus ?? HarvestStatus.planned,
  );
  // T9.1 — crop type dropdown (nullable on storage).
  const [cropType, setCropType] = useState<CropType | ''>(parcel?.cropType ?? '');
  const [error, setError] = useState('');

  // Harvest status is monotonic — the DB trigger trg_prevent_harvest_status_downgrade
  // refuses any move backward on the ladder. Mirror that in the UI: when editing,
  // disable every option below the parcel's current stage so a downgrade can't even
  // be attempted. On create the floor is 0 (planned) → all options available.
  const statusFloorRank = parcel ? HARVEST_STATUS_RANK[parcel.harvestStatus] : 0;

  const createParcel = useCreateParcel(apiClient);
  const updateParcel = useUpdateParcel(apiClient);
  const isPending = createParcel.isPending || updateParcel.isPending;

  const handleSubmit = useCallback(async () => {
    setError('');

    const payload = {
      // T9.3 — `name` deliberately omitted; server keeps existing value on edit
      // and accepts empty string on create.
      name: undefined,
      areaHectares: areaHectares ? parseFloat(areaHectares) : undefined,
      farmId: farmId || null,
      municipality: municipality.trim() || undefined,
      address: address.trim() || undefined,
      notes: notes.trim() || undefined,
      harvestStatus,
      cropType: cropType || null,
      // T9.2 — `isActive` is no longer surfaced in the UI; server keeps it true.
    };

    if (isEdit && parcel) {
      updateParcel.mutate(
        { id: parcel.id, data: payload },
        {
          onSuccess: onClose,
          onError: () => setError(t('parcels.form.updateError')),
        },
      );
    } else {
      createParcel.mutate(payload, {
        onSuccess: onClose,
        onError: () => setError(t('parcels.form.createError')),
      });
    }
  }, [
    areaHectares,
    farmId,
    municipality,
    address,
    notes,
    harvestStatus,
    cropType,
    isEdit,
    parcel,
    createParcel,
    updateParcel,
    onClose,
    t,
  ]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        style={{ maxHeight: 'min(90vh, 700px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-800">
              {isEdit ? t('parcels.form.editTitle') : t('parcels.form.createTitle')}
            </h2>
            {isEdit && <p className="text-xs text-neutral-400 mt-0.5 font-mono">{parcel?.code}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* T9.3 — name input intentionally omitted; parcels are identified by code. */}

          {/* Area + Farm */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('parcels.form.area')}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={areaHectares}
                onChange={(e) => setAreaHectares(e.target.value)}
                placeholder={t('parcels.form.placeholders.area')}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('parcels.form.farm')}
              </label>
              <select
                value={farmId}
                onChange={(e) => setFarmId(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">{t('parcels.form.noFarm')}</option>
                {farms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Municipality + Address */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('parcels.form.municipality')}
              </label>
              <input
                type="text"
                value={municipality}
                onChange={(e) => setMunicipality(e.target.value)}
                placeholder={t('parcels.form.placeholders.municipality')}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('parcels.form.address')}
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t('parcels.form.placeholders.address')}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              {t('parcels.form.notes')}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('parcels.form.placeholders.notes')}
              rows={2}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          {/* Harvest status + Crop type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('parcels.form.harvestStatus')}
              </label>
              <select
                value={harvestStatus}
                onChange={(e) => setHarvestStatus(e.target.value as HarvestStatus)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {HARVEST_STATUS_OPTIONS.map((v) => (
                  <option key={v} value={v} disabled={HARVEST_STATUS_RANK[v] < statusFloorRank}>
                    {t(`parcels.harvest.${v}`)}
                  </option>
                ))}
              </select>
              {isEdit && statusFloorRank > 0 && (
                <p className="mt-1 text-xs text-neutral-400">
                  {t('parcels.form.harvestNoDowngrade')}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('parcels.crop.label')}
              </label>
              <select
                value={cropType}
                onChange={(e) => setCropType((e.target.value || '') as CropType | '')}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">{t('parcels.crop.placeholder')}</option>
                {CROP_TYPE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {t(`parcels.crop.${v}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* T9.2 — is_active toggle removed from UI; server keeps the column. */}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              <XCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
          >
            {t('parcels.form.cancel')}
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {isEdit ? t('parcels.form.save') : t('parcels.form.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DeleteDialog ─────────────────────────────────────────────────────────────

interface DeleteDialogProps {
  parcel: Parcel;
  onClose: () => void;
}

function DeleteDialog({ parcel, onClose }: DeleteDialogProps) {
  const { t } = useI18n();
  const deleteParcel = useDeleteParcel(apiClient);

  const handleDelete = useCallback(() => {
    deleteParcel.mutate(parcel.id, { onSettled: onClose });
  }, [parcel.id, deleteParcel, onClose]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-100">
          <Trash2 className="h-6 w-6 text-red-500" />
        </div>
        <h2 className="text-base font-semibold text-neutral-800">
          {t('parcels.deleteDialog.title')}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {t('parcels.deleteDialog.body', {
            code: parcel.code,
            namePart: parcel.name ? ` — ${parcel.name}` : '',
          })}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteParcel.isPending}
            className="flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            {deleteParcel.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {t('parcels.deleteDialog.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sort (crescător / descrescător) ─────────────────────────────────────────

type SortDir = 'asc' | 'desc';

type ParcelSortKey =
  | 'code'
  | 'farmId'
  | 'municipality'
  | 'areaHectares'
  | 'harvestStatus'
  | 'cropType'
  | 'balesProduced'
  | 'balesLoaded'
  | 'balesRemaining';

/** Două săgeți: direcția activă e evidențiată; coloana sortată folosește culoarea primary. */
function ThSortIndicator({
  columnKey,
  sortKey,
  sortDir,
}: {
  columnKey: ParcelSortKey;
  sortKey: ParcelSortKey;
  sortDir: SortDir;
}) {
  const active = sortKey === columnKey;
  return (
    <span className="ml-1 inline-flex flex-col leading-[0.65]" aria-hidden>
      <ChevronUp
        className={`h-3 w-3 shrink-0 ${
          active && sortDir === 'asc' ? 'text-primary' : 'text-neutral-300'
        }`}
      />
      <ChevronDown
        className={`h-3 w-3 shrink-0 -mt-0.5 ${
          active && sortDir === 'desc' ? 'text-primary' : 'text-neutral-300'
        }`}
      />
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ParcelsPage() {
  const { t } = useI18n();
  const { data: rawParcels, isLoading, isError } = useParcels(apiClient);
  const { data: rawFarms } = useFarms(apiClient);

  const parcels = useMemo(() => normalize<Parcel>(rawParcels), [rawParcels]);
  const farms = useMemo(() => normalize<Farm>(rawFarms), [rawFarms]);
  const farmMap = useMemo(() => new Map(farms.map((f) => [f.id, f.name])), [farms]);

  // Filters
  const [search, setSearch] = useState('');
  // T9.2 — active/inactive filter removed from UI.
  const [harvestFilter, setHarvestFilter] = useState<'' | HarvestStatus>('');
  const [municipalityFilter, setMunicipalityFilter] = useState('');
  const [farmFilter, setFarmFilter] = useState(''); // '' = all, '__none__' = unassigned, else farmId

  // Sort: o singură actualizare de stare → toggle asc/desc fiabil la același antet
  const [tableSort, setTableSort] = useState<{ key: ParcelSortKey; dir: SortDir }>({
    key: 'code',
    dir: 'asc',
  });

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [editParcel, setEditParcel] = useState<Parcel | null>(null);
  const [deleteParcel, setDeleteParcel] = useState<Parcel | null>(null);
  const [baleParcel, setBaleParcel] = useState<Parcel | null>(null);

  const handleSort = useCallback((key: ParcelSortKey) => {
    setTableSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  }, []);

  // Derived: unique sorted municipalities
  const municipalities = useMemo(() => {
    const set = new Set(parcels.map((p) => p.municipality).filter(Boolean));
    return Array.from(set).sort();
  }, [parcels]);

  // Filtered + sorted
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = parcels.filter((p) => {
      // T9.3 — search now matches `code` and location only (name deprecated).
      if (q && ![p.code, p.municipality].some((v) => v?.toLowerCase().includes(q))) return false;
      if (harvestFilter && (p.harvestStatus ?? HarvestStatus.planned) !== harvestFilter)
        return false;
      if (municipalityFilter && p.municipality !== municipalityFilter) return false;
      if (farmFilter === '__none__' && p.farmId) return false;
      if (farmFilter && farmFilter !== '__none__' && p.farmId !== farmFilter) return false;
      return true;
    });

    const { key: sortKey, dir: sortDir } = tableSort;

    list = [...list].sort((a, b) => {
      let cmp = 0;

      if (sortKey === 'areaHectares') {
        const na = parseHa(a.areaHectares) ?? 0;
        const nb = parseHa(b.areaHectares) ?? 0;
        cmp = na < nb ? -1 : na > nb ? 1 : 0;
      } else if (sortKey === 'harvestStatus') {
        const sa = String(a.harvestStatus ?? HarvestStatus.planned);
        const sb = String(b.harvestStatus ?? HarvestStatus.planned);
        cmp = sa.localeCompare(sb, 'ro', { sensitivity: 'base' });
      } else if (sortKey === 'cropType') {
        const sa = String(a.cropType ?? '');
        const sb = String(b.cropType ?? '');
        cmp = sa.localeCompare(sb, 'ro', { sensitivity: 'base' });
      } else if (sortKey === 'farmId') {
        const sa = a.farmId ? (farmMap.get(a.farmId) ?? '') : '';
        const sb = b.farmId ? (farmMap.get(b.farmId) ?? '') : '';
        cmp = sa.localeCompare(sb, 'ro', { sensitivity: 'base' });
      } else if (sortKey === 'balesProduced' || sortKey === 'balesLoaded') {
        const na = Number(a[sortKey] ?? 0);
        const nb = Number(b[sortKey] ?? 0);
        cmp = na < nb ? -1 : na > nb ? 1 : 0;
      } else if (sortKey === 'balesRemaining') {
        const na = Number(a.balesProduced ?? 0) - Number(a.balesLoaded ?? 0);
        const nb = Number(b.balesProduced ?? 0) - Number(b.balesLoaded ?? 0);
        cmp = na < nb ? -1 : na > nb ? 1 : 0;
      } else {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        const sa = aVal == null ? '' : String(aVal);
        const sb = bVal == null ? '' : String(bVal);
        cmp = sa.localeCompare(sb, 'ro', { sensitivity: 'base' });
      }

      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [parcels, search, harvestFilter, municipalityFilter, farmFilter, tableSort, farmMap]);

  // Stats (T9.2 — active counter dropped; with-crop counter added)
  const stats = useMemo(
    () => ({
      total: parcels.length,
      withCrop: parcels.filter((p) => p.cropType != null).length,
      totalHa: parcels.reduce((s, p) => s + (parseHa(p.areaHectares) ?? 0), 0),
      unassigned: parcels.filter((p) => !p.farmId).length,
    }),
    [parcels],
  );

  const thClass =
    'cursor-pointer select-none px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-700 whitespace-nowrap';

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <PageHeader
        title={t('parcels.title')}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('parcels.newParcel')}
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          icon={<Layers className="h-5 w-5" />}
          label={t('parcels.stats.total')}
          value={stats.total}
          accent="text-primary"
        />
        <StatCard
          icon={<Wheat className="h-5 w-5" />}
          label={t('parcels.stats.withCrop')}
          value={stats.withCrop}
          accent="text-green-600"
        />
        <StatCard
          icon={<Wheat className="h-5 w-5" />}
          label={t('parcels.stats.area')}
          value={fmtHa(stats.totalHa)}
          accent="text-amber-600"
        />
        <StatCard
          icon={<Tractor className="h-5 w-5" />}
          label={t('parcels.stats.unassigned')}
          value={stats.unassigned}
          sub={stats.unassigned > 0 ? t('parcels.unassignedSub') : t('parcels.unassignedSubAll')}
          accent="text-neutral-400"
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('parcels.searchPlaceholder')}
          />
        </div>

        {/* T9.2 — active/inactive filter removed. */}

        <select
          value={harvestFilter}
          onChange={(e) => setHarvestFilter((e.target.value || '') as '' | HarvestStatus)}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">{t('parcels.filterAllHarvest')}</option>
          {HARVEST_STATUS_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {t(`parcels.harvest.${v}`)}
            </option>
          ))}
        </select>

        <select
          value={municipalityFilter}
          onChange={(e) => setMunicipalityFilter(e.target.value)}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">{t('parcels.filterAllMunicipalities')}</option>
          {municipalities.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          value={farmFilter}
          onChange={(e) => setFarmFilter(e.target.value)}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">{t('parcels.filterAllFarms')}</option>
          <option value="__none__">{t('parcels.filterUnassigned')}</option>
          {farms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>

        {(search || harvestFilter || municipalityFilter || farmFilter) && (
          <button
            onClick={() => {
              setSearch('');
              setHarvestFilter('');
              setMunicipalityFilter('');
              setFarmFilter('');
            }}
            className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-500 hover:bg-neutral-50"
          >
            <X className="h-3 w-3" />
            {t('parcels.resetFilters')}
          </button>
        )}

        <span className="ml-auto text-xs text-neutral-400">
          {filtered.length === 1
            ? t('parcels.count', { count: filtered.length })
            : t('parcels.countPlural', { count: filtered.length })}
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-neutral-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          {t('parcels.loading')}
        </div>
      ) : isError ? (
        <div className="py-16 text-center text-sm text-red-500">{t('parcels.loadError')}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-20 text-neutral-400">
          <Search className="h-10 w-10 mb-3 opacity-20" />
          <p className="text-sm font-medium">{t('parcels.empty')}</p>
          {search || harvestFilter || municipalityFilter || farmFilter ? (
            <button
              onClick={() => {
                setSearch('');
                setHarvestFilter('');
                setMunicipalityFilter('');
                setFarmFilter('');
              }}
              className="mt-2 text-xs text-primary hover:underline"
            >
              {t('parcels.clearFilters')}
            </button>
          ) : (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('parcels.addFirst')}
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                {[
                  { key: 'code' as const, label: t('parcels.colCode') },
                  { key: 'farmId' as const, label: t('parcels.colFarm') },
                  { key: 'municipality' as const, label: t('parcels.colMunicipality') },
                  { key: 'areaHectares' as const, label: t('parcels.colArea') },
                  { key: 'cropType' as const, label: t('parcels.crop.label') },
                  { key: 'harvestStatus' as const, label: t('parcels.colHarvestStatus') },
                  { key: 'balesProduced' as const, label: t('parcels.colProduced') },
                  { key: 'balesLoaded' as const, label: t('parcels.colDelivered') },
                  { key: 'balesRemaining' as const, label: t('parcels.colRemaining') },
                ].map(({ key, label }) => (
                  <th
                    key={key}
                    className={thClass}
                    onClick={() => handleSort(key)}
                    title={t('parcels.sortHint')}
                  >
                    <div className="flex items-center">
                      {label}
                      <ThSortIndicator
                        columnKey={key}
                        sortKey={tableSort.key}
                        sortDir={tableSort.dir}
                      />
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtered.map((p) => {
                const farmName = p.farmId ? (farmMap.get(p.farmId) ?? null) : null;
                return (
                  <tr key={p.id} className="hover:bg-neutral-50/60 transition-colors">
                    {/* Cod — T9.3 primary identifier */}
                    <td className="px-4 py-3 max-w-[220px]">
                      <span className="font-mono text-xs bg-neutral-100 px-2 py-0.5 rounded font-medium text-neutral-700">
                        {p.code}
                      </span>
                      {p.notes && (
                        <p className="truncate text-xs text-neutral-400 mt-0.5">{p.notes}</p>
                      )}
                    </td>

                    {/* Fermă */}
                    <td className="px-4 py-3">
                      {farmName ? (
                        <span className="flex items-center gap-1.5 text-xs text-neutral-700">
                          <Tractor className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                          {farmName}
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-300">—</span>
                      )}
                    </td>

                    {/* Comună */}
                    <td className="px-4 py-3">
                      {p.municipality ? (
                        <span className="flex items-center gap-1 text-xs text-neutral-600">
                          <MapPin className="h-3 w-3 text-neutral-400 flex-shrink-0" />
                          {p.municipality}
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-300">—</span>
                      )}
                    </td>

                    {/* Suprafață */}
                    <td className="px-4 py-3 text-sm tabular-nums text-neutral-700">
                      {fmtHa(p.areaHectares)}
                    </td>

                    {/* Cultură */}
                    <td className="px-4 py-3">
                      {p.cropType ? (
                        <span className="text-xs font-medium text-neutral-700">
                          {t(`parcels.crop.${p.cropType}`)}
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-300">—</span>
                      )}
                    </td>

                    {/* Recoltă / harvest */}
                    <td className="px-4 py-3">
                      <HarvestStatusBadge status={p.harvestStatus ?? HarvestStatus.planned} />
                    </td>

                    {/* Baloți produși */}
                    <td className="px-4 py-3 text-sm tabular-nums text-neutral-700">
                      {Number(p.balesProduced ?? 0)}
                    </td>

                    {/* Baloți livrați (plecați de pe câmp) */}
                    <td className="px-4 py-3 text-sm tabular-nums text-neutral-700">
                      {Number(p.balesLoaded ?? 0)}
                    </td>

                    {/* Rămași pe câmp = produși − livrați */}
                    <td className="px-4 py-3 text-sm tabular-nums">
                      {(() => {
                        const remaining = Number(p.balesProduced ?? 0) - Number(p.balesLoaded ?? 0);
                        return (
                          <span
                            className={
                              remaining > 0 ? 'font-semibold text-amber-600' : 'text-neutral-400'
                            }
                          >
                            {remaining}
                          </span>
                        );
                      })()}
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditParcel(p)}
                          className="rounded-lg p-1.5 text-neutral-400 hover:bg-primary/10 hover:text-primary transition-colors"
                          title={t('common.edit')}
                          aria-label={t('common.edit')}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setBaleParcel(p)}
                          className="rounded-lg p-1.5 text-neutral-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                          title={t('parcels.baleOverride.title')}
                          aria-label={t('parcels.baleOverride.title')}
                        >
                          <Boxes className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteParcel(p)}
                          className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                          title={t('common.delete')}
                          aria-label={t('common.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showCreate && <ParcelFormModal farms={farms} onClose={() => setShowCreate(false)} />}
      {editParcel && (
        <ParcelFormModal parcel={editParcel} farms={farms} onClose={() => setEditParcel(null)} />
      )}
      {deleteParcel && <DeleteDialog parcel={deleteParcel} onClose={() => setDeleteParcel(null)} />}
      {baleParcel && <BaleOverrideModal parcel={baleParcel} onClose={() => setBaleParcel(null)} />}
    </div>
  );
}
