'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  XCircle,
  CheckCircle2,
  Wrench,
} from 'lucide-react';
import {
  useMachines,
  useCreateMachine,
  useUpdateMachine,
} from '@strawboss/api';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { MachineType, FuelType } from '@strawboss/types';
import type { Machine } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiClient } from '@/lib/api';

// ── Labels ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<MachineType, string> = {
  [MachineType.loader]: 'Încărcător',
  [MachineType.baler]:  'Balotieră',
  [MachineType.truck]:  'Camion',
};

const TYPE_EMOJI: Record<MachineType, string> = {
  [MachineType.loader]: '🔧',
  [MachineType.baler]:  '🌾',
  [MachineType.truck]:  '🚛',
};

const TYPE_COLORS: Record<MachineType, string> = {
  [MachineType.loader]: 'bg-blue-100 text-blue-700',
  [MachineType.baler]:  'bg-amber-100 text-amber-700',
  [MachineType.truck]:  'bg-green-100 text-green-700',
};

const TYPE_PREFIX: Record<MachineType, string> = {
  [MachineType.loader]: 'L',
  [MachineType.baler]:  'B',
  [MachineType.truck]:  'T',
};

const FUEL_LABELS: Record<FuelType, string> = {
  [FuelType.diesel]:   'Diesel',
  [FuelType.gasoline]: 'Benzină',
  [FuelType.electric]: 'Electric',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/** Extract all machines from the response regardless of shape (array or paginated). */
function toMachineList(raw: unknown): Machine[] {
  if (Array.isArray(raw)) return raw as Machine[];
  const paginated = raw as { data?: Machine[] } | null | undefined;
  return paginated?.data ?? [];
}

/**
 * Generate the next sequential internal code for a machine type.
 * e.g. existing ["L-01","L-03"] → "L-04"
 */
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
  maxPayloadKg: string;
  maxBaleCount: string;
  balesPerHourAvg: string;
  reachMeters: string;
  isActive: boolean;
}

function blankForm(
  machines: Machine[],
  type: MachineType = MachineType.loader,
): MachineFormState {
  return {
    machineType:        type,
    internalCode:       nextCode(machines, type),
    registrationPlate:  '',
    make:               '',
    model:              '',
    year:               String(new Date().getFullYear()),
    fuelType:           FuelType.diesel,
    tankCapacityLiters: '',
    maxPayloadKg:       '',
    maxBaleCount:       '',
    balesPerHourAvg:    '',
    reachMeters:        '',
    isActive:           true,
  };
}

function formToPayload(f: MachineFormState): Partial<Machine> {
  return {
    machineType:        f.machineType,
    internalCode:       f.internalCode.trim(),
    registrationPlate:  f.registrationPlate.trim() || undefined,
    make:               f.make.trim(),
    model:              f.model.trim(),
    year:               Number(f.year),
    fuelType:           f.fuelType,
    tankCapacityLiters: Number(f.tankCapacityLiters),
    maxPayloadKg:       f.maxPayloadKg    ? Number(f.maxPayloadKg)    : null,
    maxBaleCount:       f.maxBaleCount    ? Number(f.maxBaleCount)    : null,
    balesPerHourAvg:    f.balesPerHourAvg ? Number(f.balesPerHourAvg) : null,
    reachMeters:        f.reachMeters     ? Number(f.reachMeters)     : null,
    isActive:           f.isActive,
  } as Partial<Machine>;
}

function machineToForm(m: Machine): MachineFormState {
  return {
    machineType:        m.machineType,
    internalCode:       m.internalCode ?? '',
    registrationPlate:  m.registrationPlate ?? '',
    make:               m.make,
    model:              m.model,
    year:               String(m.year),
    fuelType:           m.fuelType,
    tankCapacityLiters: m.tankCapacityLiters != null ? String(m.tankCapacityLiters) : '',
    maxPayloadKg:       m.maxPayloadKg    != null ? String(m.maxPayloadKg)    : '',
    maxBaleCount:       m.maxBaleCount    != null ? String(m.maxBaleCount)    : '',
    balesPerHourAvg:    m.balesPerHourAvg != null ? String(m.balesPerHourAvg) : '',
    reachMeters:        m.reachMeters     != null ? String(m.reachMeters)     : '',
    isActive:           m.isActive,
  };
}

