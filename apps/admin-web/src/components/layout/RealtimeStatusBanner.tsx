'use client';

import { WifiOff, RefreshCw } from 'lucide-react';
import { useRealtimeStatus } from '@/lib/realtime';
import { useI18n } from '@/lib/i18n';

export function RealtimeStatusBanner() {
  const { realtimeStatus, reconnect } = useRealtimeStatus();
  const { t } = useI18n();

  if (realtimeStatus === 'connected') return null;

  const isDisconnected = realtimeStatus === 'disconnected';

  return (
    <div
      className={
        isDisconnected
          ? 'flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800'
          : 'flex items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-sm text-neutral-500'
      }
    >
      <div className="flex items-center gap-2">
        <WifiOff className="h-4 w-4 flex-shrink-0" />
        <span>{isDisconnected ? t('realtime.disconnected') : t('realtime.reconnecting')}</span>
      </div>
      {isDisconnected && (
        <button
          type="button"
          onClick={reconnect}
          className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('realtime.reconnectButton')}
        </button>
      )}
    </div>
  );
}
