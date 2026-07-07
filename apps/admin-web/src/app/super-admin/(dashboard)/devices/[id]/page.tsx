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
  Power,
  FileDown,
  PackageOpen,
  Network,
  Radio,
  MessageSquare,
} from 'lucide-react';
import {
  useDevice,
  useDeviceUptime,
  useDeviceOtaStatus,
  useDeviceLogs,
  useSetDeviceTailscale,
  useSetDeviceSmsGateway,
  useSendGatewayTestSms,
  useSendDeviceCommand,
  useDeviceCommands,
  useReapplyTailscale,
  useReleases,
} from '@strawboss/api';
import type { DeviceOtaStatusWithVersion } from '@strawboss/api';
import { OtaState, ReleaseStatus } from '@strawboss/types';
import type {
  RemoteCommandStatus,
  RemoteCommandType,
  DeviceRemoteCommandRecord,
  DeviceHealthReport,
  DeviceUptimeResponse,
} from '@strawboss/types';
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
              <div key={`${ts ?? ''}-${i}`} className="flex gap-2 py-0.5">
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

  // Use the backend-sanitized hostname ([a-z0-9-] only) — NOT the free-form name — so the
  // copy-paste command can never carry shell metacharacters (no quoting/injection possible).
  const tunnelCmd = device.tailscaleHostname
    ? `./strawboss.sh fleet:tunnel ${device.tailscaleHostname}`
    : null;

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

// ── Remote panel ──────────────────────────────────────────────────────────────

const CMD_STATUS_STYLES: Record<RemoteCommandStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  sent: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const CMD_STATUS_ICONS: Record<RemoteCommandStatus, React.ReactNode> = {
  pending: <Clock className="h-3 w-3" />,
  sent: <Radio className="h-3 w-3" />,
  completed: <CheckCircle2 className="h-3 w-3" />,
  failed: <XCircle className="h-3 w-3" />,
};

function CommandStatusBadge({ status }: { status: RemoteCommandStatus }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${CMD_STATUS_STYLES[status]}`}
    >
      {CMD_STATUS_ICONS[status]}
      {t(`superAdmin.devices.remote.status${status.charAt(0).toUpperCase()}${status.slice(1)}`)}
    </span>
  );
}

function CommandHistoryTable({
  records,
  isLoading,
}: {
  records: DeviceRemoteCommandRecord[];
  isLoading: boolean;
}) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('superAdmin.devices.remote.historyLoading')}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-neutral-400">
        {t('superAdmin.devices.remote.historyEmpty')}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-medium text-neutral-500">
            <th className="px-4 py-2.5">{t('superAdmin.devices.remote.historyColType')}</th>
            <th className="px-4 py-2.5">{t('superAdmin.devices.remote.historyColStatus')}</th>
            <th className="px-4 py-2.5">{t('superAdmin.devices.remote.historyColSent')}</th>
            <th className="px-4 py-2.5">{t('superAdmin.devices.remote.historyColCompleted')}</th>
            <th className="px-4 py-2.5">{t('superAdmin.devices.remote.historyColError')}</th>
            <th className="px-4 py-2.5">Rezultat</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 bg-white">
          {records.map((rec) => (
            <tr key={rec.id} className="hover:bg-neutral-50">
              <td className="px-4 py-2.5">
                <span className="font-medium text-neutral-800">
                  {t(`superAdmin.devices.remote.commandType.${rec.type}`)}
                </span>
                {rec.params && rec.type === 'reinstall_apk' && !!rec.params.releaseId && (
                  <p className="mt-0.5 font-mono text-xs text-neutral-400">
                    {String(rec.params.releaseId).slice(0, 8)}…
                  </p>
                )}
              </td>
              <td className="px-4 py-2.5">
                <CommandStatusBadge status={rec.status} />
              </td>
              <td className="px-4 py-2.5 text-xs text-neutral-500">
                {rec.sentAt
                  ? new Date(rec.sentAt).toLocaleString('ro-RO', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })
                  : '—'}
              </td>
              <td className="px-4 py-2.5 text-xs text-neutral-500">
                {rec.completedAt
                  ? new Date(rec.completedAt).toLocaleString('ro-RO', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })
                  : '—'}
              </td>
              <td className="px-4 py-2.5">
                {rec.lastError ? (
                  <span className="text-xs text-red-600" title={rec.lastError}>
                    {rec.lastError.length > 60 ? `${rec.lastError.slice(0, 60)}…` : rec.lastError}
                  </span>
                ) : (
                  <span className="text-neutral-300">—</span>
                )}
              </td>
              <td className="px-4 py-2.5">
                {rec.result && Object.keys(rec.result).length > 0 ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-neutral-500 hover:text-neutral-800">
                      {Array.isArray((rec.result as Record<string, unknown>).lines)
                        ? `${((rec.result as Record<string, unknown>).lines as unknown[]).length} linii`
                        : 'JSON'}
                    </summary>
                    <pre className="mt-1 max-h-64 max-w-md overflow-auto rounded bg-neutral-900 p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap text-neutral-100">
                      {Array.isArray((rec.result as Record<string, unknown>).lines)
                        ? ((rec.result as Record<string, unknown>).lines as unknown[]).join('\n')
                        : JSON.stringify(rec.result, null, 2)}
                    </pre>
                  </details>
                ) : (
                  <span className="text-neutral-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Simple inline toast shown briefly after queuing a command. */
function InlineToast({
  message,
  kind,
  onDismiss,
}: {
  message: string;
  kind: 'success' | 'error';
  onDismiss: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm ${
        kind === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
      }`}
    >
      {kind === 'success' ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-red-600" />
      )}
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs opacity-60 hover:opacity-100"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

