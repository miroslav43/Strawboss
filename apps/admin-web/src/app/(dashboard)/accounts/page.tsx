'use client';
export const dynamic = 'force-dynamic';

import { Fragment, useState, useMemo } from 'react';
import {
  UserPlus,
  Trash2,
  Shield,
  CheckCircle2,
  XCircle,
  Link2,
  Users,
  UserCheck,
  AlertTriangle,
  Eye,
  EyeOff,
  Copy,
  Pencil,
} from 'lucide-react';
import {
  useAdminUsers,
  useCreateUser,
  useDeactivateUser,
  useUpdateUser,
  useMachines,
  type CreateUserPayload,
  type UpdateUserPayload,
} from '@strawboss/api';
import { UserRole, MachineType } from '@strawboss/types';
import type { User, Machine } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

// ── Role config ───────────────────────────────────────────────────────────

const ALL_ROLES: UserRole[] = [
  UserRole.admin,
  UserRole.baler_operator,
  UserRole.loader_operator,
  UserRole.driver,
];

const GROUP_ORDER: UserRole[] = [
  UserRole.admin,
  UserRole.baler_operator,
  UserRole.loader_operator,
  UserRole.driver,
];

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.admin]:           'Admin',
  [UserRole.dispatcher]:      'Dispatcher',
  [UserRole.baler_operator]:  'Baler Operator',
  [UserRole.loader_operator]: 'Loader Operator',
  [UserRole.driver]:          'Driver',
};

const ROLE_COLORS: Record<UserRole, string> = {
  [UserRole.admin]:           'bg-purple-100 text-purple-700',
  [UserRole.dispatcher]:      'bg-indigo-100 text-indigo-700',
  [UserRole.baler_operator]:  'bg-amber-100 text-amber-700',
  [UserRole.loader_operator]: 'bg-blue-100 text-blue-700',
  [UserRole.driver]:          'bg-green-100 text-green-700',
};

const ROLE_GROUP_ICONS: Record<UserRole, React.ReactNode> = {
  [UserRole.admin]:           <Shield className="h-3.5 w-3.5 text-purple-500" />,
  [UserRole.dispatcher]:      <Shield className="h-3.5 w-3.5 text-indigo-500" />,
  [UserRole.baler_operator]:  <span className="text-sm">*</span>,
  [UserRole.loader_operator]: <span className="text-sm">#</span>,
  [UserRole.driver]:          <span className="text-sm">&gt;</span>,
};

/** Machine type required for each operator role. */
const ROLE_TO_MACHINE_TYPE: Partial<Record<UserRole, MachineType>> = {
  [UserRole.loader_operator]: MachineType.loader,
  [UserRole.baler_operator]:  MachineType.baler,
  [UserRole.driver]:          MachineType.truck,
};

const MACHINE_TYPE_LABELS: Record<MachineType, string> = {
  [MachineType.loader]: 'Incarcator',
  [MachineType.baler]:  'Balotiera',
  [MachineType.truck]:  'Camion',
};

// ── Shared UI atoms ───────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const cancelBtnCls =
  'rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50';

const submitBtnCls =
  'flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white ' +
  'hover:bg-primary/90 disabled:opacity-60';

const selectCls =
  'rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

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

