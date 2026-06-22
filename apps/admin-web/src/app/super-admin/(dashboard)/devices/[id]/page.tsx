'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Smartphone,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
} from 'lucide-react';
import {
  useDevice,
  useDeviceOtaStatus,
  useDeviceLogs,
  useSetDeviceTailscale,
} from '@strawboss/api';
import type { DeviceOtaStatusWithVersion } from '@strawboss/api';
import { OtaState } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

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

const OTA_STATE_ICONS: Record<OtaState, React.ReactNode> = {
  [OtaState.pending]: <Clock className="h-3.5 w-3.5" />,
  [OtaState.notified]: <Clock className="h-3.5 w-3.5" />,
  [OtaState.downloading]: <Download className="h-3.5 w-3.5" />,
  [OtaState.downloaded]: <Download className="h-3.5 w-3.5" />,
  [OtaState.awaiting_idle]: <Clock className="h-3.5 w-3.5" />,
  [OtaState.installing]: <RefreshCw className="h-3.5 w-3.5 animate-spin" />,
  [OtaState.installed]: <CheckCircle2 className="h-3.5 w-3.5" />,
  [OtaState.failed]: <XCircle className="h-3.5 w-3.5" />,
};

function OtaStateBadge({ state }: { state: OtaState }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${OTA_STATE_STYLES[state]}`}
    >
      {OTA_STATE_ICONS[state]}
      {t(`superAdmin.devices.otaState.${state}`)}
    </span>
  );
}

// ── Log level badge ───────────────────────────────────────────────────────────

const LOG_LEVEL_STYLES: Record<string, string> = {
  error: 'text-red-600',
  warn: 'text-amber-600',
  info: 'text-blue-600',
  flow: 'text-purple-600',
  debug: 'text-neutral-400',
};

function LogLevelTag({ level }: { level: string }) {
  const cls = LOG_LEVEL_STYLES[level.toLowerCase()] ?? 'text-neutral-500';
  return (
    <span className={`font-mono text-xs font-semibold uppercase ${cls}`}>
      [{level.toUpperCase()}]
    </span>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={label}
      className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 active:bg-neutral-100"
    >
      {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
      {copied ? '✓' : label}
    </button>
  );
}

// ── OTA timeline ──────────────────────────────────────────────────────────────

function OtaTimeline({
  entries,
  isLoading,
}: {
  entries: DeviceOtaStatusWithVersion[];
  isLoading: boolean;
}) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-neutral-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
        <Smartphone className="mb-2 h-8 w-8 opacity-20" />
        <p className="text-sm">{t('superAdmin.devices.detail.otaEmpty')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex items-start gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
        >
          {/* State badge */}
          <div className="shrink-0 pt-0.5">
            <OtaStateBadge state={entry.state} />
          </div>

          {/* Version + deployment */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-neutral-800">
                {entry.version}{' '}
                <span className="text-xs text-neutral-400">(v{entry.versionCode})</span>
              </span>
              {entry.attempt > 1 && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                  {t('superAdmin.devices.detail.attempt', { n: String(entry.attempt) })}
                </span>
              )}
            </div>
            <p className="mt-0.5 font-mono text-xs text-neutral-400">{entry.deploymentId}</p>
            {entry.error && (
              <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                <p className="text-xs text-red-700">{entry.error}</p>
              </div>
            )}
          </div>

          {/* Timestamps */}
          <div className="shrink-0 space-y-1 text-right text-xs text-neutral-400">
            {entry.notifiedAt && (
              <p>
                {t('superAdmin.devices.detail.notifiedAt')}:{' '}
                {new Date(entry.notifiedAt).toLocaleString('ro-RO', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </p>
            )}
            {entry.downloadedAt && (
              <p>
                {t('superAdmin.devices.detail.downloadedAt')}:{' '}
                {new Date(entry.downloadedAt).toLocaleString('ro-RO', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </p>
            )}
            {entry.installedAt && (
              <p>
                {t('superAdmin.devices.detail.installedAt')}:{' '}
                {new Date(entry.installedAt).toLocaleString('ro-RO', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </p>
            )}
            <p className="text-neutral-300">
              {t('superAdmin.devices.detail.updatedAt')}:{' '}
              {new Date(entry.updatedAt).toLocaleString('ro-RO', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Log viewer ────────────────────────────────────────────────────────────────

const LOG_LEVELS = ['all', 'error', 'warn', 'info', 'flow', 'debug'] as const;

function LogViewer({ deviceId }: { deviceId: string }) {
  const { t } = useI18n();
  const [level, setLevel] = useState('');
  const [date, setDate] = useState('');

  const { data, isLoading, isError, error, refetch } = useDeviceLogs(apiClient, deviceId, {
    level: level || undefined,
    date: date || undefined,
  });

  const entries = data?.entries ?? [];

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
          {LOG_LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLevel(l === 'all' ? '' : l)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                (l === 'all' && !level) || level === l
                  ? 'bg-white text-neutral-800 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-700 focus:border-neutral-500 focus:outline-none"
        />

        <button
          type="button"
          onClick={() => void refetch()}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('superAdmin.devices.detail.logRefresh')}
        </button>
      </div>

      {/* Log output */}
      {isLoading && (
        <div className="flex items-center justify-center py-10 text-neutral-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          {t('common.loading')}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(error as Error)?.message ?? t('common.error')}
        </div>
      )}

      {!isLoading && !isError && entries.length === 0 && (
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 py-10 text-center text-sm text-neutral-400">
          {t('superAdmin.devices.detail.logEmpty')}
        </div>
      )}

      {!isLoading && !isError && entries.length > 0 && (
        <div className="max-h-[480px] overflow-y-auto rounded-xl border border-neutral-200 bg-neutral-950 p-4 font-mono text-xs leading-relaxed">
          {entries.map((entry, i) => {
            const ts = entry.timestamp ?? entry.recordedAt;
            return (
              <div key={i} className="flex gap-2 py-0.5">
                <span className="shrink-0 text-neutral-500">
                  {ts
                    ? new Date(ts).toLocaleTimeString('ro-RO', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : '--:--:--'}
                </span>
                <LogLevelTag level={entry.level} />
                {entry.context && (
                  <span className="shrink-0 text-neutral-600">[{entry.context}]</span>
                )}
                <span className="text-neutral-200">{entry.message}</span>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && entries.length > 0 && (
        <p className="text-right text-xs text-neutral-400">
          {t('superAdmin.devices.detail.logCount', { count: String(entries.length) })}
        </p>
      )}
    </div>
  );
}

// ── Tailscale panel ───────────────────────────────────────────────────────────

function TailscalePanel({ device }: { device: ReturnType<typeof useDevice>['data'] }) {
  const { t } = useI18n();
  const setTailscale = useSetDeviceTailscale(apiClient);

  if (!device) return null;

  const { tailscaleDesired, tailscaleOnline, tailscaleIp, tailscaleLastSeen, tailscaleLastError } =
    device;

  const tunnelCmd = device.name ? `./strawboss.sh fleet:tunnel "${device.name}"` : null;

  // Tailscale dot color
  let dotCls = 'bg-neutral-300'; // off
  let dotLabel = t('superAdmin.devices.tailscale.offline');
  if (tailscaleDesired && tailscaleOnline) {
    dotCls = 'bg-teal-500';
    dotLabel = t('superAdmin.devices.tailscale.online');
  } else if (tailscaleDesired && !tailscaleOnline) {
    dotCls = 'bg-amber-400';
    dotLabel = t('superAdmin.devices.tailscale.pending');
  }

  const handleToggle = () => {
    setTailscale.mutate({ id: device.id, desired: !tailscaleDesired });
  };

  return (
    <div className="space-y-4">
      {/* Status + toggle row */}
      <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className={`inline-block h-3 w-3 rounded-full ${dotCls}`} title={dotLabel} />
          <div>
            <p className="text-sm font-semibold text-neutral-800">{dotLabel}</p>
            {tailscaleIp && <p className="font-mono text-xs text-neutral-500">{tailscaleIp}</p>}
          </div>
        </div>

        {/* Toggle */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-500">
            {tailscaleDesired
              ? t('superAdmin.devices.tailscale.disable')
              : t('superAdmin.devices.tailscale.enable')}
          </span>
          <button
            type="button"
            onClick={handleToggle}
            disabled={setTailscale.isPending}
            aria-label={
              tailscaleDesired
                ? t('superAdmin.devices.tailscale.disable')
                : t('superAdmin.devices.tailscale.enable')
            }
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1 disabled:opacity-50 ${
              tailscaleDesired ? 'bg-teal-500' : 'bg-neutral-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                tailscaleDesired ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* IP + tunnel command */}
      {tailscaleIp && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">
              {t('superAdmin.devices.tailscale.ip')}
            </p>
            <CopyButton text={tailscaleIp} label={t('superAdmin.devices.tailscale.tunnelCopy')} />
          </div>
          <p className="font-mono text-sm text-neutral-800">{tailscaleIp}</p>
        </div>
      )}

      {/* Tunnel command */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">
            {t('superAdmin.devices.tailscale.tunnelCmd')}
          </p>
          {tunnelCmd && (
            <CopyButton text={tunnelCmd} label={t('superAdmin.devices.tailscale.tunnelCopy')} />
          )}
        </div>
        {tunnelCmd ? (
          <code className="block rounded-lg bg-neutral-950 px-3 py-2 font-mono text-xs text-teal-300">
            {tunnelCmd}
          </code>
        ) : (
          <p className="text-xs text-amber-700">{t('superAdmin.devices.tailscale.tunnelNoName')}</p>
        )}
      </div>

      {/* Why off — last error + last seen */}
      {(tailscaleLastError || tailscaleLastSeen) && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-400">
            {t('superAdmin.devices.tailscale.lastError')}
          </p>
          <div className="space-y-2">
            {tailscaleLastError && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                <p className="text-xs text-red-700">{tailscaleLastError}</p>
              </div>
            )}
            {tailscaleLastSeen && (
              <p className="text-xs text-neutral-500">
                {t('superAdmin.devices.tailscale.lastSeen')}:{' '}
                {new Date(tailscaleLastSeen).toLocaleString('ro-RO', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="w-36 shrink-0 text-xs font-medium text-neutral-400">{label}</span>
      <span className="text-sm text-neutral-800">
        {value ?? <span className="text-neutral-300">—</span>}
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'ota' | 'logs' | 'tailscale';

export default function DeviceDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [activeTab, setActiveTab] = useState<Tab>('ota');

  const { data: device, isLoading, isError, error } = useDevice(apiClient, id);
  const { data: otaEntries = [], isLoading: otaLoading } = useDeviceOtaStatus(apiClient, id);

  const online =
    device?.lastSeenAt != null && Date.now() - new Date(device.lastSeenAt).getTime() < 90_000;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-400">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  if (isError || !device) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
        {(error as Error)?.message ?? t('common.error')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <a
          href="/super-admin/devices"
          className="inline-flex items-center gap-1 hover:text-neutral-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('superAdmin.devices.navLabel')}
        </a>
        <span className="text-neutral-300">/</span>
        {/* Nickname-first in breadcrumb */}
        <span className="font-semibold text-neutral-800">
          {device.name ?? (
            <span className="italic text-neutral-400">{t('superAdmin.devices.noName')}</span>
          )}
        </span>
      </div>

      {/* Identity card */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-neutral-100 p-3">
            <Smartphone className="h-7 w-7 text-neutral-500" />
          </div>
          <div className="flex-1">
            {/* Nickname — primary, large */}
            <h1 className="text-xl font-bold text-neutral-900">
              {device.name ?? (
                <span className="italic text-neutral-400">{t('superAdmin.devices.noName')}</span>
              )}
            </h1>
            {/* Org name — secondary */}
            <p className="mt-0.5 text-sm text-neutral-500">
              {/* organizationId is on Device but organizationName is on FleetDeviceListItem;
                  useDevice returns Device which doesn't have organizationName. Fall back
                  to showing deviceUuid as the secondary line. */}
              <span className="font-mono text-xs text-neutral-400">{device.deviceUuid}</span>
            </p>

            {/* App online + Tailscale status row */}
            <div className="mt-2 flex flex-wrap items-center gap-4">
              {/* App online */}
              <div className="flex items-center gap-1.5">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-neutral-300'}`}
                  title={online ? t('superAdmin.devices.online') : t('superAdmin.devices.offline')}
                />
                <span className={`text-xs ${online ? 'text-green-700' : 'text-neutral-400'}`}>
                  {online ? t('superAdmin.devices.online') : t('superAdmin.devices.offline')}
                </span>
              </div>

              {/* Tailscale status */}
              <div className="flex items-center gap-1.5">
                {device.tailscaleDesired && device.tailscaleOnline ? (
                  <>
                    <span
                      className="inline-block h-2 w-2 rounded-full bg-teal-500"
                      title={t('superAdmin.devices.tailscale.online')}
                    />
                    <span className="text-xs text-teal-700">
                      {t('superAdmin.devices.tailscale.online')}
                      {device.tailscaleIp && (
                        <span className="ml-1 font-mono text-neutral-400">
                          ({device.tailscaleIp})
                        </span>
                      )}
                    </span>
                  </>
                ) : device.tailscaleDesired ? (
                  <>
                    <span
                      className="inline-block h-2 w-2 rounded-full bg-amber-400"
                      title={t('superAdmin.devices.tailscale.pending')}
                    />
                    <span className="text-xs text-amber-700">
                      {t('superAdmin.devices.tailscale.pending')}
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className="inline-block h-2 w-2 rounded-full bg-neutral-300"
                      title={t('superAdmin.devices.tailscale.offline')}
                    />
                    <span className="text-xs text-neutral-400">
                      Tailscale {t('superAdmin.devices.tailscale.offline').toLowerCase()}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-neutral-800">{device.appVersion ?? '—'}</p>
            <p className="text-xs text-neutral-400">
              {device.versionCode != null ? `v${device.versionCode}` : ''}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 divide-y divide-neutral-100 rounded-lg border border-neutral-100 bg-neutral-50 px-4 sm:grid-cols-2 sm:divide-y-0 sm:divide-x">
          <div className="py-2 sm:pr-4">
            <InfoRow
              label={t('superAdmin.devices.detail.manufacturer')}
              value={[device.manufacturer, device.model].filter(Boolean).join(' ') || null}
            />
            <InfoRow label={t('superAdmin.devices.detail.osVersion')} value={device.osVersion} />
            <InfoRow
              label={t('superAdmin.devices.detail.androidId')}
              value={<span className="font-mono text-xs">{device.androidId}</span>}
            />
          </div>
          <div className="py-2 sm:pl-4">
            <InfoRow
              label={t('superAdmin.devices.detail.isDeviceOwner')}
              value={
                device.isDeviceOwner ? (
                  <span className="flex items-center gap-1 text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t('common.yes')}
                  </span>
                ) : (
                  t('common.no')
                )
              }
            />
            <InfoRow
              label={t('superAdmin.devices.detail.lastSeen')}
              value={
                device.lastSeenAt
                  ? new Date(device.lastSeenAt).toLocaleString('ro-RO', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : null
              }
            />
            <InfoRow
              label={t('superAdmin.devices.detail.lastCheckin')}
              value={
                device.lastCheckinAt
                  ? new Date(device.lastCheckinAt).toLocaleString('ro-RO', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : null
              }
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1">
        {(['ota', 'logs', 'tailscale'] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t(`superAdmin.devices.detail.tab.${tab}`)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'ota' && <OtaTimeline entries={otaEntries} isLoading={otaLoading} />}
      {activeTab === 'logs' && <LogViewer deviceId={id} />}
      {activeTab === 'tailscale' && <TailscalePanel device={device} />}
    </div>
  );
}
