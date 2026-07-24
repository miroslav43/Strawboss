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
  Truck,
} from 'lucide-react';
import {
  useAdminUsers,
  useCreateUser,
  useDeactivateUser,
  useUpdateUser,
  useUploadUserAvatar,
  useMachines,
  useDeliveryDestinations,
  type CreateUserPayload,
  type UpdateUserPayload,
} from '@strawboss/api';
import { UserRole, MachineType } from '@strawboss/types';
import type { User, Machine, DeliveryDestination } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { UserPresenceDot } from '@/components/shared/UserPresenceDot';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { AssignBeneficiariesModal } from './AssignBeneficiariesModal';

// ── Role config ───────────────────────────────────────────────────────────

const ALL_ROLES: UserRole[] = [
  UserRole.admin,
  UserRole.baler_operator,
  UserRole.loader_operator,
  UserRole.driver,
  UserRole.geofence_maker,
  UserRole.depot_manager,
  UserRole.transportator,
];

const GROUP_ORDER: UserRole[] = [
  UserRole.admin,
  UserRole.baler_operator,
  UserRole.loader_operator,
  UserRole.driver,
  UserRole.geofence_maker,
  UserRole.depot_manager,
  UserRole.transportator,
];

/** i18n key suffixes for each role — resolved via t('accounts.role.<key>') */
const ROLE_LABEL_KEYS: Record<UserRole, string> = {
  [UserRole.super_admin]: 'accounts.role.super_admin',
  [UserRole.admin]: 'accounts.role.admin',
  [UserRole.dispatcher]: 'accounts.role.dispatcher',
  [UserRole.baler_operator]: 'accounts.role.baler_operator',
  [UserRole.loader_operator]: 'accounts.role.loader_operator',
  [UserRole.driver]: 'accounts.role.driver',
  [UserRole.geofence_maker]: 'accounts.role.geofence_maker',
  [UserRole.depot_manager]: 'accounts.role.depot_manager',
  [UserRole.transportator]: 'accounts.role.transportator',
};

const ROLE_COLORS: Record<UserRole, string> = {
  [UserRole.super_admin]: 'bg-red-100 text-red-700',
  [UserRole.admin]: 'bg-purple-100 text-purple-700',
  [UserRole.dispatcher]: 'bg-indigo-100 text-indigo-700',
  [UserRole.baler_operator]: 'bg-amber-100 text-amber-700',
  [UserRole.loader_operator]: 'bg-blue-100 text-blue-700',
  [UserRole.driver]: 'bg-green-100 text-green-700',
  [UserRole.geofence_maker]: 'bg-teal-100 text-teal-700',
  [UserRole.depot_manager]: 'bg-orange-100 text-orange-700',
  [UserRole.transportator]: 'bg-cyan-100 text-cyan-700',
};

const ROLE_GROUP_ICONS: Record<UserRole, React.ReactNode> = {
  [UserRole.super_admin]: <Shield className="h-3.5 w-3.5 text-red-500" />,
  [UserRole.admin]: <Shield className="h-3.5 w-3.5 text-purple-500" />,
  [UserRole.dispatcher]: <Shield className="h-3.5 w-3.5 text-indigo-500" />,
  [UserRole.baler_operator]: <span className="text-sm">*</span>,
  [UserRole.loader_operator]: <span className="text-sm">#</span>,
  [UserRole.driver]: <span className="text-sm">&gt;</span>,
  [UserRole.geofence_maker]: <span className="text-sm">&#9676;</span>,
  [UserRole.depot_manager]: <span className="text-sm">&#9636;</span>,
  [UserRole.transportator]: <Truck className="h-3.5 w-3.5 text-cyan-500" />,
};

/** Machine type required for each operator role. */
const ROLE_TO_MACHINE_TYPE: Partial<Record<UserRole, MachineType>> = {
  [UserRole.loader_operator]: MachineType.loader,
  [UserRole.baler_operator]: MachineType.baler,
  [UserRole.driver]: MachineType.truck,
};

/** Roles that require an assigned depot. */
const ROLE_REQUIRES_DEPOT: UserRole[] = [UserRole.depot_manager];

