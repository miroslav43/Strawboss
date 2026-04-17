'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { X, Clock, MapPin, Truck, Wrench, Wheat } from 'lucide-react';
import { useRouteHistory } from '@strawboss/api';
import type { RoutePoint } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

function MachineTypeIcon({ type }: { type: string | null }) {
  const cls = 'h-4 w-4 flex-shrink-0';
  if (type === 'truck') return <Truck className={cls} />;
  if (type === 'loader') return <Wrench className={cls} />;
  if (type === 'baler') return <Wheat className={cls} />;
  return <MapPin className={cls} />;
}

interface RouteHistoryPanelProps {
  machineId: string;
  machineCode: string | null;
  machineType: string | null;
  onClose: () => void;
  onRouteData: (points: RoutePoint[] | undefined) => void;
}

export function RouteHistoryPanel({
  machineId,
  machineCode,
  machineType,
  onClose,
  onRouteData,
}: RouteHistoryPanelProps) {
  const { t } = useI18n();
  const [selectedHours, setSelectedHours] = useState(24);
  const [refreshKey, setRefreshKey] = useState(0);

  const timeRanges = useMemo(
    () =>
      [
        { label: t('map.route1h'), hours: 1 },
        { label: t('map.route6h'), hours: 6 },
        { label: t('map.route12h'), hours: 12 },
        { label: t('map.route1d'), hours: 24 },
        { label: t('map.route3d'), hours: 72 },
        { label: t('map.route7d'), hours: 168 },
      ] as const,
    [t],
  );

  const { from, to } = useMemo(() => {
    const now = new Date();
    return {
      from: new Date(now.getTime() - selectedHours * 3600_000).toISOString(),
      to: now.toISOString(),
    };
  }, [selectedHours, refreshKey]);

  const { data, isLoading, isError } = useRouteHistory(apiClient, machineId, from, to);

  useEffect(() => {
    onRouteData(data?.points);
  }, [data?.points, onRouteData]);

  useEffect(() => {
    return () => onRouteData(undefined);
  }, []);


  const formatPoints = useCallback(
    (n: number) => t('map.routePointsCount', { n }),
    [t],
  );

  return (
    <div className="absolute bottom-20 left-1/2 z-[1000] -translate-x-1/2 w-[420px] rounded-xl bg-white shadow-2xl ring-1 ring-black/5">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-blue-500" />
          <MachineTypeIcon type={machineType} />
          <span className="text-sm font-semibold text-neutral-800">
            {machineCode ?? t('leaflet.machineUnknown')}
          </span>
          <span className="text-xs text-neutral-400">{t('map.routeGpsTrack')}</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2 px-4 py-3">
        <Clock className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
        <span className="text-xs text-neutral-500">{t('map.routeInterval')}</span>
        <div className="flex gap-1">
          {timeRanges.map((range) => (
            <button
              key={range.hours}
              onClick={() => {
                setSelectedHours(range.hours);
                setRefreshKey((k) => k + 1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedHours === range.hours
                  ? 'bg-blue-500 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-neutral-100 px-4 py-2.5">
        {isLoading && (
          <p className="text-xs text-neutral-400">{t('map.routeLoading')}</p>
        )}
        {isError && (
          <p className="text-xs text-red-500">{t('map.routeError')}</p>
        )}
        {data && !isLoading && (
          <p className="text-xs text-neutral-500">
            {data.totalPoints === 0
              ? t('map.routeNoPoints')
              : formatPoints(data.totalPoints)}
          </p>
        )}
      </div>
    </div>
  );
}
