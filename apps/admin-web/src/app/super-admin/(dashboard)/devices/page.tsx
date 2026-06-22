'use client';
export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import {
  Smartphone,
  Rocket,
  Trash2,
  Pencil,
  Building2,
  PackageOpen,
  Loader2,
  AlertTriangle,
  XCircle,
  Settings,
  Eye,
  EyeOff,
  Upload,
} from 'lucide-react';
import {
  useDevices,
  useUpdateDevice,
  useDeleteDevice,
  useReleases,
  useCreateDeployment,
  useSetDeviceTailscale,
  useTailscaleSettings,
  useUpdateTailscaleSettings,
  useUploadTailscaleApk,
} from '@strawboss/api';
import type { FleetDeviceListItem, AppRelease } from '@strawboss/types';
import { OtaState, OtaTargetKind, ReleaseStatus } from '@strawboss/types';
import type { UpdateDeviceInput, CreateDeploymentInput } from '@strawboss/validation';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

// ── Shared CSS atoms ──────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-700';

const cancelBtnCls =
  'rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50';

const submitBtnCls =
  'flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium ' +
  'text-white hover:bg-neutral-700 disabled:opacity-60';

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

// ── Device nickname display ───────────────────────────────────────────────────

function DeviceNickname({ device }: { device: FleetDeviceListItem }) {
  const { t } = useI18n();
  if (device.name) {
    return (
      <div>
        <p className="font-semibold text-neutral-900">{device.name}</p>
        {device.organizationName && (
          <p className="text-xs text-neutral-400">{device.organizationName}</p>
        )}
        <p className="font-mono text-xs text-neutral-300">{device.deviceUuid.slice(0, 8)}…</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-sm text-neutral-400 italic">{t('superAdmin.devices.noName')}</p>
      {device.organizationName && (
        <p className="text-xs text-neutral-400">{device.organizationName}</p>
      )}
      <p className="font-mono text-xs text-neutral-300">{device.deviceUuid.slice(0, 8)}…</p>
    </div>
  );
}

// ── OTA state badge ───────────────────────────────────────────────────────────

const OTA_STATE_STYLES: Record<OtaState, string> = {
  [OtaState.pending]: 'bg-neutral-100 text-neutral-600',
  [OtaState.notified]: 'bg-neutral-100 text-neutral-600',
  [OtaState.downloading]: 'bg-blue-100 text-blue-700',
  [OtaState.downloaded]: 'bg-blue-100 text-blue-700',
  [OtaState.awaiting_idle]: 'bg-amber-100 text-amber-700',
  [OtaState.installing]: 'bg-amber-100 text-amber-700',
  [OtaState.installed]: 'bg-green-100 text-green-700',
  [OtaState.failed]: 'bg-red-100 text-red-700',
};

function OtaStateBadge({ state }: { state: OtaState | null }) {
  const { t } = useI18n();
  if (!state) return <span className="text-xs text-neutral-300">—</span>;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${OTA_STATE_STYLES[state] ?? 'bg-neutral-100 text-neutral-600'}`}
    >
      {t(`superAdmin.devices.otaState.${state}`)}
    </span>
  );
}

// ── App online dot ────────────────────────────────────────────────────────────

function OnlineDot({ lastSeenAt }: { lastSeenAt: string | null }) {
  const { t } = useI18n();
  const online = lastSeenAt != null && Date.now() - new Date(lastSeenAt).getTime() < 90_000;
  return (
    <span
      title={online ? t('superAdmin.devices.online') : t('superAdmin.devices.offline')}
      className={`inline-block h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-neutral-300'}`}
    />
  );
}

// ── Tailscale dot ─────────────────────────────────────────────────────────────

function TailscaleDot({ desired, online }: { desired: boolean; online: boolean }) {
  const { t } = useI18n();
  if (!desired) {
    return (
      <span
        title={t('superAdmin.devices.tailscale.offline')}
        className="inline-block h-2 w-2 rounded-full bg-neutral-300"
      />
    );
  }
  if (online) {
    return (
      <span
        title={t('superAdmin.devices.tailscale.online')}
        className="inline-block h-2 w-2 rounded-full bg-teal-500"
      />
    );
  }
  // desired but not yet online → amber pending
  return (
    <span
      title={t('superAdmin.devices.tailscale.pending')}
      className="inline-block h-2 w-2 rounded-full bg-amber-400"
    />
  );
}