/** Inline confirm dialog (no modal dependency). */
function ConfirmInline({
  title,
  body,
  onConfirm,
  onCancel,
  isPending,
}: {
  title: string;
  body: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <p className="font-medium text-amber-900">{title}</p>
      <p className="mt-1 text-sm text-amber-700">{body}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('superAdmin.devices.remote.confirm')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-lg border border-neutral-200 px-4 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
        >
          {t('superAdmin.devices.remote.cancel')}
        </button>
      </div>
    </div>
  );
}

// ── Device health panel (rich report_state self-diagnostic) ─────────────────────

type HealthTone = 'ok' | 'warn' | 'bad' | 'idle';

function HealthDot({ tone }: { tone: HealthTone }) {
  const c =
    tone === 'ok'
      ? 'bg-green-500'
      : tone === 'warn'
        ? 'bg-amber-500'
        : tone === 'bad'
          ? 'bg-red-500'
          : 'bg-neutral-300';
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} />;
}

function HRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: HealthTone;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex items-center gap-2 text-xs text-neutral-500">
        {tone && <HealthDot tone={tone} />}
        {label}
      </span>
      <span className="text-right font-mono text-xs text-neutral-800">
        {value ?? <span className="text-neutral-300">—</span>}
      </span>
    </div>
  );
}

function HSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        {title}
      </p>
      <div className="divide-y divide-neutral-100">{children}</div>
    </div>
  );
}

function ageMin(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? ms / 60_000 : null;
}
function rel(iso: string | null): string {
  const m = ageMin(iso);
  if (m == null) return '—';
  if (m < 1) return '<1m ago';
  if (m < 60) return `${Math.floor(m)}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}
function freshness(iso: string | null, warnMin: number, badMin: number): HealthTone {
  const m = ageMin(iso);
  if (m == null) return 'bad';
  if (m > badMin) return 'bad';
  if (m > warnMin) return 'warn';
  return 'ok';
}
const yn = (b: boolean | null): string => (b == null ? '—' : b ? 'yes' : 'no');
const boolTone = (b: boolean | null, good = true): HealthTone =>
  b == null ? 'idle' : b === good ? 'ok' : 'bad';

/** RunningAppProcessInfo.importance → label (lower = more important; >230 ⇒ demoted). */
function importanceLabel(n: number | null): string {
  if (n == null) return '—';
  const m: Record<number, string> = {
    100: 'foreground',
    125: 'foreground_service',
    200: 'visible',
    230: 'perceptible',
    300: 'service',
    400: 'cached',
  };
  return m[n] ?? `imp ${n}`;
}

/** ms → compact duration (e.g. 92m, 3h7m). */
function durMs(ms: number | null): string {
  if (ms == null) return '—';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h${min % 60}m`;
}

