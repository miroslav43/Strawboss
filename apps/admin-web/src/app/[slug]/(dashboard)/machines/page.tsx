'use client';
export const dynamic = 'force-dynamic';

import { Fragment, useState, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Plus,
  Pencil,
  Trash2,
  XCircle,
  CheckCircle2,
  Wrench,
  AlertTriangle,
  Gauge,
  Truck,
  Wheat,
} from 'lucide-react';
import {
  useMachines,
  useCreateMachine,
  useUpdateMachine,
  useTruckDistanceSummary,
  useMachineLocations,
  queryKeys,
} from '@strawboss/api';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { MachineType, FuelType } from '@strawboss/types';
import type { Machine, TruckDistanceSummary, MachineLastLocation } from '@strawboss/types';
import { UserPresenceDot } from '@/components/shared/UserPresenceDot';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { MachineIconPicker } from '@/components/map/MachineIconPicker';
import { MACHINE_ICONS } from '@/components/map/machine-icons';
import type { MachineType as MapMachineType } from '@/components/map/machine-icons';
import { useMachineIconPrefs } from '@/hooks/useMachineIconPrefs';
import type { IconVariant } from '@/components/map/machine-icons';

// ── Labels / config ───────────────────────────────────────────────────────

const TYPE_ORDER: MachineType[] = [MachineType.truck, MachineType.loader, MachineType.baler];

const TYPE_LABELS: Record<MachineType, string> = {
  [MachineType.loader]: 'Încărcătoare',
  [MachineType.baler]: 'Balotiere',
  [MachineType.truck]: 'Camioane',
};

const TYPE_LABEL_SINGULAR: Record<MachineType, string> = {
  [MachineType.loader]: 'Încărcător',
  [MachineType.baler]: 'Balotieră',
  [MachineType.truck]: 'Camion',
};

function MachineTypeIcon({
  type,
  className = 'h-4 w-4',
}: {
  type: MachineType;
  className?: string;
}) {
  if (type === MachineType.truck) return <Truck className={className} />;
  if (type === MachineType.loader) return <Wrench className={className} />;
  return <Wheat className={className} />;
}

const TYPE_COLORS: Record<MachineType, string> = {
  [MachineType.loader]: 'bg-blue-100 text-blue-700',
  [MachineType.baler]: 'bg-amber-100 text-amber-700',
  [MachineType.truck]: 'bg-green-100 text-green-700',
};

const TYPE_STAT_COLORS: Record<MachineType, string> = {
  [MachineType.loader]: 'bg-blue-50',
  [MachineType.baler]: 'bg-amber-50',
  [MachineType.truck]: 'bg-green-50',
};

const TYPE_PREFIX: Record<MachineType, string> = {
  [MachineType.loader]: 'L',
  [MachineType.baler]: 'B',
  [MachineType.truck]: 'T',
};

const FUEL_LABELS: Record<FuelType, string> = {
  [FuelType.diesel]: 'Diesel',
  [FuelType.gasoline]: 'Benzină',
  [FuelType.electric]: 'Electric',
};

// ── Helpers ───────────────────────────────────────────────────────────────

function toMachineList(raw: unknown): Machine[] {
  if (Array.isArray(raw)) return raw as Machine[];
  const paginated = raw as { data?: Machine[] } | null | undefined;
  return paginated?.data ?? [];
}