// ── Tailscale toggle ──────────────────────────────────────────────────────────

function TailscaleToggle({ device }: { device: FleetDeviceListItem }) {
  const { t } = useI18n();
  const setTailscale = useSetDeviceTailscale(apiClient);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTailscale.mutate({ id: device.id, desired: !device.tailscaleDesired });
  };

  const label = device.tailscaleDesired
    ? t('superAdmin.devices.tailscale.disable')
    : t('superAdmin.devices.tailscale.enable');

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={setTailscale.isPending}
      title={label}
      aria-label={label}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1 disabled:opacity-50 ${
        device.tailscaleDesired ? 'bg-teal-500' : 'bg-neutral-300'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          device.tailscaleDesired ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// ── Tailscale status cell (list row) ─────────────────────────────────────────

function TailscaleCell({ device }: { device: FleetDeviceListItem }) {
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <TailscaleDot desired={device.tailscaleDesired} online={device.tailscaleOnline} />
      <TailscaleToggle device={device} />
    </div>
  );
}

// ── Tailscale settings modal ──────────────────────────────────────────────────

function TailscaleSettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { data: settings, isLoading } = useTailscaleSettings(apiClient);
  const updateSettings = useUpdateTailscaleSettings(apiClient);
  const uploadApk = useUploadTailscaleApk(apiClient);

  // Shared auth key
  const [authKey, setAuthKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // Tailnet
  const [tailnet, setTailnet] = useState('');

  // OAuth client
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [showOauthSecret, setShowOauthSecret] = useState(false);
  const [clearOauth, setClearOauth] = useState(false);

  // Tag
  const [tag, setTag] = useState('');

  // APK upload
  const [apkFile, setApkFile] = useState<File | null>(null);

  // Seed text fields from loaded settings (once)
  const [seeded, setSeeded] = useState(false);
  if (settings && !seeded) {
    setTailnet(settings.tailscaleTailnet ?? '');
    setTag(settings.tailscaleTag ?? '');
    setSeeded(true);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: {
      authKey?: string | null;
      tailnet?: string | null;
      oauthClientId?: string | null;
      oauthClientSecret?: string | null;
      tag?: string | null;
    } = {
      tailnet: tailnet.trim() || null,
      tag: tag.trim() || null,
    };

    // Auth key — omit if field is empty and not clearing
    if (clearKey) {
      payload.authKey = '';
    } else if (authKey.trim()) {
      payload.authKey = authKey.trim();
    }

    // OAuth client — omit both if neither changed and not clearing
    if (clearOauth) {
      payload.oauthClientId = '';
      payload.oauthClientSecret = '';
    } else {
      if (oauthClientId.trim()) payload.oauthClientId = oauthClientId.trim();
      if (oauthClientSecret.trim()) payload.oauthClientSecret = oauthClientSecret.trim();
    }

    updateSettings.mutate(payload, { onSuccess: () => onClose() });
  };

  const handleApkUpload = () => {
    if (!apkFile) return;
    const formData = new FormData();
    formData.append('apk', apkFile);
    uploadApk.mutate(formData, {
      onSuccess: () => {
        setApkFile(null);
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-800">
            {t('superAdmin.devices.tailscale.settingsTitle')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-neutral-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="max-h-[80vh] overflow-y-auto">
            <form onSubmit={handleSubmit} className="space-y-5 p-6">
              <p className="text-sm text-neutral-500">
                {t('superAdmin.devices.tailscale.settingsSubtitle')}
              </p>

              {/* ── Shared auth key section ── */}
              <div className="space-y-3 rounded-lg border border-neutral-200 p-4">
                {/* Key expiry warning */}
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-xs text-amber-700">
                    {t('superAdmin.devices.tailscale.keyWarning')}
                  </p>
                </div>

                <FormField label={t('superAdmin.devices.tailscale.authKeyLabel')}>
                  <div className="space-y-2">
                    <p className="text-xs text-neutral-500">
                      {t('superAdmin.devices.tailscale.authKeyLabel')}:{' '}
                      <span
                        className={`font-medium ${settings?.tailscaleAuthKeySet ? 'text-green-700' : 'text-red-600'}`}
                      >
                        {settings?.tailscaleAuthKeySet
                          ? t('superAdmin.devices.tailscale.authKeySet')
                          : t('superAdmin.devices.tailscale.authKeyUnset')}
                      </span>
                    </p>
                    <div className="relative">
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={authKey}
                        onChange={(e) => setAuthKey(e.target.value)}
                        disabled={clearKey}
                        className={`${inputCls} pr-10`}
                        placeholder={t('superAdmin.devices.tailscale.authKeyPlaceholder')}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                        tabIndex={-1}
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
                      <input
                        type="checkbox"
                        checked={clearKey}
                        onChange={(e) => setClearKey(e.target.checked)}
                        className="accent-red-600"
                      />
                      {t('superAdmin.devices.tailscale.authKeyClear')}
                    </label>
                    <p className="text-xs text-neutral-400">
                      {t('superAdmin.devices.tailscale.authKeyClearHint')}
                    </p>
                  </div>
                </FormField>
              </div>

              {/* ── Tailnet ── */}
              <FormField label={t('superAdmin.devices.tailscale.tailnetLabel')}>
                <input
                  type="text"
                  value={tailnet}
                  onChange={(e) => setTailnet(e.target.value)}
                  className={inputCls}
                  placeholder={t('superAdmin.devices.tailscale.tailnetPlaceholder')}
                />
              </FormField>

              {/* ── OAuth client section ── */}
              <div className="space-y-3 rounded-lg border border-teal-100 bg-teal-50/30 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-teal-800">
                    {t('superAdmin.devices.tailscale.oauthSectionTitle')}
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      settings?.tailscaleOauthConfigured
                        ? 'bg-teal-100 text-teal-700'
                        : 'bg-neutral-100 text-neutral-500'
                    }`}
                  >
                    {settings?.tailscaleOauthConfigured
                      ? t('superAdmin.devices.tailscale.oauthConfigured')
                      : t('superAdmin.devices.tailscale.oauthNotConfigured')}
                  </span>
                </div>
                <p className="text-xs text-teal-700">
                  {t('superAdmin.devices.tailscale.oauthHint')}
                </p>

                <FormField label={t('superAdmin.devices.tailscale.oauthClientIdLabel')}>
                  <input
                    type="text"
                    value={oauthClientId}
                    onChange={(e) => setOauthClientId(e.target.value)}
                    disabled={clearOauth}
                    className={inputCls}
                    placeholder={t('superAdmin.devices.tailscale.oauthClientIdPlaceholder')}
                    autoComplete="off"
                  />
                </FormField>

                <FormField label={t('superAdmin.devices.tailscale.oauthClientSecretLabel')}>
                  <div className="relative">
                    <input
                      type={showOauthSecret ? 'text' : 'password'}
                      value={oauthClientSecret}
                      onChange={(e) => setOauthClientSecret(e.target.value)}
                      disabled={clearOauth}
                      className={`${inputCls} pr-10`}
                      placeholder={t('superAdmin.devices.tailscale.oauthClientSecretPlaceholder')}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowOauthSecret((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                      tabIndex={-1}
                    >
                      {showOauthSecret ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </FormField>

                <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
                  <input
                    type="checkbox"
                    checked={clearOauth}
                    onChange={(e) => setClearOauth(e.target.checked)}
                    className="accent-red-600"
                  />
                  {t('superAdmin.devices.tailscale.oauthClientIdClear')}
                </label>
                <p className="text-xs text-neutral-400">
                  {t('superAdmin.devices.tailscale.oauthClientIdClearHint')}
                </p>
              </div>

              {/* ── Tag ── */}
              <FormField label={t('superAdmin.devices.tailscale.tagLabel')}>
                <input
                  type="text"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  className={inputCls}
                  placeholder={t('superAdmin.devices.tailscale.tagPlaceholder')}
                />
                <p className="mt-1 text-xs text-neutral-400">
                  {t('superAdmin.devices.tailscale.tagHint')}
                </p>
              </FormField>

              {/* Last updated */}
              {settings?.updatedAt && (
                <p className="text-xs text-neutral-400">
                  {t('superAdmin.devices.tailscale.updatedAt')}:{' '}
                  {new Date(settings.updatedAt).toLocaleString('ro-RO', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              )}

              {updateSettings.isError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {(updateSettings.error as Error)?.message ?? t('common.error')}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={onClose} className={cancelBtnCls}>
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={updateSettings.isPending} className={submitBtnCls}>
                  {updateSettings.isPending
                    ? t('superAdmin.devices.tailscale.saving')
                    : t('superAdmin.devices.tailscale.save')}
                </button>
              </div>
            </form>

            {/* ── Tailscale APK section (separate action) ── */}
            <div className="space-y-3 border-t border-neutral-200 p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-neutral-800">
                  {t('superAdmin.devices.tailscale.apkSectionTitle')}
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    settings?.tailscaleApkSet
                      ? 'bg-green-100 text-green-700'
                      : 'bg-neutral-100 text-neutral-500'
                  }`}
                >
                  {settings?.tailscaleApkSet
                    ? t('superAdmin.devices.tailscale.apkSet')
                    : t('superAdmin.devices.tailscale.apkUnset')}
                </span>
              </div>
              <p className="text-xs text-neutral-500">
                {t('superAdmin.devices.tailscale.apkHint')}
              </p>

              <FormField label={t('superAdmin.devices.tailscale.apkFileLabel')}>
                <input
                  type="file"
                  accept=".apk"
                  onChange={(e) => setApkFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-700 hover:file:bg-neutral-50"
                />
              </FormField>

              {uploadApk.isError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {(uploadApk.error as Error)?.message ??
                    t('superAdmin.devices.tailscale.apkUploadError')}
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleApkUpload}
                  disabled={!apkFile || uploadApk.isPending}
                  className={submitBtnCls}
                >
                  <Upload className="h-4 w-4" />
                  {uploadApk.isPending
                    ? t('superAdmin.devices.tailscale.apkUploading')
                    : t('superAdmin.devices.tailscale.apkUploadButton')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Edit / assign device modal ────────────────────────────────────────────────

interface EditDeviceModalProps {
  device: FleetDeviceListItem;
  orgs: Array<{ id: string; name: string }>;
  onClose: () => void;
}

function EditDeviceModal({ device, orgs, onClose }: EditDeviceModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState(device.name ?? '');
  const [orgId, setOrgId] = useState(device.organizationId ?? '');
  const update = useUpdateDevice(apiClient);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: UpdateDeviceInput = {
      name: name.trim() || null,
      organizationId: orgId || null,
    };
    update.mutate({ id: device.id, data }, { onSuccess: () => onClose() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-800">
              {t('superAdmin.devices.editModal.title')}
            </h2>
            {/* Nickname prominent in modal header */}
            {device.name && (
              <p className="mt-0.5 text-sm font-medium text-teal-700">{device.name}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <FormField label={t('superAdmin.devices.editModal.nameLabel')}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder={t('superAdmin.devices.editModal.namePlaceholder')}
            />
          </FormField>

          <FormField label={t('superAdmin.devices.editModal.orgLabel')}>
            <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className={inputCls}>
              <option value="">{t('superAdmin.devices.editModal.orgUnassigned')}</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </FormField>

          {update.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(update.error as Error)?.message ?? t('common.error')}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={cancelBtnCls}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={update.isPending} className={submitBtnCls}>
              {update.isPending ? t('superAdmin.devices.editModal.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete confirm dialog ─────────────────────────────────────────────────────

function DeleteDeviceDialog({
  device,
  onConfirm,
  onCancel,
  isPending,
}: {
  device: FleetDeviceListItem;
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
                {t('superAdmin.devices.deleteDialog.title')}
              </p>
              {/* Nickname prominent */}
              <p className="text-sm font-medium text-neutral-700">
                {device.name ?? (
                  <span className="italic text-neutral-400">{t('superAdmin.devices.noName')}</span>
                )}
              </p>
              <p className="font-mono text-xs text-neutral-400">{device.deviceUuid}</p>
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
                ? t('superAdmin.devices.deleteDialog.deleting')
                : t('superAdmin.devices.deleteDialog.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Push update modal ─────────────────────────────────────────────────────────

function PushUpdateModal({
  devices,
  orgs,
  releases,
  onClose,
}: {
  devices: FleetDeviceListItem[];
  orgs: Array<{ id: string; name: string }>;
  releases: AppRelease[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [targetKind, setTargetKind] = useState<OtaTargetKind>(OtaTargetKind.all);
  const [targetOrgId, setTargetOrgId] = useState('');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [releaseId, setReleaseId] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [forceNow, setForceNow] = useState(false);
  const createDeployment = useCreateDeployment(apiClient);

  const publishedReleases = releases.filter((r) => r.status === ReleaseStatus.published);

  const toggleDeviceId = (id: string) => {
    setSelectedDeviceIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const scheduledAt = scheduledLocal ? new Date(scheduledLocal).toISOString() : null;

    const data: CreateDeploymentInput = {
      releaseId,
      targetKind,
      forceNow,
      scheduledAt: scheduledAt ?? undefined,
      ...(targetKind === OtaTargetKind.org ? { targetOrgId } : {}),
      ...(targetKind === OtaTargetKind.device_set ? { targetDeviceIds: selectedDeviceIds } : {}),
    };

    createDeployment.mutate(data, { onSuccess: () => onClose() });
  };

  const canSubmit =
    !!releaseId &&
    (targetKind !== OtaTargetKind.org || !!targetOrgId) &&
    (targetKind !== OtaTargetKind.device_set || selectedDeviceIds.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-800">
            {t('superAdmin.devices.pushModal.title')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {/* Release */}
          <FormField label={t('superAdmin.devices.pushModal.releaseLabel')} required>
            <select
              required
              value={releaseId}
              onChange={(e) => setReleaseId(e.target.value)}
              className={inputCls}
            >
              <option value="">{t('superAdmin.devices.pushModal.releasePlaceholder')}</option>
              {publishedReleases.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.version} (v{r.versionCode}){r.mandatory ? ' ★' : ''}
                </option>
              ))}
            </select>
            {publishedReleases.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                {t('superAdmin.devices.pushModal.noPublishedReleases')}
              </p>
            )}
          </FormField>

          {/* Target kind */}
          <FormField label={t('superAdmin.devices.pushModal.targetLabel')} required>
            <div className="flex gap-3">
              {(
                [OtaTargetKind.all, OtaTargetKind.org, OtaTargetKind.device_set] as OtaTargetKind[]
              ).map((kind) => (
                <label
                  key={kind}
                  className={`flex flex-1 cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm transition-colors ${
                    targetKind === kind
                      ? 'border-neutral-800 bg-neutral-900 text-white'
                      : 'border-neutral-200 text-neutral-600 hover:border-neutral-400'
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    value={kind}
                    checked={targetKind === kind}
                    onChange={() => setTargetKind(kind)}
                  />
                  {t(`superAdmin.devices.pushModal.targetKind.${kind}`)}
                </label>
              ))}
            </div>
          </FormField>

          {/* Org picker */}
          {targetKind === OtaTargetKind.org && (
            <FormField label={t('superAdmin.devices.pushModal.orgLabel')} required>
              <select
                required
                value={targetOrgId}
                onChange={(e) => setTargetOrgId(e.target.value)}
                className={inputCls}
              >
                <option value="">{t('superAdmin.devices.pushModal.orgPlaceholder')}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          {/* Device multi-select — nickname-first */}
          {targetKind === OtaTargetKind.device_set && (
            <FormField label={t('superAdmin.devices.pushModal.devicesLabel')} required>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2">
                {devices.map((d) => (
                  <label
                    key={d.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-white"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDeviceIds.includes(d.id)}
                      onChange={() => toggleDeviceId(d.id)}
                      className="accent-neutral-800"
                    />
                    <span className="text-sm text-neutral-700">
                      {d.name ?? (
                        <span className="italic text-neutral-400">{d.deviceUuid.slice(0, 8)}…</span>
                      )}
                      {d.organizationName && (
                        <span className="ml-1 text-xs text-neutral-400">
                          ({d.organizationName})
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-neutral-400">
                {t('superAdmin.devices.pushModal.devicesSelected', {
                  count: String(selectedDeviceIds.length),
                })}
              </p>
            </FormField>
          )}

          {/* Schedule */}
          <FormField label={t('superAdmin.devices.pushModal.scheduleLabel')}>
            <input
              type="datetime-local"
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-xs text-neutral-400">
              {t('superAdmin.devices.pushModal.scheduleHint')}
            </p>
          </FormField>

          {/* Force now toggle */}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <input
              type="checkbox"
              checked={forceNow}
              onChange={(e) => setForceNow(e.target.checked)}
              className="mt-0.5 accent-amber-600"
            />
            <div>
              <p className="text-sm font-medium text-amber-800">
                {t('superAdmin.devices.pushModal.forceNowLabel')}
              </p>
              <p className="text-xs text-amber-600">
                {t('superAdmin.devices.pushModal.forceNowHint')}
              </p>
            </div>
          </label>

          {createDeployment.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(createDeployment.error as Error)?.message ?? t('common.error')}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={cancelBtnCls}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={createDeployment.isPending || !canSubmit}
              className={submitBtnCls}
            >
              <Rocket className="h-4 w-4" />
              {createDeployment.isPending
                ? t('superAdmin.devices.pushModal.deploying')
                : t('superAdmin.devices.pushModal.deploy')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface Org {
  id: string;
  name: string;
}

export default function FleetDevicesPage() {
  const { t } = useI18n();

  const { data: devicesRaw, isLoading, isError, error } = useDevices(apiClient);
  const { data: releasesRaw } = useReleases(apiClient);
  const deleteDevice = useDeleteDevice(apiClient);

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [editTarget, setEditTarget] = useState<FleetDeviceListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FleetDeviceListItem | null>(null);
  const [showPushModal, setShowPushModal] = useState(false);
  const [showTailscaleSettings, setShowTailscaleSettings] = useState(false);

  // Fetch org list once for modals
  useState(() => {
    void apiClient
      .get<Org[] | { data: Org[] }>('/api/v1/organizations')
      .then((res) => {
        const list = Array.isArray(res) ? res : ((res as { data: Org[] }).data ?? []);
        setOrgs(list);
      })
      .catch(() => {
        /* non-critical */
      });
  });

  const devices: FleetDeviceListItem[] = Array.isArray(devicesRaw) ? devicesRaw : [];
  const releases: AppRelease[] = Array.isArray(releasesRaw) ? releasesRaw : [];

  // Group by organizationName (null → "Unassigned" group first)
  const groups = useMemo(() => {
    const unassigned = devices.filter((d) => !d.organizationId);
    const orgMap = new Map<string, { name: string; items: FleetDeviceListItem[] }>();
    for (const d of devices) {
      if (!d.organizationId) continue;
      const key = d.organizationId;
      if (!orgMap.has(key)) {
        orgMap.set(key, { name: d.organizationName ?? key, items: [] });
      }
      orgMap.get(key)!.items.push(d);
    }
    const result: Array<{ key: string; label: string; items: FleetDeviceListItem[] }> = [];
    if (unassigned.length > 0) {
      result.push({
        key: '__unassigned',
        label: t('superAdmin.devices.groupUnassigned'),
        items: unassigned,
      });
    }
    for (const [key, val] of orgMap.entries()) {
      result.push({ key, label: val.name, items: val.items });
    }
    return result;
  }, [devices, t]);

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteDevice.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-800">{t('superAdmin.devices.title')}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">{t('superAdmin.devices.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowTailscaleSettings(true)}
            className="flex items-center gap-2 rounded-lg border border-teal-300 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50"
          >
            <Settings className="h-4 w-4" />
            {t('superAdmin.devices.tailscale.settingsButton')}
          </button>
          <a
            href="/super-admin/devices/releases"
            className="flex items-center gap-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <PackageOpen className="h-4 w-4" />
            {t('superAdmin.devices.releasesLink')}
          </a>
          <button
            type="button"
            onClick={() => setShowPushModal(true)}
            className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            <Rocket className="h-4 w-4" />
            {t('superAdmin.devices.pushButton')}
          </button>
        </div>
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 text-neutral-400">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
          {t('superAdmin.devices.loading')}
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {(error as Error)?.message ?? t('common.error')}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && devices.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
          <Smartphone className="mb-3 h-12 w-12 opacity-20" />
          <p className="text-sm">{t('superAdmin.devices.empty')}</p>
        </div>
      )}

      {/* Grouped table */}
      {!isLoading && !isError && groups.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-100 bg-neutral-50">
              <tr className="text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">{t('superAdmin.devices.col.status')}</th>
                <th className="px-4 py-3">{t('superAdmin.devices.col.name')}</th>
                <th className="px-4 py-3">{t('superAdmin.devices.col.model')}</th>
                <th className="px-4 py-3">{t('superAdmin.devices.col.version')}</th>
                <th className="px-4 py-3">{t('superAdmin.devices.col.otaState')}</th>
                <th className="px-4 py-3">{t('superAdmin.devices.col.tailscale')}</th>
                <th className="px-4 py-3">{t('superAdmin.devices.col.lastSeen')}</th>
                <th className="px-4 py-3 text-right">{t('superAdmin.devices.col.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {groups.map((group) => (
                <>
                  <tr
                    key={`group-${group.key}`}
                    className="border-y border-neutral-200 bg-neutral-50"
                  >
                    <td colSpan={8} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-neutral-400" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                          {group.label}
                        </span>
                        <span className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
                          {group.items.length}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {group.items.map((device) => (
                    <tr
                      key={device.id}
                      className="cursor-pointer hover:bg-neutral-50"
                      onClick={() => {
                        window.location.href = `/super-admin/devices/${device.id}`;
                      }}
                    >
                      {/* App online dot */}
                      <td className="px-4 py-3">
                        <OnlineDot lastSeenAt={device.lastSeenAt} />
                      </td>
                      {/* Nickname-first name cell */}
                      <td className="px-4 py-3">
                        <DeviceNickname device={device} />
                      </td>
                      <td className="px-4 py-3 text-neutral-500">
                        {[device.manufacturer, device.model].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-neutral-600 text-xs">
                        {device.appVersion
                          ? `${device.appVersion} (${device.versionCode ?? '?'})`
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <OtaStateBadge state={device.latestOtaState} />
                      </td>
                      {/* Tailscale cell */}
                      <td className="px-4 py-3">
                        <TailscaleCell device={device} />
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-400">
                        {device.lastSeenAt
                          ? new Date(device.lastSeenAt).toLocaleString('ro-RO', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditTarget(device)}
                            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                            title={t('superAdmin.devices.actions.edit')}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(device)}
                            className="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500"
                            title={t('superAdmin.devices.actions.delete')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {editTarget && (
        <EditDeviceModal device={editTarget} orgs={orgs} onClose={() => setEditTarget(null)} />
      )}
      {deleteTarget && (
        <DeleteDeviceDialog
          device={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          isPending={deleteDevice.isPending}
        />
      )}
      {showPushModal && (
        <PushUpdateModal
          devices={devices}
          orgs={orgs}
          releases={releases}
          onClose={() => setShowPushModal(false)}
        />
      )}
      {showTailscaleSettings && (
        <TailscaleSettingsModal onClose={() => setShowTailscaleSettings(false)} />
      )}
    </div>
  );
}