function DeviceHealthPanel({
  state,
  stateAt,
}: {
  state: DeviceHealthReport | null;
  stateAt: string | null;
}) {
  if (!state) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Device health
        </h3>
        <p className="text-sm text-neutral-400">
          No snapshot yet — press “Refresh state”. The device reports on its next check-in.
        </p>
      </div>
    );
  }
  const s = state;
  // `state` comes from untyped JSONB (devices.last_state). Devices that last
  // reported under the OLD thin DeviceState shape have no `gatherErrors` key,
  // so guard it — reading `.length` on undefined would crash the whole page.
  const gatherErrors = Array.isArray(s.gatherErrors) ? s.gatherErrors : [];
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Device health
        </h3>
        <span className="text-xs text-neutral-400">
          {stateAt ? `reported ${rel(stateAt)}` : ''}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <HSection title="Session & policy">
          <HRow
            label="Logged in"
            value={`${yn(s.isAuthenticated)}${s.role ? ` (${s.role})` : ''}`}
            tone={boolTone(s.isAuthenticated)}
          />
          <HRow
            label="Session expires"
            value={s.sessionExpiresAt ? rel(s.sessionExpiresAt) : '—'}
          />
          <HRow label="Device owner" value={yn(s.isDeviceOwner)} tone={boolTone(s.isDeviceOwner)} />
          <HRow
            label="Battery-opt ignored"
            value={yn(s.batteryOptIgnored)}
            tone={boolTone(s.batteryOptIgnored)}
          />
          <HRow label="Standby bucket" value={s.standbyBucketLabel ?? '—'} />
        </HSection>

        <HSection title="Presence (keep-alive)">
          <HRow
            label="Presence service"
            value={yn(s.presenceServiceRunning)}
            tone={boolTone(s.presenceServiceRunning)}
          />
          <HRow
            label="Alarm scheduled"
            value={yn(s.presenceAlarmScheduled)}
            tone={boolTone(s.presenceAlarmScheduled)}
          />
          <HRow
            label="Alarm last fired"
            value={rel(s.presenceAlarmLastFireAt)}
            tone={freshness(s.presenceAlarmLastFireAt, 2, 4)}
          />
          <HRow
            label="Alarm next fire"
            value={s.presenceAlarmNextFireAt ? rel(s.presenceAlarmNextFireAt) : '—'}
          />
          <HRow label="BG tracking" value={yn(s.backgroundTrackingActive)} />
        </HSection>

        <HSection title="Check-in & sync">
          <HRow
            label="Last check-in"
            value={rel(s.lastCheckinAt)}
            tone={freshness(s.lastCheckinAt, 2, 5)}
          />
          <HRow
            label="Last heartbeat"
            value={rel(s.lastHeartbeatAt)}
            tone={freshness(s.lastHeartbeatAt, 2, 5)}
          />
          <HRow label="Last sync" value={rel(s.lastSyncAt)} tone={freshness(s.lastSyncAt, 5, 30)} />
          <HRow
            label="Sync error"
            value={s.lastSyncError ?? 'none'}
            tone={s.lastSyncError ? 'warn' : 'ok'}
          />
          <HRow
            label="Sync queue"
            value={s.syncQueueDepth ?? '—'}
            tone={s.syncQueueDepth != null && s.syncQueueDepth > 50 ? 'warn' : undefined}
          />
          <HRow
            label="Pending GPS reports"
            value={s.pendingLocationReports ?? '—'}
            tone={
              s.pendingLocationReports != null && s.pendingLocationReports > 100
                ? 'warn'
                : undefined
            }
          />
        </HSection>

        <HSection title="Location">
          <HRow
            label="Assigned machine"
            value={s.assignedMachineId ? `${s.assignedMachineId.slice(0, 8)}…` : 'none'}
          />
          <HRow label="Last GPS report" value={rel(s.lastLocationReportAt)} />
          <HRow
            label="FG / BG perm"
            value={`${s.fgLocationPermission ?? '—'} / ${s.bgLocationPermission ?? '—'}`}
          />
          <HRow
            label="Speed / profile"
            value={`${s.lastSpeedKmh != null ? `${Math.round(s.lastSpeedKmh)}km/h` : '—'} / ${
              s.lastProfile ?? '—'
            }`}
          />
        </HSection>

        <HSection title="Tailscale">
          <HRow
            label="Installed"
            value={yn(s.tailscaleInstalled)}
            tone={boolTone(s.tailscaleInstalled)}
          />
          <HRow label="Applied state" value={s.tailscaleAppliedState ?? '—'} />
          <HRow
            label="Hidden (bug if yes)"
            value={yn(s.tailscaleHidden)}
            tone={boolTone(s.tailscaleHidden, false)}
          />
          <HRow
            label="Always-on VPN"
            value={s.alwaysOnVpnPackage ? 'set' : 'none'}
            tone={s.alwaysOnVpnPackage ? 'ok' : 'idle'}
          />
        </HSection>

        <HSection title="OTA & system">
          <HRow
            label="App version"
            value={s.appVersion ? `${s.appVersion} (${s.versionCode ?? '?'})` : '—'}
          />
          <HRow
            label="OTA mirror"
            value={
              s.otaMirrorState
                ? `${s.otaMirrorState}${s.otaMirrorAttempt ? ` (try ${s.otaMirrorAttempt})` : ''}`
                : 'idle'
            }
            tone={s.otaMirrorState === 'failed' ? 'bad' : undefined}
          />
          <HRow
            label="Online / net"
            value={`${yn(s.online)} / ${s.networkType ?? '—'}`}
            tone={boolTone(s.online)}
          />
          <HRow
            label="Battery"
            value={`${s.batteryPct != null ? `${s.batteryPct}%` : '—'}${s.isCharging ? ' ⚡' : ''}`}
            tone={s.batteryPct != null && s.batteryPct < 15 && !s.isCharging ? 'warn' : undefined}
          />
          <HRow
            label="Free storage"
            value={s.freeStorageBytes != null ? `${Math.round(s.freeStorageBytes / 1e6)} MB` : '—'}
          />
          <HRow label="Push token" value={yn(s.pushTokenPresent)} />
        </HSection>

        <HSection title="Power & process">
          <HRow
            label="Power-save mode"
            value={yn(s.powerSaveMode)}
            tone={boolTone(s.powerSaveMode, false)}
          />
          <HRow label="Doze (idle) now" value={yn(s.deviceIdleMode)} />
          <HRow
            label="Exact alarms allowed"
            value={yn(s.canScheduleExactAlarms)}
            tone={boolTone(s.canScheduleExactAlarms)}
          />
          <HRow
            label="Process importance"
            value={importanceLabel(s.processImportance)}
            tone={s.processImportance != null && s.processImportance > 230 ? 'warn' : undefined}
          />
          <HRow
            label="FG services alive"
            value={
              Array.isArray(s.runningForegroundServices)
                ? String(s.runningForegroundServices.length)
                : '—'
            }
          />
          <HRow
            label="Uptime (sys / app)"
            value={`${durMs(s.systemUptimeMs)} / ${durMs(s.appUptimeMs)}`}
          />
        </HSection>

        {Array.isArray(s.oemPowerPackages) && s.oemPowerPackages.length > 0 && (
          <HSection title="OEM power packages">
            {s.oemPowerPackages.map((p) => (
              <HRow
                key={p.pkg}
                label={p.pkg.replace(/^com\./, '')}
                value={
                  p.hidden
                    ? 'hidden'
                    : p.suspended
                      ? 'suspended'
                      : p.enabled === false
                        ? 'disabled'
                        : 'ACTIVE'
                }
                tone={p.hidden || p.suspended || p.enabled === false ? 'ok' : 'bad'}
              />
            ))}
          </HSection>
        )}

        {Array.isArray(s.recentExitReasons) && s.recentExitReasons.length > 0 && (
          <HSection title="Recent process deaths">
            {s.recentExitReasons.map((r, i) => (
              <HRow
                key={i}
                label={r.timestamp ? rel(r.timestamp) : `#${i}`}
                value={r.reasonLabel}
                tone={
                  r.reasonLabel === 'user_requested' ||
                  r.reasonLabel === 'other' ||
                  r.reasonLabel === 'freezer'
                    ? 'bad'
                    : r.reasonLabel === 'crash' || r.reasonLabel === 'anr'
                      ? 'warn'
                      : undefined
                }
              />
            ))}
          </HSection>
        )}
      </div>

      {gatherErrors.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
            Probe errors ({gatherErrors.length})
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-xs text-amber-800">
            {gatherErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-600">
          Raw JSON
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-neutral-900 p-3 text-[11px] leading-relaxed text-neutral-100">
          {JSON.stringify(s, null, 2)}
        </pre>
      </details>
    </div>
  );
}

