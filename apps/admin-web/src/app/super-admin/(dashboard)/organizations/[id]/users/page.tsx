'use client';
export const dynamic = 'force-dynamic';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  UserPlus,
  Trash2,
  Shield,
  CheckCircle2,
  XCircle,
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
  useSuperAdminUsers,
  useCreateSuperAdminUser,
  useUpdateSuperAdminUser,
  useDeactivateSuperAdminUser,
  type CreateUserPayload,
  type UpdateUserPayload,
} from '@strawboss/api';
import { UserRole } from '@strawboss/types';
import type { User, Organization } from '@strawboss/types';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { apiClient } from '@/lib/api';
import { clientLogger } from '@/lib/client-logger';
import { useI18n } from '@/lib/i18n';
import { useLocaleFormat } from '@/lib/use-locale-format';

// ── Role config (mirrors /[slug]/(dashboard)/accounts/page.tsx) ───────────

const ALL_ROLES: UserRole[] = [
  UserRole.admin,
  UserRole.baler_operator,
  UserRole.loader_operator,
  UserRole.driver,
  UserRole.geofence_maker,
  UserRole.depot_manager,
  UserRole.transportator,
];

/** i18n keys for each role — resolved via t() at render time. */
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

// ── Shared UI atoms ───────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const cancelBtnCls =
  'rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50';

const submitBtnCls =
  'flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white ' +
  'hover:bg-neutral-700 disabled:opacity-60';

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

// ── Client-side credential preview ────────────────────────────────────────

function slugifyClient(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function deriveCredentials(fullName: string): { username: string; email: string } | null {
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
        title={visible ? t('superAdmin.users.pin.hide') : t('superAdmin.users.pin.show')}
      >
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => {
          void handleCopy();
        }}
        className="rounded p-0.5 text-neutral-400 hover:text-neutral-600"
        title={t('superAdmin.users.pin.copy')}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      {copied && <span className="text-xs text-green-600">{t('superAdmin.users.pin.copied')}</span>}
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
              <p className="font-semibold text-neutral-800">
                {t('superAdmin.users.deactivate.title')}
              </p>
              <p className="text-sm text-neutral-500">
                <span className="font-medium">{user.fullName}</span>
                {t('superAdmin.users.deactivate.descSuffix')}
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
                ? t('superAdmin.users.deactivate.deactivating')
                : t('superAdmin.users.deactivate.deactivate')}
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

