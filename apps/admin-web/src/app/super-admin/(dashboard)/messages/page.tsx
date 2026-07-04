'use client';
export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import {
  Mail,
  MessageSquare,
  RefreshCw,
  Loader2,
  FileDown,
  Send,
  ExternalLink,
  Smartphone,
} from 'lucide-react';
import {
  useSuperAdminMessages,
  useRetrySuperAdminMessage,
  useDevices,
  useSendGatewayTestSms,
  useSendDeviceCommand,
  type SuperAdminMessageFilters,
} from '@strawboss/api';
import type { OutboundMessageRecord, FleetDeviceListItem } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { cn } from '@/lib/utils';

const STATUS_CLS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  sent: 'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const selectCls =
  'rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const PHONE_RE = /^\+?[0-9]{8,15}$/;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function isOnline(lastSeenAt: string | null): boolean {
  return !!lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 90_000;
}

/** One gateway-phone card: online status, health link, inline test-SMS + remote-debug. */
function GatewayCard({ device }: { device: FleetDeviceListItem }) {
  const { t } = useI18n();
  const sendTest = useSendGatewayTestSms(apiClient);
  const sendCommand = useSendDeviceCommand(apiClient);
  const [to, setTo] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const online = isOnline(device.lastSeenAt);
  const label = device.name || device.model || device.deviceUuid.slice(0, 8);

  const submitTest = () => {
    const trimmed = to.trim();
    if (!PHONE_RE.test(trimmed)) {
      setFeedback({ ok: false, msg: t('superAdmin.messages.testSmsInvalid') });
      return;
    }
    sendTest.mutate(
      { id: device.id, to: trimmed },
      {
        onSuccess: () => {
          setFeedback({ ok: true, msg: t('superAdmin.messages.testSmsQueued') });
          setTo('');
        },
        onError: (e: unknown) => setFeedback({ ok: false, msg: (e as Error).message }),
      },
    );
  };

  const queueCommand = (type: 'report_state' | 'fetch_logs') =>
    sendCommand.mutate(
      { id: device.id, command: { type } },
      { onSuccess: () => setFeedback({ ok: true, msg: t('superAdmin.messages.commandQueued') }) },
    );

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn('h-2.5 w-2.5 rounded-full', online ? 'bg-green-500' : 'bg-neutral-300')}
            title={online ? t('superAdmin.messages.online') : t('superAdmin.messages.offline')}
          />
          <Smartphone className="h-4 w-4 text-neutral-400" />
          <span className="font-medium text-neutral-800">{label}</span>
        </div>
        <a
          href={`/super-admin/devices/${device.id}`}
          className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-primary"
        >
          {t('superAdmin.messages.openDevice')}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span>{device.manufacturer ?? device.model ?? '—'}</span>
        <span>v{device.appVersion ?? '—'}</span>
        <span>
          {t('superAdmin.messages.lastCheckin')}: {relTime(device.lastCheckinAt)}
        </span>
        <span className={online ? 'text-green-600' : 'text-neutral-400'}>
          {online ? t('superAdmin.messages.online') : t('superAdmin.messages.offline')}
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          type="tel"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={t('superAdmin.messages.testSmsPlaceholder')}
          className="min-w-0 flex-1 rounded-md border border-neutral-200 px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          onClick={submitTest}
          disabled={sendTest.isPending}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          {t('superAdmin.messages.testSmsSend')}
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        <button
          onClick={() => queueCommand('report_state')}
          disabled={sendCommand.isPending}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('superAdmin.messages.refreshState')}
        </button>
        <button
          onClick={() => queueCommand('fetch_logs')}
          disabled={sendCommand.isPending}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <FileDown className="h-3.5 w-3.5" />
          {t('superAdmin.messages.fetchLogs')}
        </button>
      </div>

      {feedback && (
        <p className={cn('mt-2 text-xs', feedback.ok ? 'text-green-600' : 'text-red-600')}>
          {feedback.msg}
        </p>
      )}
    </div>
  );
}