type ConfirmKind = 'reboot' | 'reinstall' | null;

/** Toggle a device as the SMS gateway + fire a one-off test SMS through it. */
function SmsGatewayPanel({
  device,
}: {
  device: NonNullable<ReturnType<typeof useDevice>['data']>;
}) {
  const { t } = useI18n();
  const setGateway = useSetDeviceSmsGateway(apiClient);
  const sendTest = useSendGatewayTestSms(apiClient);
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);

  const isGateway = !!device.isSmsGateway;

  const showToast = (message: string, kind: 'success' | 'error') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 5000);
  };

  const toggle = () =>
    setGateway.mutate(
      { id: device.id, enabled: !isGateway },
      { onError: () => showToast(t('superAdmin.devices.smsGateway.toggleFailed'), 'error') },
    );

  const handleSendTest = () => {
    const to = phone.trim();
    if (!/^\+?[0-9]{8,15}$/.test(to)) {
      showToast(t('superAdmin.devices.smsGateway.invalidPhone'), 'error');
      return;
    }
    sendTest.mutate(
      { id: device.id, to, body: message.trim() || undefined },
      {
        onSuccess: () => {
          showToast(t('superAdmin.devices.smsGateway.sendQueued'), 'success');
          setMessage('');
        },
        onError: () => showToast(t('superAdmin.devices.smsGateway.sendFailed'), 'error'),
      },
    );
  };

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      {toast && (
        <InlineToast message={toast.message} kind={toast.kind} onDismiss={() => setToast(null)} />
      )}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          <MessageSquare className="h-4 w-4" /> {t('superAdmin.devices.smsGateway.title')}
        </h3>
        <button
          type="button"
          onClick={toggle}
          disabled={setGateway.isPending}
          aria-pressed={isGateway}
          aria-label={t('superAdmin.devices.smsGateway.toggleAriaLabel')}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 ${
            isGateway ? 'bg-emerald-500' : 'bg-neutral-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
              isGateway ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      <p className="mb-4 text-sm text-neutral-500">
        {isGateway
          ? t('superAdmin.devices.smsGateway.descriptionOn')
          : t('superAdmin.devices.smsGateway.descriptionOff')}
      </p>
      {isGateway && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t('superAdmin.devices.smsGateway.phonePlaceholder')}
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSendTest}
              disabled={sendTest.isPending || !phone.trim()}
              className="flex items-center gap-2 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              <MessageSquare className="h-4 w-4" />
              {t('superAdmin.devices.smsGateway.sendTest')}
            </button>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder={t('superAdmin.devices.smsGateway.messagePlaceholder')}
            className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}