function RoleBadge({ role }: { role: string }) {
  const safeRole = (role in UserRole ? role : 'driver') as UserRole;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[safeRole]}`}>
      {ROLE_LABELS[safeRole] ?? role}
    </span>
  );
}

// ── Client-side credential preview (no conflict check — just visual) ──────

function slugifyClient(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

interface DerivedCredentials {
  username: string;
  email: string;
}

function deriveCredentials(fullName: string): DerivedCredentials | null {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [rawSurname, rawFirstname] = parts;
  const surname   = slugifyClient(rawSurname);
  const firstname = slugifyClient(rawFirstname);
  if (!surname || !firstname) return null;
  return {
    username: firstname[0] + surname,
    email:    `${firstname}.${surname}@nortiauno.ro`,
  };
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

// ── PinCell — masked + toggle + copy ──────────────────────────────────────

function PinCell({ pin }: { pin: string | null }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied]   = useState(false);

  if (!pin) return <span className="text-xs text-neutral-300">—</span>;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(pin);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-sm text-neutral-700">{visible ? pin : '••••'}</span>
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="rounded p-0.5 text-neutral-400 hover:text-neutral-600"
        title={visible ? 'Ascunde PIN' : 'Arată PIN'}
      >
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => { void handleCopy(); }}
        className="rounded p-0.5 text-neutral-400 hover:text-neutral-600"
        title="Copiază PIN"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      {copied && <span className="text-xs text-green-600">Copiat!</span>}
    </div>
  );
}

// ── DeactivateDialog ──────────────────────────────────────────────────────

function DeactivateDialog({
  user,
  onConfirm,
  onCancel,
  isPending,
}: {
  user: User;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
        <div className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-full bg-red-100 p-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="font-semibold text-neutral-800">Dezactivezi contul?</p>
              <p className="text-sm text-neutral-500">
                <span className="font-medium">{user.fullName}</span> nu va mai putea accesa aplicatia.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onCancel} className={cancelBtnCls} disabled={isPending}>
              Anuleaza
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isPending}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {isPending ? 'Se dezactiveaza...' : 'Dezactiveaza'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Create account modal ──────────────────────────────────────────────────

interface CreateForm {
  fullName:         string;
  role:             UserRole;
  phone:            string;
  usernameOverride: string;
}

function CreateAccountModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<CreateForm>({
    fullName:         '',
    role:             UserRole.driver,
    phone:            '',
    usernameOverride: '',
  });

  const createUser = useCreateUser(apiClient);

  const preview = deriveCredentials(form.fullName);
  const displayUsername = form.usernameOverride || preview?.username || '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: CreateUserPayload = {
      fullName: form.fullName,
      role:     form.role,
      phone:    form.phone || null,
      ...(form.usernameOverride ? { usernameOverride: form.usernameOverride } : {}),
    };
    createUser.mutate(payload, { onSuccess: () => onClose() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-neutral-800">Cont nou</h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <FormField label="Nume complet" required>
            <input
              required
              type="text"
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value, usernameOverride: '' }))}
              className={inputCls}
              placeholder="Maletici Miroslav"
            />
            {form.fullName && !preview && (
              <p className="mt-1 text-xs text-amber-600">
                Introduceti exact 2 cuvinte: Nume Prenume
              </p>
            )}
          </FormField>

          <FormField label="Rol" required>
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
              className={inputCls}
            >
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Telefon (optional)">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={inputCls}
              placeholder="+40 7xx xxx xxx"
            />
          </FormField>

          {/* Auto-generated credentials preview */}
          {preview && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Date generate automat
              </p>

              <div className="space-y-2">
                {/* Username — editable override */}
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-neutral-500">Username:</span>
                  <input
                    type="text"
                    value={displayUsername}
                    onChange={(e) => setForm((f) => ({ ...f, usernameOverride: e.target.value }))}
                    className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder={preview.username}
                    title="Poti edita username-ul inainte de creare"
                  />
                  {form.usernameOverride && (
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, usernameOverride: '' }))}
                      className="text-xs text-neutral-400 hover:text-neutral-600"
                    >
                      Reset
                    </button>
                  )}
                </div>

                {/* Email — read-only */}
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-neutral-500">Email:</span>
                  <span className="font-mono text-sm text-neutral-600 truncate">{preview.email}</span>
                </div>

                {/* PIN — shown as ???? since it is server-generated */}
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-neutral-500">PIN:</span>
                  <span className="font-mono text-sm text-neutral-400">
                    generat de server (4 cifre)
                  </span>
                </div>
              </div>
            </div>
          )}

          {createUser.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(createUser.error as Error)?.message ?? 'Eroare la creare cont'}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={cancelBtnCls}>Anuleaza</button>
            <button
              type="submit"
              disabled={createUser.isPending || !preview}
              className={submitBtnCls}
            >
              <UserPlus className="h-4 w-4" />
              {createUser.isPending ? 'Se creeaza...' : 'Creeaza cont'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit user modal ───────────────────────────────────────────────────────

interface EditForm {
  username: string;
  pin:      string;
  fullName: string;
  role:     UserRole;
  phone:    string;
}

function EditUserModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [form, setForm] = useState<EditForm>({
    username: user.username ?? '',
    pin:      user.pin      ?? '',
    fullName: user.fullName,
    role:     user.role,
    phone:    user.phone    ?? '',
  });
  const [showPin, setShowPin] = useState(false);
  const updateUser = useUpdateUser(apiClient);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: UpdateUserPayload = {
      fullName: form.fullName || undefined,
      role:     form.role,
      phone:    form.phone || null,
    };
    if (form.username && form.username !== user.username) {
      data.username = form.username;
    }
    if (form.pin && form.pin !== user.pin) {
      data.pin = form.pin;
    }
    updateUser.mutate({ id: user.id, data }, { onSuccess: () => onClose() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-800">
            Editeaza — <span className="text-primary">{user.fullName}</span>
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <FormField label="Nume complet" required>
            <input
              required type="text" value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              className={inputCls}
            />
          </FormField>

          <FormField label="Rol" required>
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
              className={inputCls}
            >
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Telefon (optional)">
            <input
              type="tel" value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={inputCls} placeholder="+40 7xx xxx xxx"
            />
          </FormField>

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Credentiale acces
            </p>

            <FormField label="Username">
              <input
                type="text" value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                className={inputCls}
                placeholder="mmaletici"
                minLength={3}
              />
            </FormField>

            <FormField label="PIN (4 cifre)">
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  value={form.pin}
                  onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))}
                  className={`${inputCls} pr-10`}
                  placeholder="4 cifre"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  inputMode="numeric"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                >
                  {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1 text-xs text-neutral-400">
                Schimbarea PIN-ului actualizeaza si parola din Supabase Auth.
              </p>
            </FormField>
          </div>

          {updateUser.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(updateUser.error as Error)?.message ?? 'Eroare la salvare'}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={cancelBtnCls}>Anuleaza</button>
            <button type="submit" disabled={updateUser.isPending} className={submitBtnCls}>
              {updateUser.isPending ? 'Se salveaza...' : 'Salveaza'}
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
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-800">
            Asigneaza masina — <span className="text-primary">{user.fullName}</span>
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {requiredType && (
            <p className="mb-4 text-sm text-neutral-500">
              Rolul <strong>{ROLE_LABELS[user.role]}</strong> poate fi legat doar de o masina de tip{' '}
              <strong>{MACHINE_TYPE_LABELS[requiredType]}</strong>.
            </p>
          )}

          {compatible.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Nicio masina compatibila activa.{' '}
              {requiredType
                ? `Adauga o masina de tip "${MACHINE_TYPE_LABELS[requiredType]}" in pagina Masini.`
                : 'Adauga masini in pagina Masini.'}
            </p>
          ) : (
            <div className="space-y-2">
              <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                selected === null ? 'border-primary bg-primary/5' : 'border-neutral-200 hover:bg-neutral-50'
              }`}>
                <input
                  type="radio" name="machine" value=""
                  checked={selected === null}
                  onChange={() => setSelected(null)}
                  className="accent-primary"
                />
                <span className="text-sm text-neutral-500 italic">Nicio masina asignata</span>
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
          <button type="button" onClick={onClose} className={cancelBtnCls}>Anuleaza</button>
          <button
            onClick={handleSave}
            disabled={updateUser.isPending || compatible.length === 0}
            className={submitBtnCls}
          >
            <Link2 className="h-4 w-4" />
            {updateUser.isPending ? 'Se salveaza...' : 'Salveaza asignarea'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const { t } = useI18n();
  const [showCreate,       setShowCreate]       = useState(false);
  const [editTarget,       setEditTarget]       = useState<User | null>(null);
  const [assignTarget,     setAssignTarget]     = useState<User | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);
  const [search,           setSearch]           = useState('');
  const [statusFilter,     setStatusFilter]     = useState<'all' | 'active' | 'inactive'>('all');

  const { data: usersRaw, isLoading, isError } = useAdminUsers(apiClient);
  const { data: machinesRaw }                  = useMachines(apiClient);
  const deactivate                             = useDeactivateUser(apiClient);

  const users: User[] = Array.isArray(usersRaw)
    ? (usersRaw as User[])
    : ((usersRaw as unknown as { data?: User[] })?.data ?? []);

  const allMachines: Machine[] = Array.isArray(machinesRaw)
    ? (machinesRaw as Machine[])
    : ((machinesRaw as { data?: Machine[] })?.data ?? []);

  const machineMap = new Map(allMachines.map((m) => [m.id, m]));

  // ── Stats (unfiltered) ───────────────────────────────────────────────
  const totalUsers    = users.length;
  const activeUsers   = users.filter((u) => u.isActive).length;
  const adminCount    = users.filter((u) => u.role === UserRole.admin).length;
  const operatorCount = users.filter((u) => u.role !== UserRole.admin).length;

  // ── Filtered + grouped ───────────────────────────────────────────────
  const groups = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = users.filter((u) => {
      const matchSearch =
        !q ||
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.username ?? '').toLowerCase().includes(q) ||
        (u.phone ?? '').includes(q);
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' ? u.isActive : !u.isActive);
      return matchSearch && matchStatus;
    });

    return GROUP_ORDER.map((role) => ({
      role,
      users: filtered
        .filter((u) => u.role === role)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ro')),
    })).filter((g) => g.users.length > 0);
  }, [users, search, statusFilter]);

  const totalVisible = groups.reduce((sum, g) => sum + g.users.length, 0);

  const handleDeactivate = () => {
    if (!deactivateTarget) return;
    deactivate.mutate(deactivateTarget.id, {
      onSuccess: () => setDeactivateTarget(null),
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('accounts.title')}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            <UserPlus className="h-4 w-4" />
            {t('accounts.newUser')}
          </button>
        }
      />

      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<Users className="h-4 w-4 text-neutral-600" />}
          value={totalUsers}
          label="Total conturi"
          color="bg-neutral-100"
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
          value={activeUsers}
          label="Conturi active"
          color="bg-green-50"
        />
        <StatCard
          icon={<Shield className="h-4 w-4 text-purple-600" />}
          value={adminCount}
          label="Administratori"
          color="bg-purple-50"
        />
        <StatCard
          icon={<UserCheck className="h-4 w-4 text-blue-600" />}
          value={operatorCount}
          label="Operatori"
          color="bg-blue-50"
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[240px] flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Cauta dupa nume, username, email, telefon..."
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
        <span className="ml-auto text-xs text-neutral-400">
          {totalVisible} {totalVisible === 1 ? 'cont' : 'conturi'}
        </span>
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="py-12 text-center text-sm text-neutral-400">Se incarca conturile...</div>
      )}
      {isError && (
        <div className="py-12 text-center text-sm text-red-500">
          Eroare la incarcarea conturilor. Verifica ca backend-ul ruleaza.
        </div>
      )}

      {/* Table */}
      {!isLoading && !isError && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">Nume</th>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">PIN</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Masina asignata</th>
                <th className="px-4 py-3">Telefon</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actiuni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {groups.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-neutral-400">
                    {search || statusFilter !== 'all'
                      ? 'Niciun cont nu corespunde filtrelor selectate.'
                      : 'Niciun cont inregistrat. Apasa "Cont nou" pentru a adauga primul.'}
                  </td>
                </tr>
              )}

              {groups.map((group) => (
                <Fragment key={group.role}>
                  {/* Group header */}
                  <tr className="border-y border-neutral-200 bg-neutral-50">
                    <td colSpan={9} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {ROLE_GROUP_ICONS[group.role]}
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                          {ROLE_LABELS[group.role]}
                        </span>
                        <span className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
                          {group.users.length}
                        </span>
                      </div>
                    </td>
                  </tr>

                  {/* Group rows */}
                  {group.users.map((user) => {
                    const assignedMachine = user.assignedMachineId
                      ? machineMap.get(user.assignedMachineId)
                      : null;
                    const canAssign = user.role !== UserRole.admin && user.isActive;

                    return (
                      <tr key={user.id} className={`hover:bg-neutral-50 ${!user.isActive ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3 font-medium text-neutral-800">
                          <div className="flex items-center gap-2">
                            {user.role === UserRole.admin && (
                              <Shield className="h-3.5 w-3.5 text-purple-400" />
                            )}
                            {user.fullName}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-sm text-neutral-600">
                            {user.username ?? <span className="text-neutral-300 not-italic italic">—</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-neutral-500 text-xs">{user.email}</td>
                        <td className="px-4 py-3">
                          <PinCell pin={user.pin} />
                        </td>
                        <td className="px-4 py-3">
                          <RoleBadge role={user.role} />
                        </td>
                        <td className="px-4 py-3">
                          {assignedMachine ? (
                            <button
                              onClick={() => canAssign && setAssignTarget(user)}
                              className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                              title="Schimba masina asignata"
                            >
                              <span className="font-mono">{assignedMachine.internalCode}</span>
                              <span className="text-neutral-400">
                                {assignedMachine.make} {assignedMachine.model}
                              </span>
                              {canAssign && (
                                <Link2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              )}
                            </button>
                          ) : canAssign ? (
                            <button
                              onClick={() => setAssignTarget(user)}
                              className="flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-400 hover:border-primary hover:text-primary transition-colors"
                            >
                              <Link2 className="h-3 w-3" />
                              Asigneaza
                            </button>
                          ) : (
                            <span className="text-xs text-neutral-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-neutral-500">{user.phone ?? '—'}</td>
                        <td className="px-4 py-3">
                          {user.isActive ? (
                            <span className="flex items-center gap-1 text-green-600">
                              <CheckCircle2 className="h-4 w-4" /> Activ
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-neutral-400">
                              <XCircle className="h-4 w-4" /> Inactiv
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setEditTarget(user)}
                              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                              title="Editeaza cont"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            {user.isActive && (
                              <button
                                onClick={() => setDeactivateTarget(user)}
                                className="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500"
                                title="Dezactiveaza cont"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showCreate  && <CreateAccountModal onClose={() => setShowCreate(false)} />}
      {editTarget  && <EditUserModal user={editTarget} onClose={() => setEditTarget(null)} />}
      {assignTarget && (
        <AssignMachineModal user={assignTarget} onClose={() => setAssignTarget(null)} />
      )}
      {deactivateTarget && (
        <DeactivateDialog
          user={deactivateTarget}
          onConfirm={handleDeactivate}
          onCancel={() => setDeactivateTarget(null)}
          isPending={deactivate.isPending}
        />
      )}
    </div>
  );
}