function nextCode(machines: Machine[], type: MachineType): string {
  const prefix = TYPE_PREFIX[type];
  const existing = machines
    .filter((m) => m.machineType === type)
    .map((m) => {
      const match = (m.internalCode ?? '').match(/^[A-Z]-(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    });
  const max = existing.length ? Math.max(...existing) : 0;
  return `${prefix}-${String(max + 1).padStart(2, '0')}`;
}

// ── Form state ────────────────────────────────────────────────────────────

interface MachineFormState {
  machineType: MachineType;
  internalCode: string;
  registrationPlate: string;
  make: string;
  model: string;
  year: string;
  fuelType: FuelType;
  tankCapacityLiters: string;
  maxBaleCount: string;
  ownerCompanyName: string;
  ownerCompanyAddress: string;
  ownerCompanyCui: string;
  isActive: boolean;
}

function blankForm(machines: Machine[], type: MachineType = MachineType.loader): MachineFormState {
  return {
    machineType: type,
    internalCode: nextCode(machines, type),
    registrationPlate: '',
    make: '',
    model: '',
    year: String(new Date().getFullYear()),
    fuelType: FuelType.diesel,
    tankCapacityLiters: '',
    maxBaleCount: '',
    ownerCompanyName: '',
    ownerCompanyAddress: '',
    ownerCompanyCui: '',
    isActive: true,
  };
}

function formToPayload(f: MachineFormState): Partial<Machine> {
  return {
    machineType: f.machineType,
    internalCode: f.internalCode.trim(),
    registrationPlate: f.registrationPlate.trim(),
    make: f.make.trim(),
    model: f.model.trim(),
    year: Number(f.year),
    fuelType: f.fuelType,
    tankCapacityLiters: Number(f.tankCapacityLiters),
    maxBaleCount: f.maxBaleCount ? Number(f.maxBaleCount) : null,
    ownerCompanyName: f.ownerCompanyName.trim() || null,
    ownerCompanyAddress: f.ownerCompanyAddress.trim() || null,
    ownerCompanyCui: f.ownerCompanyCui.trim() || null,
    isActive: f.isActive,
  } as Partial<Machine>;
}

function machineToForm(m: Machine): MachineFormState {
  return {
    machineType: m.machineType,
    internalCode: m.internalCode ?? '',
    registrationPlate: m.registrationPlate ?? '',
    make: m.make,
    model: m.model,
    year: String(m.year),
    fuelType: m.fuelType,
    tankCapacityLiters: m.tankCapacityLiters != null ? String(m.tankCapacityLiters) : '',
    maxBaleCount: m.maxBaleCount != null ? String(m.maxBaleCount) : '',
    ownerCompanyName: m.ownerCompanyName ?? '',
    ownerCompanyAddress: m.ownerCompanyAddress ?? '',
    ownerCompanyCui: m.ownerCompanyCui ?? '',
    isActive: m.isActive,
  };
}

// ── Shared UI atoms ───────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const selectCls =
  'rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ErrorBanner({ message }: { message?: string }) {
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
      {message ?? 'A apărut o eroare. Încearcă din nou.'}
    </p>
  );
}