function RemotePanel({ device }: { device: ReturnType<typeof useDevice>['data'] }) {
  const { t } = useI18n();

  const sendCommand = useSendDeviceCommand(apiClient);
  const reapplyTs = useReapplyTailscale(apiClient);
  const { data: commands = [], isLoading: cmdLoading } = useDeviceCommands(
    apiClient,
    device?.id ?? '',
  );
  const { data: releases = [] } = useReleases(apiClient);

  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const [selectedReleaseId, setSelectedReleaseId] = useState('');
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);

  if (!device) return null;

  const publishedReleases = releases.filter((r) => r.status === ReleaseStatus.published);

  const showToast = (message: string, kind: 'success' | 'error') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 5000);
  };

  const queueCommand = (type: RemoteCommandType, params?: Record<string, unknown>) => {
    sendCommand.mutate(
      { id: device.id, command: { type, params } },
      {
        onSuccess: () => showToast(t('superAdmin.devices.remote.queued'), 'success'),
        onError: () => showToast(t('superAdmin.devices.remote.queueFailed'), 'error'),
      },
    );
  };

  const handleReboot = () => setConfirmKind('reboot');
  const handleRebootConfirm = () => {
    queueCommand('reboot');
    setConfirmKind(null);
  };

  const handleFetchLogs = () => queueCommand('fetch_logs');

  const handleReinstallApk = () => {
    if (!selectedReleaseId) return;
    setConfirmKind('reinstall');
  };
  const handleReinstallConfirm = () => {
    queueCommand('reinstall_apk', { releaseId: selectedReleaseId });
    setConfirmKind(null);
  };

  const handleReapplyTailscale = () => {
    reapplyTs.mutate(device.id, {
      onSuccess: () => showToast(t('superAdmin.devices.remote.queued'), 'success'),
      onError: () => showToast(t('superAdmin.devices.remote.queueFailed'), 'error'),
    });
  };

  const handleRefreshState = () => queueCommand('report_state');

  const isBusy = sendCommand.isPending || reapplyTs.isPending;

  const { lastState, lastStateAt } = device;

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <InlineToast message={toast.message} kind={toast.kind} onDismiss={() => setToast(null)} />
      )}

      {/* Confirm dialogs */}
      {confirmKind === 'reboot' && (
        <ConfirmInline
          title={t('superAdmin.devices.remote.rebootConfirmTitle')}
          body={t('superAdmin.devices.remote.rebootConfirmBody')}
          onConfirm={handleRebootConfirm}
          onCancel={() => setConfirmKind(null)}
          isPending={isBusy}
        />
      )}
      {confirmKind === 'reinstall' && (
        <ConfirmInline
          title={t('superAdmin.devices.remote.reinstallConfirmTitle')}
          body={t('superAdmin.devices.remote.reinstallConfirmBody')}
          onConfirm={handleReinstallConfirm}
          onCancel={() => setConfirmKind(null)}
          isPending={isBusy}
        />
      )}

      {/* ── SMS gateway toggle + test send ── */}
      <SmsGatewayPanel device={device} />

      {/* ── Actions ── */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          {t('superAdmin.devices.remote.actionsTitle')}
        </h3>
        <div className="flex flex-wrap gap-3">
          {/* Reboot */}
          <button
            type="button"
            onClick={handleReboot}
            disabled={isBusy}
            className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            <Power className="h-4 w-4" />
            {t('superAdmin.devices.remote.reboot')}
          </button>

          {/* Fetch logs */}
          <button
            type="button"
            onClick={handleFetchLogs}
            disabled={isBusy}
            className="flex items-center gap-2 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            <FileDown className="h-4 w-4" />
            {t('superAdmin.devices.remote.fetchLogs')}
          </button>

          {/* Reinstall APK */}
          <div className="flex items-center gap-2">
            <select
              value={selectedReleaseId}
              onChange={(e) => setSelectedReleaseId(e.target.value)}
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none"
              aria-label={t('superAdmin.devices.remote.releaseLabel')}
            >
              <option value="">{t('superAdmin.devices.remote.selectRelease')}</option>
              {publishedReleases.length === 0 ? (
                <option disabled value="">
                  {t('superAdmin.devices.remote.noPublishedReleases')}
                </option>
              ) : (
                publishedReleases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.version} (v{r.versionCode})
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={handleReinstallApk}
              disabled={isBusy || !selectedReleaseId}
              className="flex items-center gap-2 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              <PackageOpen className="h-4 w-4" />
              {t('superAdmin.devices.remote.reinstallApk')}
            </button>
          </div>

          {/* Re-apply Tailscale */}
          <button
            type="button"
            onClick={handleReapplyTailscale}
            disabled={isBusy}
            className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100 disabled:opacity-50"
          >
            <Network className="h-4 w-4" />
            {t('superAdmin.devices.remote.reapplyTailscale')}
          </button>

          {/* Refresh state */}
          <button
            type="button"
            onClick={handleRefreshState}
            disabled={isBusy}
            className="flex items-center gap-2 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isBusy ? 'animate-spin' : ''}`} />
            {t('superAdmin.devices.remote.refreshState')}
          </button>
        </div>
      </div>

      {/* ── Device health snapshot ── */}
      <DeviceHealthPanel state={lastState} stateAt={lastStateAt} />

      {/* ── Command history ── */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          {t('superAdmin.devices.remote.historyTitle')}
        </h3>
        <CommandHistoryTable records={commands} isLoading={cmdLoading} />
      </div>
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

// ── Uptime (online vs offline) ──────────────────────────────────────────────

function fmtUptimeDur(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

function UptimeChart({ data }: { data: DeviceUptimeResponse }) {
  const fromMs = new Date(data.from).getTime();
  const toMs = new Date(data.to).getTime();
  const span = Math.max(1, toMs - fromMs);

  // Local-midnight day boundaries inside the window.
  const ticks: { left: number; label: string }[] = [];
  const cur = new Date(fromMs);
  cur.setHours(24, 0, 0, 0);
  while (cur.getTime() < toMs) {
    ticks.push({
      left: ((cur.getTime() - fromMs) / span) * 100,
      label: cur.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    });
    cur.setDate(cur.getDate() + 1);
  }

  const pctColor =
    data.onlinePct >= 95
      ? 'text-emerald-600'
      : data.onlinePct >= 80
        ? 'text-amber-600'
        : 'text-red-600';

  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <span className={`text-3xl font-bold tabular-nums ${pctColor}`}>{data.onlinePct}%</span>
        <span className="text-sm text-neutral-500">
          online · {fmtUptimeDur(data.onlineSeconds)} up / {fmtUptimeDur(data.offlineSeconds)} down
          <span className="text-neutral-400"> (last {data.days}d)</span>
        </span>
      </div>

      <div className="relative h-8 w-full overflow-hidden rounded-md bg-neutral-200">
        {data.intervals.map((iv, i) => {
          const s = new Date(iv.start).getTime();
          const e = new Date(iv.end).getTime();
          return (
            <div
              key={i}
              className="absolute top-0 h-full bg-emerald-500"
              style={{
                left: `${((s - fromMs) / span) * 100}%`,
                width: `${Math.max(((e - s) / span) * 100, 0.15)}%`,
              }}
              title={`${new Date(iv.start).toLocaleString()} → ${new Date(iv.end).toLocaleString()}`}
            />
          );
        })}
        {ticks.map((tk, i) => (
          <div
            key={`tick-${i}`}
            className="absolute top-0 h-full w-px bg-white/70"
            style={{ left: `${tk.left}%` }}
          />
        ))}
      </div>

      <div className="relative mt-1 h-4 w-full text-[10px] text-neutral-400">
        <span className="absolute left-0">
          {new Date(fromMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
        {ticks.map((tk, i) => (
          <span
            key={`lbl-${i}`}
            className="absolute -translate-x-1/2"
            style={{ left: `${tk.left}%` }}
          >
            {tk.label}
          </span>
        ))}
        <span className="absolute right-0">now</span>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-neutral-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Online
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-neutral-200" /> Offline
        </span>
      </div>
    </div>
  );
}

function UptimePanel({ deviceId }: { deviceId: string }) {
  const [days, setDays] = useState(3);
  const { data, isLoading } = useDeviceUptime(apiClient, deviceId, { days });

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Online vs offline
        </h3>
        <div className="flex gap-0.5 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
          {[1, 3, 7, 14].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                days === d
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-neutral-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      {data && !data.hasOperator && (
        <p className="py-8 text-center text-sm text-neutral-400">
          No operator bound to this device yet — no session history to chart. Uptime appears once an
          operator logs in.
        </p>
      )}
      {data && data.hasOperator && <UptimeChart data={data} />}
    </div>
  );
}

type Tab = 'ota' | 'logs' | 'tailscale' | 'remote' | 'uptime';

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
        {(['ota', 'logs', 'tailscale', 'remote', 'uptime'] as Tab[]).map((tab) => (
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
      {activeTab === 'remote' && <RemotePanel device={device} />}
      {activeTab === 'uptime' && <UptimePanel deviceId={id} />}
    </div>
  );
}
