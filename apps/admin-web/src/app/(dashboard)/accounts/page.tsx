'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import {
  UserPlus,
  Trash2,
  Shield,
  CheckCircle2,
  XCircle,
  Link2,
} from 'lucide-react';
import {
  useAdminUsers,
  useCreateUser,
  useDeactivateUser,
  useUpdateUser,
  useMachines,
  type CreateUserPayload,
} from '@strawboss/api';
import { UserRole, MachineType } from '@strawboss/types';
import type { User, Machine } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiClient } from '@/lib/api';

// ── Role labels / colours ─────────────────────────────────────────────────

const OPERATOR_ROLES: UserRole[] = [
  UserRole.baler_operator,
  UserRole.loader_operator,
  UserRole.driver,
];

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.admin]:           'Admin',
  [UserRole.baler_operator]:  'Baler Operator',
  [UserRole.loader_operator]: 'Loader Operator',
  [UserRole.driver]:          'Driver',
};

const ROLE_COLORS: Record<UserRole, string> = {
  [UserRole.admin]:           'bg-purple-100 text-purple-700',
  [UserRole.baler_operator]:  'bg-amber-100 text-amber-700',
  [UserRole.loader_operator]: 'bg-blue-100 text-blue-700',
  [UserRole.driver]:          'bg-green-100 text-green-700',
};

/** Machine type required for each operator role. */
const ROLE_TO_MACHINE_TYPE: Partial<Record<UserRole, MachineType>> = {
  [UserRole.loader_operator]: MachineType.loader,
  [UserRole.baler_operator]:  MachineType.baler,
  [UserRole.driver]:          MachineType.truck,
};

const MACHINE_TYPE_LABELS: Record<MachineType, string> = {
  [MachineType.loader]: '🔧 Încărcător',
  [MachineType.baler]:  '🌾 Balotieră',
  [MachineType.truck]:  '🚛 Camion',
};

// ── Helpers ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const safeRole = (role in UserRole ? role : 'driver') as UserRole;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[safeRole]}`}>
      {ROLE_LABELS[safeRole] ?? role}
    </span>
  );
}

// ── Create account modal ──────────────────────────────────────────────────

function CreateAccountModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<CreateUserPayload>({
    email:    '',
    password: '',
    fullName: '',
    role:     UserRole.driver,
    phone:    '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const createUser = useCreateUser(apiClient);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createUser.mutate(
      { ...form, phone: form.phone || null },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-neutral-800">Create Operator Account</h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <FormField label="Full Name" required>
            <input
              required type="text" value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              className={inputCls} placeholder="Ion Popescu"
            />
          </FormField>

          <FormField label="Email" required>
            <input
              required type="email" value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className={inputCls} placeholder="ion@ferma.ro"
            />
          </FormField>

          <FormField label="Phone (optional)">
            <input
              type="tel" value={form.phone ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={inputCls} placeholder="+40 7xx xxx xxx"
            />
          </FormField>

          <FormField label="Password" required>
            <div className="relative">
              <input
                required
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className={`${inputCls} pr-10`}
                placeholder="Minimum 8 characters"
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </FormField>

          <FormField label="Role" required>
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
              className={inputCls}
            >
              {OPERATOR_ROLES.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </FormField>

          {createUser.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(createUser.error as Error)?.message ?? 'Failed to create account'}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={cancelBtnCls}>Cancel</button>
            <button type="submit" disabled={createUser.isPending} className={submitBtnCls}>
              <UserPlus className="h-4 w-4" />
              {createUser.isPending ? 'Creating…' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Assign machine modal ──────────────────────────────────────────────────

function AssignMachineModal({
  user,
  onClose,
}: {
  user: User;
  onClose: () => void;
}) {
  const requiredType = ROLE_TO_MACHINE_TYPE[user.role];
  const { data: machinesRaw } = useMachines(apiClient);

  const allMachines: Machine[] = Array.isArray(machinesRaw)
    ? (machinesRaw as Machine[])
    : ((machinesRaw as { data?: Machine[] })?.data ?? []);

  // Filter by compatible type and active status.
  const compatible = requiredType
    ? allMachines.filter((m) => m.machineType === requiredType && m.isActive)
    : allMachines.filter((m) => m.isActive);

  const [selected, setSelected] = useState<string | null>(user.assignedMachineId ?? null);
  const updateUser = useUpdateUser(apiClient);

  const handleSave = () => {
    updateUser.mutate(
      { id: user.id, data: { assignedMachineId: selected } },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-800">
            Asignează mașină — <span className="text-primary">{user.fullName}</span>
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {requiredType && (
            <p className="mb-4 text-sm text-neutral-500">
              Rolul <strong>{ROLE_LABELS[user.role]}</strong> poate fi legat doar de o mașină de tip{' '}
              <strong>{MACHINE_TYPE_LABELS[requiredType]}</strong>.
            </p>
          )}

          {compatible.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Nicio mașină compatibilă activă.{' '}
              {requiredType
                ? `Adaugă o mașină de tip "${MACHINE_TYPE_LABELS[requiredType]}" în pagina Mașini.`
                : 'Adaugă mașini în pagina Mașini.'}
            </p>
          ) : (
            <div className="space-y-2">
              {/* "None" option */}
              <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                selected === null ? 'border-primary bg-primary/5' : 'border-neutral-200 hover:bg-neutral-50'
              }`}>
                <input
                  type="radio" name="machine" value=""
                  checked={selected === null}
                  onChange={() => setSelected(null)}
                  className="accent-primary"
                />
                <span className="text-sm text-neutral-500 italic">Nicio mașină asignată</span>
              </label>

              {compatible.map((m) => (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    selected === m.id
                      ? 'border-primary bg-primary/5'
                      : 'border-neutral-200 hover:bg-neutral-50'
                  }`}
                >
                  <input
                    type="radio" name="machine" value={m.id}
                    checked={selected === m.id}
                    onChange={() => setSelected(m.id)}
                    className="accent-primary"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-neutral-800">{m.internalCode}</p>
                    <p className="text-xs text-neutral-400">
                      {m.make} {m.model}{m.registrationPlate ? ` · ${m.registrationPlate}` : ''}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {updateUser.isError && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(updateUser.error as Error)?.message ?? 'Eroare la salvare'}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-neutral-100 bg-neutral-50 px-6 py-4">
          <button type="button" onClick={onClose} className={cancelBtnCls}>Anulează</button>
          <button
            onClick={handleSave}
            disabled={updateUser.isPending || compatible.length === 0}
            className={submitBtnCls}
          >
            <Link2 className="h-4 w-4" />
            {updateUser.isPending ? 'Se salvează…' : 'Salvează asignarea'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared style atoms ────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const cancelBtnCls =
  'rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50';

const submitBtnCls =
  'flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white ' +
  'hover:bg-primary/90 disabled:opacity-60';

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
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

// ── Page ──────────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const [showCreate,      setShowCreate]      = useState(false);
  const [assignTarget,    setAssignTarget]    = useState<User | null>(null);
  const { data: users, isLoading, isError }  = useAdminUsers(apiClient);
  const { data: machinesRaw }                = useMachines(apiClient);
  const deactivate                           = useDeactivateUser(apiClient);

  const allMachines: Machine[] = Array.isArray(machinesRaw)
    ? (machinesRaw as Machine[])
    : ((machinesRaw as { data?: Machine[] })?.data ?? []);

  const machineMap = new Map(allMachines.map((m) => [m.id, m]));

  const handleDeactivate = (user: User) => {
    if (!confirm(`Dezactivezi contul pentru ${user.fullName}? Nu va mai putea accesa aplicația.`)) return;
    deactivate.mutate(user.id);
  };

  return (
    <div>
      <PageHeader
        title="Operator Accounts"
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            <UserPlus className="h-4 w-4" />
            New Account
          </button>
        }
      />

      {isLoading && (
        <div className="py-12 text-center text-sm text-neutral-400">Loading accounts…</div>
      )}

      {isError && (
        <div className="py-12 text-center text-sm text-red-500">
          Failed to load accounts. Make sure the backend is running.
        </div>
      )}

      {users && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Mașină asignată</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {users.map((user) => {
                const assignedMachine = user.assignedMachineId
                  ? machineMap.get(user.assignedMachineId)
                  : null;
                const canAssign = user.role !== UserRole.admin && user.isActive;

                return (
                  <tr key={user.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-800">
                      <div className="flex items-center gap-2">
                        {user.role === UserRole.admin && (
                          <Shield className="h-4 w-4 text-purple-500" />
                        )}
                        {user.fullName}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">{user.email}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="px-4 py-3">
                      {assignedMachine ? (
                        <button
                          onClick={() => canAssign && setAssignTarget(user)}
                          className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                          title="Schimbă mașina asignată"
                        >
                          <span className="font-mono">{assignedMachine.internalCode}</span>
                          <span className="text-neutral-400">
                            {assignedMachine.make} {assignedMachine.model}
                          </span>
                          {canAssign && (
                            <Link2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </button>
                      ) : (
                        canAssign ? (
                          <button
                            onClick={() => setAssignTarget(user)}
                            className="flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-400 hover:border-primary hover:text-primary transition-colors"
                          >
                            <Link2 className="h-3 w-3" />
                            Asignează
                          </button>
                        ) : (
                          <span className="text-xs text-neutral-300">—</span>
                        )
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{user.phone ?? '—'}</td>
                    <td className="px-4 py-3">
                      {user.isActive ? (
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle2 className="h-4 w-4" /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-neutral-400">
                          <XCircle className="h-4 w-4" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {user.isActive && user.role !== UserRole.admin && (
                        <button
                          onClick={() => handleDeactivate(user)}
                          disabled={deactivate.isPending}
                          className="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500"
                          title="Deactivate account"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-neutral-400">
                    No accounts yet. Create the first operator account.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate  && <CreateAccountModal onClose={() => setShowCreate(false)} />}
      {assignTarget && (
        <AssignMachineModal
          user={assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </div>
  );
}