/** i18n key for each machine type — resolved via t('accounts.machineType.<key>') */
const MACHINE_TYPE_LABEL_KEYS: Record<MachineType, string> = {
  [MachineType.loader]: 'accounts.machineType.loader',
  [MachineType.baler]: 'accounts.machineType.baler',
  [MachineType.truck]: 'accounts.machineType.truck',
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
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const { t } = useI18n();
  const safeRole = (role in UserRole ? role : 'driver') as UserRole;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[safeRole]}`}
    >
      {t(ROLE_LABEL_KEYS[safeRole]) ?? role}
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
  const surname = slugifyClient(rawSurname);
  const firstname = slugifyClient(rawFirstname);
  if (!surname || !firstname) return null;
  return {
    username: firstname[0] + surname,
    email: `${firstname}.${surname}@nortiauno.ro`,
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
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

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
        title={visible ? t('accounts.pin.hide') : t('accounts.pin.show')}
      >
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => {
          void handleCopy();
        }}
        className="rounded p-0.5 text-neutral-400 hover:text-neutral-600"
        title={t('accounts.pin.copy')}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      {copied && <span className="text-xs text-green-600">{t('accounts.pin.copied')}</span>}
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
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
        <div className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-full bg-red-100 p-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="font-semibold text-neutral-800">{t('accounts.deactivate.title')}</p>
              <p className="text-sm text-neutral-500">
                <span className="font-medium">{user.fullName}</span>
                {t('accounts.deactivate.descSuffix')}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onCancel} className={cancelBtnCls} disabled={isPending}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isPending}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {isPending
                ? t('accounts.deactivate.deactivating')
                : t('accounts.deactivate.deactivate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Create account modal ──────────────────────────────────────────────────

interface CreateForm {
  fullName: string;
  role: UserRole;
  phone: string;
  usernameOverride: string;
}

function CreateAccountModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<CreateForm>({
    fullName: '',
    role: UserRole.driver,
    phone: '',
    usernameOverride: '',
  });

  const createUser = useCreateUser(apiClient);

  const preview = deriveCredentials(form.fullName);
  const displayUsername = form.usernameOverride || preview?.username || '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: CreateUserPayload = {
      fullName: form.fullName,
      role: form.role,
      phone: form.phone || null,
      ...(form.usernameOverride ? { usernameOverride: form.usernameOverride } : {}),
    };
    createUser.mutate(payload, { onSuccess: () => onClose() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-neutral-800">
            {t('accounts.modal.createTitle')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <FormField label={t('accounts.form.fullName')} required>
            <input
              required
              type="text"
              value={form.fullName}
              onChange={(e) =>
                setForm((f) => ({ ...f, fullName: e.target.value, usernameOverride: '' }))
              }
              className={inputCls}
              placeholder={t('accounts.form.fullNamePlaceholder')}
            />
            {form.fullName && !preview && (
              <p className="mt-1 text-xs text-amber-600">{t('accounts.form.fullNameHint')}</p>
            )}
          </FormField>

          <FormField label={t('accounts.form.role')} required>
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
              className={inputCls}
            >
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(ROLE_LABEL_KEYS[role])}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label={t('accounts.form.phone')}>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={inputCls}
              placeholder={t('accounts.form.phonePlaceholder')}
            />
          </FormField>

          {/* Auto-generated credentials preview */}
          {preview && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                {t('accounts.form.generatedSection')}
              </p>

              <div className="space-y-2">
                {/* Username — editable override */}
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-neutral-500">
                    {t('accounts.form.usernameRowLabel')}
                  </span>
                  <input
                    type="text"
                    value={displayUsername}
                    onChange={(e) => setForm((f) => ({ ...f, usernameOverride: e.target.value }))}
                    className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder={preview.username}
                    title={t('accounts.form.usernameOverrideTooltip')}
                  />
                  {form.usernameOverride && (
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, usernameOverride: '' }))}
                      className="text-xs text-neutral-400 hover:text-neutral-600"
                    >
                      {t('accounts.form.reset')}
                    </button>
                  )}
                </div>

                {/* PIN — shown as ???? since it is server-generated */}
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-neutral-500">
                    {t('accounts.form.pinRowLabel')}
                  </span>
                  <span className="font-mono text-sm text-neutral-400">
                    {t('accounts.form.pinServerGen')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {createUser.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(createUser.error as Error)?.message ?? t('accounts.modal.errorCreate')}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={cancelBtnCls}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={createUser.isPending || !preview}
              className={submitBtnCls}
            >
              <UserPlus className="h-4 w-4" />
              {createUser.isPending
                ? t('accounts.modal.creating')
                : t('accounts.modal.createSubmit')}
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
  pin: string;
  fullName: string;
  role: UserRole;
  phone: string;
  isActive: boolean;
  locale: 'en' | 'ro';
}

function EditUserModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<EditForm>({
    username: user.username ?? '',
    pin: user.pin ?? '',
    fullName: user.fullName,
    role: user.role,
    phone: user.phone ?? '',
    isActive: user.isActive,
    locale: (user.locale as 'en' | 'ro') ?? 'ro',
  });
  const [showPin, setShowPin] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const updateUser = useUpdateUser(apiClient);
  const uploadAvatar = useUploadUserAvatar(apiClient);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: UpdateUserPayload = {
      fullName: form.fullName || undefined,
      role: form.role,
      phone: form.phone || null,
      locale: form.locale,
    };
    if (form.username && form.username !== user.username) {
      data.username = form.username;
    }
    if (form.pin && form.pin !== user.pin) {
      data.pin = form.pin;
    }
    if (form.isActive !== user.isActive) {
      data.isActive = form.isActive;
    }
    updateUser.mutate({ id: user.id, data }, { onSuccess: () => onClose() });
  };

  const handleAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always reset the input so re-picking the same file fires a new change.
    e.target.value = '';
    if (!file) return;

    // Optimistic local preview — an object URL we keep until upload settles.
    const objectUrl = URL.createObjectURL(file);
    setLocalPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return objectUrl;
    });

    const formData = new FormData();
    formData.append('file', file);
    uploadAvatar.mutate(
      { id: user.id, formData },
      {
        onSettled: () => {
          // React Query will have refetched the admin-users list; drop the
          // local preview so the real URL from the server takes over.
          setLocalPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        },
      },
    );
  };

  // Prefer live preview while uploading, then fall back to the persisted URL.
  const displayUser = {
    fullName: form.fullName || user.fullName,
    avatarUrl: localPreviewUrl ?? user.avatarUrl,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-800">
            {t('accounts.modal.editTitle')} — <span className="text-primary">{user.fullName}</span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div className="flex items-center gap-4">
            <UserAvatar user={displayUser} size="lg" />
            <div className="flex flex-col gap-1">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarPick}
                  disabled={uploadAvatar.isPending}
                />
                {uploadAvatar.isPending
                  ? t('accounts.avatar.uploading')
                  : t('accounts.avatar.change')}
              </label>
              {uploadAvatar.isError ? (
                <p className="text-xs text-red-600">
                  {(uploadAvatar.error as Error)?.message ?? t('accounts.avatar.uploadFailed')}
                </p>
              ) : (
                <p className="text-xs text-neutral-400">{t('accounts.avatar.hint')}</p>
              )}
            </div>
          </div>

          <FormField label={t('accounts.form.fullName')} required>
            <input
              required
              type="text"
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              className={inputCls}
            />
          </FormField>

          <FormField label={t('accounts.form.role')} required>
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
              className={inputCls}
            >
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(ROLE_LABEL_KEYS[role])}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label={t('accounts.form.phone')}>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={inputCls}
              placeholder={t('accounts.form.phonePlaceholder')}
            />
          </FormField>

          <FormField label={t('accounts.form.language')} required>
            <div className="flex gap-2">
              {(['ro', 'en'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, locale: l }))}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    form.locale === l
                      ? 'border-primary bg-primary text-white'
                      : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  {l === 'ro' ? 'Română' : 'English'}
                </button>
              ))}
            </div>
          </FormField>

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              {t('accounts.form.accessSection')}
            </p>
            <label className="flex cursor-pointer items-start gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={form.isActive}
                onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  form.isActive ? 'bg-primary' : 'bg-neutral-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    form.isActive ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
              <div className="flex-1">
                <p className="text-sm font-medium text-neutral-700">
                  {t('accounts.form.isActiveLabel')}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">{t('accounts.form.isActiveHint')}</p>
              </div>
            </label>
          </div>

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              {t('accounts.form.credentialsSection')}
            </p>

            <FormField label={t('accounts.form.username')}>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                className={inputCls}
                placeholder={t('accounts.form.usernamePlaceholder')}
                minLength={3}
              />
            </FormField>

            <FormField label={t('accounts.form.pinLabel')}>
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  value={form.pin}
                  onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))}
                  className={`${inputCls} pr-10`}
                  placeholder={t('accounts.form.pinPlaceholder')}
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
              <p className="mt-1 text-xs text-neutral-400">{t('accounts.form.pinHint')}</p>
            </FormField>
          </div>

          {updateUser.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(updateUser.error as Error)?.message ?? t('accounts.modal.errorEdit')}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={cancelBtnCls}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={updateUser.isPending} className={submitBtnCls}>
              {updateUser.isPending ? t('accounts.modal.editing') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Assign machine modal ──────────────────────────────────────────────────

function AssignMachineModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useI18n();
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
            {t('accounts.assign.titlePrefix')}
            <span className="text-primary">{user.fullName}</span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {requiredType && (
            <p className="mb-4 text-sm text-neutral-500">
              {t('accounts.assign.roleHint', {
                role: t(ROLE_LABEL_KEYS[user.role]),
                type: t(MACHINE_TYPE_LABEL_KEYS[requiredType]),
              })}
            </p>
          )}

          {compatible.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {t('accounts.assign.noCompatible')}{' '}
              {requiredType
                ? t('accounts.assign.noCompatibleHint', {
                    type: t(MACHINE_TYPE_LABEL_KEYS[requiredType]),
                  })
                : t('accounts.assign.noCompatibleHintGeneric')}
            </p>
          ) : (
            <div className="space-y-2">
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                  selected === null
                    ? 'border-primary bg-primary/5'
                    : 'border-neutral-200 hover:bg-neutral-50'
                }`}
              >
                <input
                  type="radio"
                  name="machine"
                  value=""
                  checked={selected === null}
                  onChange={() => setSelected(null)}
                  className="accent-primary"
                />
                <span className="text-sm text-neutral-500 italic">
                  {t('accounts.assign.noneAssigned')}
                </span>
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
                    type="radio"
                    name="machine"
                    value={m.id}
                    checked={selected === m.id}
                    onChange={() => setSelected(m.id)}
                    className="accent-primary"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-neutral-800">{m.internalCode}</p>
                    <p className="text-xs text-neutral-400">
                      {m.make} {m.model}
                      {m.registrationPlate ? ` · ${m.registrationPlate}` : ''}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {updateUser.isError && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(updateUser.error as Error)?.message ?? t('accounts.assign.errorSave')}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-neutral-100 bg-neutral-50 px-6 py-4">
          <button type="button" onClick={onClose} className={cancelBtnCls}>
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={updateUser.isPending || compatible.length === 0}
            className={submitBtnCls}
          >
            <Link2 className="h-4 w-4" />
            {updateUser.isPending ? t('accounts.assign.saving') : t('accounts.assign.saveButton')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Assign depot modal ────────────────────────────────────────────────────

function AssignDepotModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useI18n();
  const { data: depotsRaw } = useDeliveryDestinations(apiClient);

  const allDepots: DeliveryDestination[] = Array.isArray(depotsRaw)
    ? (depotsRaw as DeliveryDestination[])
    : ((depotsRaw as unknown as { data?: DeliveryDestination[] })?.data ?? []);

  const active = allDepots.filter((d) => d.isActive);

  const currentAssignment = user.assignedDeliveryDestinationId ?? null;
  const [selected, setSelected] = useState<string | null>(currentAssignment);
  const updateUser = useUpdateUser(apiClient);
  const isDirty = selected !== currentAssignment;

  const handleSave = () => {
    if (!isDirty) return;
    updateUser.mutate(
      { id: user.id, data: { assignedDeliveryDestinationId: selected } },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-800">
            {t('accounts.depot.title')}
            {' — '}
            <span className="text-primary">{user.fullName}</span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          <p className="mb-4 text-sm text-neutral-500">
            {t('accounts.depot.roleHint', { role: t(ROLE_LABEL_KEYS[user.role]) })}
          </p>

          {active.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {t('accounts.depot.noCompatible')}
            </p>
          ) : (
            <div className="space-y-2">
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                  selected === null
                    ? 'border-primary bg-primary/5'
                    : 'border-neutral-200 hover:bg-neutral-50'
                }`}
              >
                <input
                  type="radio"
                  name="depot"
                  value=""
                  checked={selected === null}
                  onChange={() => setSelected(null)}
                  className="accent-primary"
                />
                <span className="text-sm text-neutral-500 italic">
                  {t('accounts.depot.noneAssigned')}
                </span>
              </label>

              {active.map((d) => (
                <label
                  key={d.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    selected === d.id
                      ? 'border-primary bg-primary/5'
                      : 'border-neutral-200 hover:bg-neutral-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="depot"
                    value={d.id}
                    checked={selected === d.id}
                    onChange={() => setSelected(d.id)}
                    className="accent-primary"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-neutral-800">{d.name}</p>
                    <p className="text-xs text-neutral-400">{d.code}</p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {updateUser.isError && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(updateUser.error as Error)?.message ?? t('accounts.assign.errorSave')}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-neutral-100 bg-neutral-50 px-6 py-4">
          <button type="button" onClick={onClose} className={cancelBtnCls}>
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={updateUser.isPending || active.length === 0 || !isDirty}
            className={submitBtnCls}
          >
            <Link2 className="h-4 w-4" />
            {updateUser.isPending ? t('accounts.assign.saving') : t('accounts.depot.assignAction')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const { t } = useI18n();
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [assignTarget, setAssignTarget] = useState<User | null>(null);
  const [assignDepotTarget, setAssignDepotTarget] = useState<User | null>(null);
  const [assignBenTarget, setAssignBenTarget] = useState<User | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const {
    data: usersRaw,
    isLoading,
    isError,
  } = useAdminUsers(apiClient, { refetchInterval: 30_000 });
  const { data: machinesRaw } = useMachines(apiClient);
  const { data: depotsRaw } = useDeliveryDestinations(apiClient);
  const deactivate = useDeactivateUser(apiClient);

  const users: User[] = Array.isArray(usersRaw)
    ? (usersRaw as User[])
    : ((usersRaw as unknown as { data?: User[] })?.data ?? []);

  const allMachines: Machine[] = Array.isArray(machinesRaw)
    ? (machinesRaw as Machine[])
    : ((machinesRaw as { data?: Machine[] })?.data ?? []);

  const allDepots: DeliveryDestination[] = Array.isArray(depotsRaw)
    ? (depotsRaw as DeliveryDestination[])
    : ((depotsRaw as unknown as { data?: DeliveryDestination[] })?.data ?? []);

  const machineMap = new Map(allMachines.map((m) => [m.id, m]));
  const depotMap = new Map(allDepots.map((d) => [d.id, d]));

  // ── Stats (unfiltered) ───────────────────────────────────────────────
  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.isActive).length;
  const adminCount = users.filter((u) => u.role === UserRole.admin).length;
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
        statusFilter === 'all' || (statusFilter === 'active' ? u.isActive : !u.isActive);
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
          label={t('accounts.statTotal')}
          color="bg-neutral-100"
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
          value={activeUsers}
          label={t('accounts.statActive')}
          color="bg-green-50"
        />
        <StatCard
          icon={<Shield className="h-4 w-4 text-purple-600" />}
          value={adminCount}
          label={t('accounts.statAdmins')}
          color="bg-purple-50"
        />
        <StatCard
          icon={<UserCheck className="h-4 w-4 text-blue-600" />}
          value={operatorCount}
          label={t('accounts.statOperators')}
          color="bg-blue-50"
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[240px] flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('accounts.filter.searchPlaceholder')}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className={selectCls}
        >
          <option value="all">{t('accounts.filter.allStatuses')}</option>
          <option value="active">{t('accounts.filter.active')}</option>
          <option value="inactive">{t('accounts.filter.inactive')}</option>
        </select>
        <span className="ml-auto text-xs text-neutral-400">
          {t(totalVisible === 1 ? 'accounts.filter.countSingular' : 'accounts.filter.countPlural', {
            count: totalVisible,
          })}
        </span>
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="py-12 text-center text-sm text-neutral-400">
          {t('accounts.state.loading')}
        </div>
      )}
      {isError && (
        <div className="py-12 text-center text-sm text-red-500">{t('accounts.state.error')}</div>
      )}

      {/* Table */}
      {!isLoading && !isError && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">{t('accounts.table.colName')}</th>
                <th className="px-4 py-3">{t('accounts.table.colUsername')}</th>
                <th className="px-4 py-3">{t('accounts.table.colPin')}</th>
                <th className="px-4 py-3">{t('accounts.table.colRole')}</th>
                <th className="px-4 py-3">{t('accounts.table.colMachine')}</th>
                <th className="px-4 py-3">{t('accounts.table.colPhone')}</th>
                <th className="px-4 py-3">{t('accounts.table.colStatus')}</th>
                <th className="px-4 py-3 text-right">{t('accounts.table.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {groups.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-neutral-400">
                    {search || statusFilter !== 'all'
                      ? t('accounts.state.emptyFiltered')
                      : t('accounts.state.empty')}
                  </td>
                </tr>
              )}

              {groups.map((group) => (
                <Fragment key={group.role}>
                  {/* Group header */}
                  <tr className="border-y border-neutral-200 bg-neutral-50">
                    <td colSpan={8} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {ROLE_GROUP_ICONS[group.role]}
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                          {t(ROLE_LABEL_KEYS[group.role])}
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
                    const assignedDepot = user.assignedDeliveryDestinationId
                      ? depotMap.get(user.assignedDeliveryDestinationId)
                      : null;
                    const canAssign =
                      user.role !== UserRole.admin &&
                      user.role !== UserRole.dispatcher &&
                      user.role !== UserRole.geofence_maker &&
                      user.role !== UserRole.depot_manager &&
                      user.role !== UserRole.transportator &&
                      user.isActive;
                    const canAssignDepot = ROLE_REQUIRES_DEPOT.includes(user.role) && user.isActive;
                    const canAssignBeneficiaries =
                      user.role === UserRole.transportator && user.isActive;

                    return (
                      <tr
                        key={user.id}
                        className={`hover:bg-neutral-50 ${!user.isActive ? 'opacity-50' : ''}`}
                      >
                        <td className="px-4 py-3 font-medium text-neutral-800">
                          <div className="flex items-center gap-2">
                            <div className="relative">
                              <UserAvatar user={user} size="sm" />
                              <UserPresenceDot
                                lastSeenAt={user.lastSeenAt}
                                className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5"
                              />
                            </div>
                            {user.role === UserRole.admin && (
                              <Shield className="h-3.5 w-3.5 text-purple-400" />
                            )}
                            {user.fullName}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-sm text-neutral-600">
                            {user.username ?? (
                              <span className="text-neutral-300 not-italic italic">—</span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <PinCell pin={user.pin} />
                        </td>
                        <td className="px-4 py-3">
                          <RoleBadge role={user.role} />
                        </td>
                        <td className="px-4 py-3">
                          {canAssignBeneficiaries ? (
                            <button
                              onClick={() => setAssignBenTarget(user)}
                              className="flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-500 hover:border-cyan-400 hover:text-cyan-600 transition-colors"
                              title={t('accounts.beneficiaries.assignAction')}
                            >
                              <Users className="h-3 w-3" />
                              {t('accounts.beneficiaries.assignAction')}
                            </button>
                          ) : canAssignDepot ? (
                            assignedDepot ? (
                              <button
                                onClick={() => setAssignDepotTarget(user)}
                                className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-orange-600 hover:bg-orange-50 transition-colors"
                                title={t('accounts.depot.assignAction')}
                              >
                                <span className="font-mono">{assignedDepot.code}</span>
                                <span className="text-neutral-400">{assignedDepot.name}</span>
                                <Link2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </button>
                            ) : (
                              <button
                                onClick={() => setAssignDepotTarget(user)}
                                className="flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-400 hover:border-orange-400 hover:text-orange-500 transition-colors"
                              >
                                <Link2 className="h-3 w-3" />
                                {t('accounts.depot.noneAssigned')}
                              </button>
                            )
                          ) : assignedMachine ? (
                            <button
                              onClick={() => canAssign && setAssignTarget(user)}
                              className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                              title={t('accounts.actions.assignTooltip')}
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
                              {t('accounts.assign.assignButton')}
                            </button>
                          ) : (
                            <span className="text-xs text-neutral-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-neutral-500">{user.phone ?? '—'}</td>
                        <td className="px-4 py-3">
                          {user.isActive ? (
                            <UserPresenceDot lastSeenAt={user.lastSeenAt} variant="badge" />
                          ) : (
                            <span className="text-xs text-neutral-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setEditTarget(user)}
                              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                              title={t('accounts.actions.editTooltip')}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            {user.isActive && (
                              <button
                                onClick={() => setDeactivateTarget(user)}
                                className="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500"
                                title={t('accounts.actions.deactivateTooltip')}
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
      {showCreate && <CreateAccountModal onClose={() => setShowCreate(false)} />}
      {editTarget && <EditUserModal user={editTarget} onClose={() => setEditTarget(null)} />}
      {assignTarget && (
        <AssignMachineModal user={assignTarget} onClose={() => setAssignTarget(null)} />
      )}
      {assignDepotTarget && (
        <AssignDepotModal user={assignDepotTarget} onClose={() => setAssignDepotTarget(null)} />
      )}
      {assignBenTarget && (
        <AssignBeneficiariesModal user={assignBenTarget} onClose={() => setAssignBenTarget(null)} />
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
