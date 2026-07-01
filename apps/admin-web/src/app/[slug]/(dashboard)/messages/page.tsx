'use client';
export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { Mail, MessageSquare, RefreshCw, Loader2 } from 'lucide-react';
import { useMessages, useRetryMessage, type MessageFilters } from '@strawboss/api';
import type { OutboundMessageRecord } from '@strawboss/types';
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

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function MessagesPage() {
  const { t } = useI18n();
  const [channel, setChannel] = useState<'' | 'email' | 'sms'>('');
  const [status, setStatus] = useState<'' | 'pending' | 'sent' | 'delivered' | 'failed'>('');

  const filters: MessageFilters = useMemo(() => {
    const f: MessageFilters = {};
    if (channel) f.channel = channel;
    if (status) f.status = status;
    return f;
  }, [channel, status]);

  const { data: raw, isLoading } = useMessages(apiClient, filters);
  const messages = normalizeList<OutboundMessageRecord>(raw);
  const retry = useRetryMessage(apiClient);

  return (
    <div className="space-y-4">
      <PageHeader title={t('messages.title')} />
      <p className="-mt-4 text-sm text-neutral-500">{t('messages.subtitle')}</p>

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
    </div>
  );
}