export default function SuperAdminMessagesPage() {
  const { t } = useI18n();
  const [channel, setChannel] = useState<'' | 'email' | 'sms'>('sms');
  const [status, setStatus] = useState<'' | 'pending' | 'sent' | 'delivered' | 'failed'>('');

  const filters: SuperAdminMessageFilters = useMemo(() => {
    const f: SuperAdminMessageFilters = {};
    if (channel) f.channel = channel;
    if (status) f.status = status;
    return f;
  }, [channel, status]);

  const { data: rawMsgs, isLoading } = useSuperAdminMessages(apiClient, filters);
  const messages = normalizeList<OutboundMessageRecord>(rawMsgs);
  const retry = useRetrySuperAdminMessage(apiClient);

  const { data: rawDevices } = useDevices(apiClient);
  const devices = normalizeList<FleetDeviceListItem>(rawDevices);
  const gateways = devices.filter((d) => d.isSmsGateway);
  const deviceName = useMemo(
    () => new Map(devices.map((d) => [d.id, d.name || d.model || d.deviceUuid.slice(0, 8)])),
    [devices],
  );

  return (
    <div className="space-y-6">
      <div>
        <PageHeader title={t('superAdmin.messages.title')} />
        <p className="-mt-4 text-sm text-neutral-500">{t('superAdmin.messages.subtitle')}</p>
      </div>

      {/* ── Gateway phones ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-700">
          {t('superAdmin.messages.gatewaysTitle')}
        </h2>
        {gateways.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-200 py-8 text-center text-sm text-neutral-400">
            {t('superAdmin.messages.noGateways')}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {gateways.map((d) => (
              <GatewayCard key={d.id} device={d} />
            ))}
          </div>
        )}
      </section>

      {/* ── Messages log ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-700">
          {t('superAdmin.messages.logTitle')}
        </h2>

        <div className="flex flex-wrap gap-2">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as typeof channel)}
            className={selectCls}
          >
            <option value="">{t('messages.allChannels')}</option>
            <option value="email">{t('messages.email')}</option>
            <option value="sms">{t('messages.sms')}</option>
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className={selectCls}
          >
            <option value="">{t('messages.allStatuses')}</option>
            {(['pending', 'sent', 'delivered', 'failed'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`messages.status.${s}`)}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-neutral-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-200 py-16 text-center text-sm text-neutral-400">
            {t('messages.empty')}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-100 bg-neutral-50 text-left text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('messages.colWhen')}</th>
                  <th className="px-3 py-2 font-medium">{t('messages.colChannel')}</th>
                  <th className="px-3 py-2 font-medium">{t('messages.colTo')}</th>
                  <th className="px-3 py-2 font-medium">{t('superAdmin.messages.colDevice')}</th>
                  <th className="px-3 py-2 font-medium">{t('messages.colStatus')}</th>
                  <th className="px-3 py-2 font-medium">{t('messages.colDetail')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {messages.map((m) => (
                  <tr key={m.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                      {fmtTime(m.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-neutral-700">
                        {m.channel === 'email' ? (
                          <Mail className="h-4 w-4 text-neutral-400" />
                        ) : (
                          <MessageSquare className="h-4 w-4 text-neutral-400" />
                        )}
                        {m.channel}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-neutral-800">{m.toAddress}</div>
                      <div className="text-xs text-neutral-400">{m.kind}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-500">
                      {m.claimedByDevice ? (deviceName.get(m.claimedByDevice) ?? '—') : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          STATUS_CLS[m.status] ?? 'bg-neutral-100 text-neutral-600',
                        )}
                      >
                        {t(`messages.status.${m.status}`)}
                      </span>
                    </td>
                    <td className="max-w-xs px-3 py-2 text-xs text-neutral-500">
                      {m.error ? (
                        <span className="text-red-600">{m.error}</span>
                      ) : (
                        <span className="line-clamp-2">{m.subject ?? m.bodyPreview}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {(m.status === 'failed' || m.status === 'sent') && (
                        <button
                          onClick={() => retry.mutate(m.id)}
                          disabled={retry.isPending}
                          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-600 hover:border-primary hover:text-primary disabled:opacity-50"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          {t('messages.retry')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