// ── Shared UI atoms ───────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

function Field({
  label, children, required,
}: {
  label: string; children: React.ReactNode; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
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
  onCancel, submitLabel, disabled,
}: {
  onCancel: () => void; submitLabel: string; disabled: boolean;
}) {
  return (
    <div className="flex justify-end gap-3 pt-2">
      <button
        type="button" onClick={onCancel}
        className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
      >
        Anulează
      </button>
      <button
        type="submit" disabled={disabled}
        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
      >
        {submitLabel}
      </button>
    </div>
  );
}

function ModalShell({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
            <Wrench className="h-5 w-5 text-primary" />
            {title}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100">
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
            <option key={t} value={t}>{TYPE_EMOJI[t]} {TYPE_LABELS[t]}</option>
          ))}
        </select>
      </Field>

      <Field label="Cod intern" required>
        <input
          required value={form.internalCode}
          onChange={(e) => onChange({ internalCode: e.target.value })}
          className={inputCls} placeholder="ex. L-01"
        />
      </Field>

      <Field label="Marcă" required>
        <input
          required value={form.make}
          onChange={(e) => onChange({ make: e.target.value })}
          className={inputCls} placeholder="JCB"
        />
      </Field>

      <Field label="Model" required>
        <input
          required value={form.model}
          onChange={(e) => onChange({ model: e.target.value })}
          className={inputCls} placeholder="531-70"
        />
      </Field>

      <Field label="An fabricație" required>
        <input
          required type="number" min={1990} max={2100}
          value={form.year}
          onChange={(e) => onChange({ year: e.target.value })}
          className={inputCls}
        />
      </Field>

      <Field label="Nr. înmatriculare">
        <input
          value={form.registrationPlate}
          onChange={(e) => onChange({ registrationPlate: e.target.value })}
          className={inputCls} placeholder="OS-1234-AB (opțional)"
        />
      </Field>

      <Field label="Combustibil" required>
        <select
          value={form.fuelType}
          onChange={(e) => onChange({ fuelType: e.target.value as FuelType })}
          className={inputCls}
        >
          {Object.values(FuelType).map((f) => (
            <option key={f} value={f}>{FUEL_LABELS[f]}</option>
          ))}
        </select>
      </Field>

      <Field label="Capacitate rezervor (L)" required>
        <input
          required type="number" min={0}
          value={form.tankCapacityLiters}
          onChange={(e) => onChange({ tankCapacityLiters: e.target.value })}
          className={inputCls} placeholder="120"
        />
      </Field>

      <Field label="Sarcină maximă (kg)">
        <input type="number" min={0} value={form.maxPayloadKg}
          onChange={(e) => onChange({ maxPayloadKg: e.target.value })}
          className={inputCls} placeholder="—" />
      </Field>

      <Field label="Nr. max. baloți">
        <input type="number" min={0} value={form.maxBaleCount}
          onChange={(e) => onChange({ maxBaleCount: e.target.value })}
          className={inputCls} placeholder="—" />
      </Field>

      <Field label="Baloți/oră (medie)">
        <input type="number" min={0} value={form.balesPerHourAvg}
          onChange={(e) => onChange({ balesPerHourAvg: e.target.value })}
          className={inputCls} placeholder="—" />
      </Field>

      <Field label="Raza de acțiune (m)">
        <input type="number" min={0} value={form.reachMeters}
          onChange={(e) => onChange({ reachMeters: e.target.value })}
          className={inputCls} placeholder="—" />
      </Field>

      {showIsActive && (
        <div className="col-span-2 flex items-center gap-2">
          <input
            id="isActive" type="checkbox" checked={form.isActive}
            onChange={(e) => onChange({ isActive: e.target.checked })}
            className="accent-primary"
          />
          <label htmlFor="isActive" className="text-sm text-neutral-700">Mașină activă</label>
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
}: {
  machine: Machine;
  onClose: () => void;
}) {
  const [form, setForm] = useState<MachineFormState>(() => machineToForm(machine));
  const update = useUpdateMachine(apiClient);
  const patch = (p: Partial<MachineFormState>) => setForm((f) => ({ ...f, ...p }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    update.mutate(
      { id: machine.id, data: formToPayload(form) },
      { onSuccess: () => onClose() },
    );
  };

  const code = machine.internalCode || machine.id.slice(0, 8);

  return (
    <ModalShell title={`Editează — ${code}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5 p-6">
        <MachineForm form={form} onChange={patch} showIsActive />
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

// ── Type badge ────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: MachineType }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[type]}`}>
      {TYPE_EMOJI[type]} {TYPE_LABELS[type]}
    </span>
  );
}

// ── Delete hook (uses DELETE endpoint for true soft-delete) ───────────────

function useDeleteMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/machines/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['machines'] }),
  });
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function MachinesPage() {
  const { data: machinesRaw, isLoading, isError } = useMachines(apiClient);
  const deleteMachine = useDeleteMachine();

  const machines = toMachineList(machinesRaw);

  const [showCreate, setShowCreate]   = useState(false);
  const [editTarget, setEditTarget]   = useState<Machine | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = (machine: Machine) => {
    const label = machine.internalCode || machine.id;
    if (!confirm(`Ștergi mașina "${label}"? Acțiunea nu poate fi anulată.`)) return;
    setDeleteError(null);
    deleteMachine.mutate(machine.id, {
      onError: (err) => setDeleteError((err as Error)?.message ?? 'Eroare la ștergere'),
    });
  };

  return (
    <div>
      <PageHeader
        title="Mașini"
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Mașină nouă
          </button>
        }
      />

      {deleteError && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span>{deleteError}</span>
          <button onClick={() => setDeleteError(null)} className="ml-3 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {isLoading && (
        <div className="py-12 text-center text-sm text-neutral-400">Se încarcă mașinile…</div>
      )}

      {isError && (
        <div className="py-12 text-center text-sm text-red-500">
          Eroare la încărcarea mașinilor. Verifică că backend-ul rulează.
        </div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">Cod</th>
                <th className="px-4 py-3">Tip</th>
                <th className="px-4 py-3">Marcă / Model</th>
                <th className="px-4 py-3">Nr. înmatriculare</th>
                <th className="px-4 py-3">Combustibil</th>
                <th className="px-4 py-3">Stare</th>
                <th className="px-4 py-3 text-right">Acțiuni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {machines.map((m) => (
                <tr key={m.id} className={`hover:bg-neutral-50 ${!m.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-mono text-sm font-semibold text-neutral-800">
                    {m.internalCode}
                  </td>
                  <td className="px-4 py-3">
                    <TypeBadge type={m.machineType} />
                  </td>
                  <td className="px-4 py-3 text-neutral-700">
                    {m.make} {m.model}
                    <span className="ml-1 text-xs text-neutral-400">({m.year})</span>
                  </td>
                  <td className="px-4 py-3 text-neutral-500">{m.registrationPlate ?? '—'}</td>
                  <td className="px-4 py-3 text-neutral-500">
                    {FUEL_LABELS[m.fuelType] ?? m.fuelType}
                  </td>
                  <td className="px-4 py-3">
                    {m.isActive ? (
                      <span className="flex items-center gap-1 text-green-600">
                        <CheckCircle2 className="h-4 w-4" /> Activă
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-neutral-400">
                        <XCircle className="h-4 w-4" /> Inactivă
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditTarget(m)}
                        className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-primary"
                        title="Editează"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(m)}
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

              {machines.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-neutral-400">
                    Nicio mașină înregistrată. Apasă "Mașină nouă" pentru a adăuga prima.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateMachineModal
          allMachines={machines}
          onClose={() => setShowCreate(false)}
        />
      )}
      {editTarget && (
        <EditMachineModal machine={editTarget} onClose={() => setEditTarget(null)} />
      )}
    </div>
  );
}