function ModalFooter({
  onCancel,
  submitLabel,
  disabled,
}: {
  onCancel: () => void;
  submitLabel: string;
  disabled: boolean;
}) {
  return (
    <div className="flex justify-end gap-3 pt-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
      >
        Anulează
      </button>
      <button
        type="submit"
        disabled={disabled}
        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
      >
        {submitLabel}
      </button>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
            <Wrench className="h-5 w-5 text-primary" />
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Machine form ──────────────────────────────────────────────────────────

function MachineForm({
  form,
  onChange,
  showIsActive = false,
  allMachines,
}: {
  form: MachineFormState;
  onChange: (patch: Partial<MachineFormState>) => void;
  showIsActive?: boolean;
  allMachines?: Machine[];
}) {
  const handleTypeChange = (type: MachineType) => {
    const suggestedCode = allMachines ? nextCode(allMachines, type) : `${TYPE_PREFIX[type]}-01`;
    onChange({ machineType: type, internalCode: suggestedCode });
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label="Tip mașină" required>
        <select
          value={form.machineType}
          onChange={(e) => handleTypeChange(e.target.value as MachineType)}
          className={inputCls}
        >
          {Object.values(MachineType).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL_SINGULAR[t]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Cod intern" required>
        <input
          required
          value={form.internalCode}
          onChange={(e) => onChange({ internalCode: e.target.value })}
          className={inputCls}
          placeholder="ex. L-01"
        />
      </Field>

      <Field label="Marcă" required>
        <input
          required
          value={form.make}
          onChange={(e) => onChange({ make: e.target.value })}
          className={inputCls}
          placeholder="JCB"
        />
      </Field>

      <Field label="Model" required>
        <input
          required
          value={form.model}
          onChange={(e) => onChange({ model: e.target.value })}
          className={inputCls}
          placeholder="531-70"
        />
      </Field>

      <Field label="An fabricație" required>
        <input
          required
          type="number"
          min={1990}
          max={2100}
          value={form.year}
          onChange={(e) => onChange({ year: e.target.value })}
          className={inputCls}
        />
      </Field>

      <Field label="Nr. înmatriculare" required>
        <input
          required
          value={form.registrationPlate}
          onChange={(e) => onChange({ registrationPlate: e.target.value })}
          className={inputCls}
          placeholder="OS-1234-AB"
        />
      </Field>

      <Field label="Combustibil" required>
        <select
          value={form.fuelType}
          onChange={(e) => onChange({ fuelType: e.target.value as FuelType })}
          className={inputCls}
        >
          {Object.values(FuelType).map((f) => (
            <option key={f} value={f}>
              {FUEL_LABELS[f]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Capacitate rezervor (L)" required>
        <input
          required
          type="number"
          min={0}
          value={form.tankCapacityLiters}
          onChange={(e) => onChange({ tankCapacityLiters: e.target.value })}
          className={inputCls}
          placeholder="120"
        />
      </Field>

      <Field label="Nr. max. baloți">
        <input
          type="number"
          min={0}
          value={form.maxBaleCount}
          onChange={(e) => onChange({ maxBaleCount: e.target.value })}
          className={inputCls}
          placeholder="—"
        />
      </Field>

      <div className="col-span-2 border-t border-neutral-200 pt-2">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Firma proprietară
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Denumire firmă">
            <input
              value={form.ownerCompanyName}
              onChange={(e) => onChange({ ownerCompanyName: e.target.value })}
              className={inputCls}
              placeholder="SC Agro SRL"
            />
          </Field>

          <Field label="CUI firmă">
            <input
              value={form.ownerCompanyCui}
              onChange={(e) => onChange({ ownerCompanyCui: e.target.value })}
              className={inputCls}
              placeholder="RO12345678"
            />
          </Field>

          <div className="col-span-2">
            <Field label="Adresă firmă">
              <input
                value={form.ownerCompanyAddress}
                onChange={(e) => onChange({ ownerCompanyAddress: e.target.value })}
                className={inputCls}
                placeholder="Str. Exemplu nr. 1, Timișoara"
              />
            </Field>
          </div>
        </div>
      </div>

      {showIsActive && (
        <div className="col-span-2 flex items-center gap-2">
          <input
            id="isActive"
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => onChange({ isActive: e.target.checked })}
            className="accent-primary"
          />
          <label htmlFor="isActive" className="text-sm text-neutral-700">
            Mașină activă
          </label>
        </div>
      )}
    </div>
  );
}

// ── Create modal ──────────────────────────────────────────────────────────

function CreateMachineModal({
  onClose,
  allMachines,
}: {
  onClose: () => void;
  allMachines: Machine[];
}) {
  const [form, setForm] = useState<MachineFormState>(() =>
    blankForm(allMachines, MachineType.loader),
  );
  const create = useCreateMachine(apiClient);
  const patch = (p: Partial<MachineFormState>) => setForm((f) => ({ ...f, ...p }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(formToPayload(form), { onSuccess: () => onClose() });
  };

  return (
    <ModalShell title="Mașină nouă" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5 p-6">
        <MachineForm form={form} onChange={patch} allMachines={allMachines} />
        {create.isError && <ErrorBanner message={(create.error as Error)?.message} />}
        <ModalFooter
          onCancel={onClose}
          submitLabel={create.isPending ? 'Se salvează…' : 'Adaugă mașina'}
          disabled={create.isPending}
        />
      </form>
    </ModalShell>
  );
}

// ── Edit modal ────────────────────────────────────────────────────────────

function EditMachineModal({
  machine,
  onClose,
  iconVariant,
  onSetIconVariant,
}: {
  machine: Machine;
  onClose: () => void;
  iconVariant: IconVariant;
  onSetIconVariant: (v: IconVariant) => void;
}) {
  const [form, setForm] = useState<MachineFormState>(() => machineToForm(machine));
  const update = useUpdateMachine(apiClient);
  const patch = (p: Partial<MachineFormState>) => setForm((f) => ({ ...f, ...p }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    update.mutate({ id: machine.id, data: formToPayload(form) }, { onSuccess: () => onClose() });
  };

  const code = machine.internalCode || machine.id.slice(0, 8);
  const mapType = machine.machineType as unknown as MapMachineType;

  return (
    <ModalShell title={`Editează — ${code}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5 p-6">
        <MachineForm form={form} onChange={patch} showIsActive />

        {/* Icon picker — stored in localStorage, not sent to backend */}
        {MACHINE_ICONS[mapType] && (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-2">
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
              Iconiță pe hartă
            </p>
            <MachineIconPicker
              machineType={mapType}
              currentVariant={iconVariant}
              onSet={onSetIconVariant}
            />
          </div>
        )}

        {update.isError && <ErrorBanner message={(update.error as Error)?.message} />}
        <ModalFooter
          onCancel={onClose}
          submitLabel={update.isPending ? 'Se salvează…' : 'Salvează modificările'}
          disabled={update.isPending}
        />
      </form>
    </ModalShell>
  );
}

// ── Delete dialog ─────────────────────────────────────────────────────────

function DeleteDialog({
  machine,
  onConfirm,
  onCancel,
  isPending,
}: {
  machine: Machine;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const label = machine.internalCode || machine.id.slice(0, 8);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
        <div className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-full bg-red-100 p-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="font-semibold text-neutral-800">Ștergi mașina?</p>
              <p className="text-sm text-neutral-500">
                <span className="font-mono font-medium">{label}</span> va fi ștearsă definitiv.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isPending}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Anulează
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isPending}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {isPending ? 'Se șterge…' : 'Șterge'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Type badge ────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: MachineType }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[type]}`}
    >
      <MachineTypeIcon type={type} className="h-3 w-3" />
      {TYPE_LABEL_SINGULAR[type]}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────

function StatCard({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
      <div className={`rounded-lg p-2 ${color}`}>{icon}</div>
      <div>
        <p className="text-xl font-bold text-neutral-800">{value}</p>
        <p className="text-xs text-neutral-500">{label}</p>
      </div>
    </div>
  );
}

// ── Delete hook ───────────────────────────────────────────────────────────

function useDeleteMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/machines/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.machines.all }),
  });
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function MachinesPage() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const { data: machinesRaw, isLoading, isError } = useMachines(apiClient);
  const deleteMachine = useDeleteMachine();

  const machines = toMachineList(machinesRaw);

  // T18 — "today / this week" km summary per truck, used in two columns below.
  const truckDistanceSummary = useTruckDistanceSummary(apiClient);
  const distanceByMachine = useMemo(() => {
    const map = new Map<string, TruckDistanceSummary>();
    for (const row of truckDistanceSummary.data ?? []) {
      map.set(row.machineId, row);
    }
    return map;
  }, [truckDistanceSummary.data]);

  // Last GPS recording per machine — drives the presence badge in the Status
  // column. 15 min threshold since machines emit a position only every few min.
  const MACHINE_ONLINE_MS = 15 * 60 * 1000;
  const machineLocations = useMachineLocations(apiClient);
  const lastSeenByMachine = useMemo(() => {
    const map = new Map<string, string>();
    const rows = (machineLocations.data ?? []) as MachineLastLocation[];
    for (const row of rows) {
      map.set(row.machineId, row.recordedAt);
    }
    return map;
  }, [machineLocations.data]);

  const { setVariant: setIconVariant, getVariant } = useMachineIconPrefs();

  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Machine | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Machine | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [fuelFilter, setFuelFilter] = useState<FuelType | 'all'>('all');

  // ── Stats (unfiltered) ───────────────────────────────────────────────
  const totalMachines = machines.length;
  const activeMachines = machines.filter((m) => m.isActive).length;
  const truckCount = machines.filter((m) => m.machineType === MachineType.truck).length;
  const loaderCount = machines.filter((m) => m.machineType === MachineType.loader).length;
  const balerCount = machines.filter((m) => m.machineType === MachineType.baler).length;

  // ── Filtered + grouped ───────────────────────────────────────────────
  const groups = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = machines.filter((m) => {
      const matchSearch =
        !q ||
        (m.internalCode ?? '').toLowerCase().includes(q) ||
        m.make.toLowerCase().includes(q) ||
        m.model.toLowerCase().includes(q) ||
        (m.registrationPlate ?? '').toLowerCase().includes(q);
      const matchStatus =
        statusFilter === 'all' || (statusFilter === 'active' ? m.isActive : !m.isActive);
      const matchFuel = fuelFilter === 'all' || m.fuelType === fuelFilter;
      return matchSearch && matchStatus && matchFuel;
    });

    return TYPE_ORDER.map((type) => ({
      type,
      machines: filtered
        .filter((m) => m.machineType === type)
        .sort((a, b) => (a.internalCode ?? '').localeCompare(b.internalCode ?? '')),
    })).filter((g) => g.machines.length > 0);
  }, [machines, search, statusFilter, fuelFilter]);

  const totalVisible = groups.reduce((sum, g) => sum + g.machines.length, 0);

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMachine.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('machines.title')}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('machines.newMachine')}
          </button>
        }
      />

      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard
          icon={<Wrench className="h-4 w-4 text-neutral-600" />}
          value={totalMachines}
          label={t('machines.statTotal')}
          color="bg-neutral-100"
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
          value={activeMachines}
          label={t('machines.statActive')}
          color="bg-green-50"
        />
        <StatCard
          icon={<Truck className="h-4 w-4 text-green-600" />}
          value={truckCount}
          label={t('machines.statTrucks')}
          color={TYPE_STAT_COLORS[MachineType.truck]}
        />
        <StatCard
          icon={<Wrench className="h-4 w-4 text-blue-600" />}
          value={loaderCount}
          label={t('machines.statLoaders')}
          color={TYPE_STAT_COLORS[MachineType.loader]}
        />
        <StatCard
          icon={<Wheat className="h-4 w-4 text-amber-600" />}
          value={balerCount}
          label={t('machines.statBalers')}
          color={TYPE_STAT_COLORS[MachineType.baler]}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[240px] flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Caută după cod, marcă, model, nr. înmatriculare…"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className={selectCls}
        >
          <option value="all">Toate statusurile</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select
          value={fuelFilter}
          onChange={(e) => setFuelFilter(e.target.value as typeof fuelFilter)}
          className={selectCls}
        >
          <option value="all">Orice combustibil</option>
          {Object.values(FuelType).map((f) => (
            <option key={f} value={f}>
              {FUEL_LABELS[f]}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-neutral-400">
          {totalVisible} {totalVisible === 1 ? 'mașină' : 'mașini'}
        </span>
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="py-12 text-center text-sm text-neutral-400">Se încarcă mașinile…</div>
      )}
      {isError && (
        <div className="py-12 text-center text-sm text-red-500">
          Eroare la încărcarea mașinilor. Verifică că backend-ul rulează.
        </div>
      )}

      {/* Table */}
      {!isLoading && !isError && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">{t('machines.colCode')}</th>
                <th className="px-4 py-3">{t('machines.colType')}</th>
                <th className="px-4 py-3">{t('machines.colMakeModel')}</th>
                <th className="px-4 py-3">{t('machines.colPlate')}</th>
                <th className="px-4 py-3 text-right">{t('machines.colKmToday')}</th>
                <th className="px-4 py-3 text-right">{t('machines.colKmThisWeek')}</th>
                <th className="px-4 py-3">{t('machines.colFuel')}</th>
                <th className="px-4 py-3">{t('machines.colStatus')}</th>
                <th className="px-4 py-3 text-right">{t('machines.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {groups.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <Gauge className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
                    <p className="text-sm text-neutral-400">
                      {search || statusFilter !== 'all' || fuelFilter !== 'all'
                        ? 'Nicio mașină nu corespunde filtrelor selectate.'
                        : 'Nicio mașină înregistrată. Apasă "Mașină nouă" pentru a adăuga prima.'}
                    </p>
                  </td>
                </tr>
              )}

              {groups.map((group) => (
                <Fragment key={group.type}>
                  {/* Group header */}
                  <tr className="border-y border-neutral-200 bg-neutral-50">
                    <td colSpan={9} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <MachineTypeIcon type={group.type} className="h-4 w-4 text-neutral-500" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                          {TYPE_LABELS[group.type]}
                        </span>
                        <span className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
                          {group.machines.length}
                        </span>
                      </div>
                    </td>
                  </tr>

                  {/* Group rows */}
                  {group.machines.map((m) => (
                    <tr
                      key={m.id}
                      className={`cursor-pointer hover:bg-neutral-50 ${!m.isActive ? 'opacity-50' : ''}`}
                      onClick={() => router.push(`/${params.slug}/machines/${m.id}`)}
                    >
                      <td className="px-4 py-3 font-mono text-sm font-semibold text-neutral-800">
                        {m.internalCode}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* Current icon preview for this machine */}
                          {MACHINE_ICONS[m.machineType as MapMachineType] &&
                            (() => {
                              const def = MACHINE_ICONS[m.machineType as MapMachineType];
                              const v = getVariant(m.id);
                              return (
                                <button
                                  type="button"
                                  title="Schimbă iconița (deschide editare)"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditTarget(m);
                                  }}
                                  style={{ background: def.color }}
                                  className="h-6 w-6 shrink-0 rounded-md flex items-center justify-center hover:scale-110 transition-transform"
                                  // Safe: SVG string is a compile-time constant from machine-icons.ts
                                  dangerouslySetInnerHTML={{ __html: def.variants[v] }}
                                />
                              );
                            })()}
                          <TypeBadge type={m.machineType} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-neutral-700">
                        {m.make} {m.model}
                        <span className="ml-1 text-xs text-neutral-400">({m.year})</span>
                      </td>
                      <td className="px-4 py-3 text-neutral-500">{m.registrationPlate ?? '—'}</td>
                      {(() => {
                        // T18 — km columns only render for trucks; blank otherwise.
                        if (m.machineType !== MachineType.truck) {
                          return (
                            <>
                              <td className="px-4 py-3 text-right text-neutral-300">—</td>
                              <td className="px-4 py-3 text-right text-neutral-300">—</td>
                            </>
                          );
                        }
                        const s = distanceByMachine.get(m.id);
                        const today = s?.kmToday ?? 0;
                        const week = s?.kmThisWeek ?? 0;
                        return (
                          <>
                            <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                              {today > 0 ? today.toFixed(1) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                              {week > 0 ? week.toFixed(1) : '—'}
                            </td>
                          </>
                        );
                      })()}
                      <td className="px-4 py-3 text-neutral-500">
                        {FUEL_LABELS[m.fuelType] ?? m.fuelType}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {m.isActive ? (
                            <span className="flex items-center gap-1 text-green-600">
                              <CheckCircle2 className="h-4 w-4" /> Activă
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-neutral-400">
                              <XCircle className="h-4 w-4" /> Inactivă
                            </span>
                          )}
                          {m.isActive ? (
                            <UserPresenceDot
                              lastSeenAt={lastSeenByMachine.get(m.id) ?? null}
                              variant="badge"
                              thresholdMs={MACHINE_ONLINE_MS}
                            />
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditTarget(m);
                            }}
                            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-primary"
                            title="Editează"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(m);
                            }}
                            disabled={deleteMachine.isPending}
                            className="rounded-md p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                            title="Șterge"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateMachineModal allMachines={machines} onClose={() => setShowCreate(false)} />
      )}
      {editTarget && (
        <EditMachineModal
          machine={editTarget}
          onClose={() => setEditTarget(null)}
          iconVariant={getVariant(editTarget.id)}
          onSetIconVariant={(v) => setIconVariant(editTarget.id, v)}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          machine={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          isPending={deleteMachine.isPending}
        />
      )}
    </div>
  );
}