function CreateAccountModal({
  orgId,
  onClose,
  onCreated,
}: {
  orgId: string;
  onClose: () => void;
  onCreated: (user: User) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<CreateForm>({
    fullName: '',
    role: UserRole.admin, // super-admin's primary use case: create an org admin
    phone: '',
    usernameOverride: '',
  });

  const createUser = useCreateSuperAdminUser(apiClient, orgId);

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
    createUser.mutate(payload, {
      onSuccess: (created) => {
        onCreated(created);
        onClose();
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-neutral-800">
            {t('superAdmin.users.create.title')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <FormField label={t('superAdmin.users.form.fullName')} required>
            <input
              required
              type="text"
              value={form.fullName}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  fullName: e.target.value,
                  usernameOverride: '',
                }))
              }
              className={inputCls}
              placeholder={t('superAdmin.users.form.fullNamePlaceholder')}
            />
            {form.fullName && !preview && (
              <p className="mt-1 text-xs text-amber-600">
                {t('superAdmin.users.form.fullNameHint')}
              </p>
            )}
          </FormField>

          <FormField label={t('superAdmin.users.form.role')} required>
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

          <FormField label={t('superAdmin.users.form.phone')}>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={inputCls}
              placeholder={t('superAdmin.users.form.phonePlaceholder')}
            />
          </FormField>

          {preview && (
            <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                {t('superAdmin.users.form.generatedSection')}
              </p>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-neutral-500">
                    {t('superAdmin.users.form.usernameRowLabel')}
                  </span>
                  <input
                    type="text"
                    value={displayUsername}
                    onChange={(e) => setForm((f) => ({ ...f, usernameOverride: e.target.value }))}
                    className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder={preview.username}
                    title={t('superAdmin.users.form.usernameOverrideTooltip')}
                  />
                  {form.usernameOverride && (
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, usernameOverride: '' }))}
                      className="text-xs text-neutral-400 hover:text-neutral-600"
                    >
                      {t('superAdmin.users.form.reset')}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-neutral-500">
                    {t('superAdmin.users.form.emailRowLabel')}
                  </span>
                  <span className="truncate font-mono text-sm text-neutral-600">
                    {preview.email}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-neutral-500">
                    {t('superAdmin.users.form.pinRowLabel')}
                  </span>
                  <span className="font-mono text-sm text-neutral-400">
                    {t('superAdmin.users.form.pinServerGen')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {createUser.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(createUser.error as Error)?.message ?? t('superAdmin.users.create.errorFallback')}
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
                ? t('superAdmin.users.create.creating')
                : t('superAdmin.users.create.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Credentials reveal — shown right after creation ──────────────────────

function CredentialsRevealDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const rows: { label: string; value: string }[] = [
    { label: t('superAdmin.users.reveal.row.username'), value: user.username ?? '' },
    { label: t('superAdmin.users.reveal.row.email'), value: user.email },
    { label: t('superAdmin.users.reveal.row.pin'), value: user.pin ?? '' },
    {
      label: t('superAdmin.users.reveal.row.password'),
      value: user.pin ? `sb_${user.pin}` : '',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-800">
            {t('superAdmin.users.reveal.titlePrefix')}
            <span className="text-neutral-900">{user.fullName}</span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 p-6">
          <p className="text-xs text-neutral-500">{t('superAdmin.users.reveal.warning')}</p>

          <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center gap-2">
                <span className="w-40 shrink-0 text-xs text-neutral-500">{r.label}:</span>
                <span className="flex-1 truncate font-mono text-sm text-neutral-800">
                  {r.value || '—'}
                </span>
                {r.value && (
                  <button
                    type="button"
                    onClick={() => void copy(r.label, r.value)}
                    className="rounded p-1 text-neutral-400 hover:text-neutral-700"
                    title={t('superAdmin.users.reveal.copyTitle', { label: r.label })}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
                {copied === r.label && (
                  <span className="text-xs text-green-600">
                    {t('superAdmin.users.reveal.copied')}
                  </span>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-neutral-400">{t('superAdmin.users.reveal.loginHint')}</p>

          <div className="flex justify-end pt-2">
            <button type="button" onClick={onClose} className={submitBtnCls}>
              {t('superAdmin.users.reveal.done')}
            </button>
          </div>
        </div>
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
}

function EditUserModal({
  orgId,
  user,
  onClose,
}: {
  orgId: string;
  user: User;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<EditForm>({
    username: user.username ?? '',
    pin: user.pin ?? '',
    fullName: user.fullName,
    role: user.role,
    phone: user.phone ?? '',
  });
  const [showPin, setShowPin] = useState(false);
  const updateUser = useUpdateSuperAdminUser(apiClient, orgId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: UpdateUserPayload = {
      fullName: form.fullName || undefined,
      phone: form.phone || null,
    };
    // Only when it actually changed — see accounts/page.tsx.
    if (form.role !== user.role) data.role = form.role;
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
            {t('superAdmin.users.edit.titlePrefix')}
            <span className="text-neutral-900">{user.fullName}</span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <FormField label={t('superAdmin.users.form.fullName')} required>
            <input
              required
              type="text"
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              className={inputCls}
            />
          </FormField>

          <FormField label={t('superAdmin.users.form.role')} required>
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

          <FormField label={t('superAdmin.users.form.phone')}>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={inputCls}
              placeholder={t('superAdmin.users.form.phonePlaceholder')}
            />
          </FormField>

          <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              {t('superAdmin.users.form.credentialsSection')}
            </p>

            <FormField label={t('superAdmin.users.form.username')}>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                className={inputCls}
                placeholder={t('superAdmin.users.form.usernamePlaceholder')}
                minLength={3}
              />
            </FormField>

            <FormField label={t('superAdmin.users.form.pinLabel')}>
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  value={form.pin}
                  onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))}
                  className={`${inputCls} pr-10`}
                  placeholder={t('superAdmin.users.form.pinPlaceholder')}
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
              <p className="mt-1 text-xs text-neutral-400">{t('superAdmin.users.form.pinHint')}</p>
            </FormField>
          </div>

          {updateUser.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(updateUser.error as Error)?.message ?? t('superAdmin.users.edit.errorFallback')}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={cancelBtnCls}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={updateUser.isPending} className={submitBtnCls}>
              {updateUser.isPending ? t('superAdmin.users.edit.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function SuperAdminOrgUsersPage() {
  const { t } = useI18n();
  const fmt = useLocaleFormat();
  const params = useParams<{ id: string }>();
  const orgId = params?.id ?? '';

  const [org, setOrg] = useState<Organization | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);

  // Fetch the org once so we can show its name in the breadcrumb/header.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void apiClient
      .get<Organization>(`/api/v1/organizations/${orgId}`)
      .then((res) => {
        if (!cancelled) setOrg(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Show a generic localized message in the UI; keep the raw server
        // message in the client log for diagnostics so we don't leak internal
        // server details (paths, stack traces) into the rendered banner.
        const raw = err instanceof Error ? err.message : String(err);
        clientLogger.error('orgError raw', { area: 'super-admin-users', orgId, raw });
        setOrgError(t('superAdmin.users.orgLoadError'));
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, t]);

  const [showCreate, setShowCreate] = useState(false);
  const [createdUser, setCreatedUser] = useState<User | null>(null);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);

  const { data: usersRaw, isLoading, isError, error } = useSuperAdminUsers(apiClient, orgId);
  const deactivate = useDeactivateSuperAdminUser(apiClient, orgId);

  const users: User[] = Array.isArray(usersRaw) ? (usersRaw as User[]) : [];

  // ── Stats ────────────────────────────────────────────────────────────
  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.isActive).length;
  const adminCount = users.filter((u) => u.role === UserRole.admin).length;
  const operatorCount = users.filter((u) => u.role !== UserRole.admin).length;

  // ── Grouped by role ──────────────────────────────────────────────────
  const groups = useMemo(() => {
    return ALL_ROLES.map((role) => ({
      role,
      users: users
        .filter((u) => u.role === role)
        .sort((a, b) => fmt.compare(a.fullName, b.fullName)),
    })).filter((g) => g.users.length > 0);
  }, [users, fmt]);

  const handleDeactivate = () => {
    if (!deactivateTarget) return;
    deactivate.mutate(deactivateTarget.id, {
      onSuccess: () => setDeactivateTarget(null),
    });
  };

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <a
          href="/super-admin/organizations"
          className="inline-flex items-center gap-1 hover:text-neutral-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('superAdmin.users.breadcrumb.orgs')}
        </a>
        <span className="text-neutral-300">/</span>
        <span className="font-medium text-neutral-800">{org?.name ?? '…'}</span>
        <span className="text-neutral-300">/</span>
        <span>{t('superAdmin.users.breadcrumb.users')}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-800">
            {t('superAdmin.users.headerTitle', {
              org: org?.name ?? t('superAdmin.users.headerOrgFallback'),
            })}
          </h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            {t('superAdmin.users.headerSubtitlePrefix')}
            {org ? (
              <code className="font-mono text-neutral-700">/{org.slug}/</code>
            ) : (
              t('superAdmin.users.headerSubtitleGeneric')
            )}
            {t('superAdmin.users.headerSubtitleSuffix')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          disabled={!orgId}
          className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" />
          {t('superAdmin.users.newAccount')}
        </button>
      </div>

      {orgError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {orgError}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<Users className="h-4 w-4 text-neutral-600" />}
          value={totalUsers}
          label={t('superAdmin.users.statTotal')}
          color="bg-neutral-100"
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
          value={activeUsers}
          label={t('superAdmin.users.statActive')}
          color="bg-green-50"
        />
        <StatCard
          icon={<Shield className="h-4 w-4 text-purple-600" />}
          value={adminCount}
          label={t('superAdmin.users.statAdmins')}
          color="bg-purple-50"
        />
        <StatCard
          icon={<UserCheck className="h-4 w-4 text-blue-600" />}
          value={operatorCount}
          label={t('superAdmin.users.statOperators')}
          color="bg-blue-50"
        />
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="py-12 text-center text-sm text-neutral-400">
          {t('superAdmin.users.state.loading')}
        </div>
      )}
      {isError && (
        <div className="py-12 text-center text-sm text-red-500">
          {(error as Error)?.message ?? t('superAdmin.users.state.errorFallback')}
        </div>
      )}

      {/* Table */}
      {!isLoading && !isError && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">{t('superAdmin.users.table.colName')}</th>
                <th className="px-4 py-3">{t('superAdmin.users.table.colUsername')}</th>
                <th className="px-4 py-3">{t('superAdmin.users.table.colEmail')}</th>
                <th className="px-4 py-3">{t('superAdmin.users.table.colPin')}</th>
                <th className="px-4 py-3">{t('superAdmin.users.table.colRole')}</th>
                <th className="px-4 py-3">{t('superAdmin.users.table.colPhone')}</th>
                <th className="px-4 py-3">{t('superAdmin.users.table.colStatus')}</th>
                <th className="px-4 py-3 text-right">{t('superAdmin.users.table.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {groups.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-neutral-400">
                    {t('superAdmin.users.state.empty')}
                  </td>
                </tr>
              )}

              {groups.map((group) => (
                <Fragment key={group.role}>
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

                  {group.users.map((user) => (
                    <tr
                      key={user.id}
                      className={`hover:bg-neutral-50 ${!user.isActive ? 'opacity-50' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-neutral-800">
                        <div className="flex items-center gap-2">
                          <UserAvatar user={user} size="sm" />
                          {user.role === UserRole.admin && (
                            <Shield className="h-3.5 w-3.5 text-purple-400" />
                          )}
                          {user.fullName}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm text-neutral-600">
                          {user.username ?? <span className="text-neutral-300">—</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-500">{user.email}</td>
                      <td className="px-4 py-3">
                        <PinCell pin={user.pin} />
                      </td>
                      <td className="px-4 py-3">
                        <RoleBadge role={user.role} />
                      </td>
                      <td className="px-4 py-3 text-neutral-500">{user.phone ?? '—'}</td>
                      <td className="px-4 py-3">
                        {user.isActive ? (
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle2 className="h-4 w-4" />{' '}
                            {t('superAdmin.users.status.active')}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-neutral-400">
                            <XCircle className="h-4 w-4" /> {t('superAdmin.users.status.inactive')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditTarget(user)}
                            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                            title={t('superAdmin.users.actions.edit')}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {user.isActive && (
                            <button
                              onClick={() => setDeactivateTarget(user)}
                              className="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500"
                              title={t('superAdmin.users.actions.deactivate')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
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
        <CreateAccountModal
          orgId={orgId}
          onClose={() => setShowCreate(false)}
          onCreated={(u) => setCreatedUser(u)}
        />
      )}
      {createdUser && (
        <CredentialsRevealDialog user={createdUser} onClose={() => setCreatedUser(null)} />
      )}
      {editTarget && (
        <EditUserModal orgId={orgId} user={editTarget} onClose={() => setEditTarget(null)} />
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
