'use client';

import { useState, useMemo, useEffect } from 'react';
import { X, Clock, MapPin } from 'lucide-react';
import { useRouteHistory } from '@strawboss/api';
import type { RoutePoint } from '@strawboss/types';
import { apiClient } from '@/lib/api';

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '12h', hours: 12 },
  { label: '1zi', hours: 24 },
  { label: '3zi', hours: 72 },
  { label: '7zi', hours: 168 },
] as const;

const MACHINE_EMOJI: Record<string, string> = {
  baler: '🌾',
  loader: '🔧',
  truck: '🚛',
};

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
  const [selectedHours, setSelectedHours] = useState(24);
  const [refreshKey, setRefreshKey] = useState(0);

  const { from, to } = useMemo(() => {
    const now = new Date();
    return {
      from: new Date(now.getTime() - selectedHours * 3600_000).toISOString(),
      to: now.toISOString(),
    };
    // refreshKey ensures clicking the same range button recomputes with fresh "now"
  }, [selectedHours, refreshKey]);

  const { data, isLoading, isError } = useRouteHistory(apiClient, machineId, from, to);

  useEffect(() => {
    onRouteData(data?.points);
  }, [data?.points, onRouteData]);

  // Clear route data on unmount
  useEffect(() => {
    return () => onRouteData(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emoji = MACHINE_EMOJI[machineType ?? ''] ?? '📍';

  return (
    <div className="absolute bottom-20 left-1/2 z-[1000] -translate-x-1/2 w-[420px] rounded-xl bg-white shadow-2xl ring-1 ring-black/5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-semibold text-neutral-800">
            {emoji} {machineCode ?? 'Mașină'}
          </span>
          <span className="text-xs text-neutral-400">— traseu GPS</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Time range selector */}
      <div className="flex items-center gap-2 px-4 py-3">
        <Clock className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
        <span className="text-xs text-neutral-500">Interval:</span>
        <div className="flex gap-1">
          {TIME_RANGES.map((range) => (
            <button
              key={range.hours}
              onClick={() => { setSelectedHours(range.hours); setRefreshKey((k) => k + 1); }}
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

      {/* Status */}
      <div className="border-t border-neutral-100 px-4 py-2.5">
        {isLoading && (
          <p className="text-xs text-neutral-400">Se încarcă traseul…</p>
        )}
        {isError && (
          <p className="text-xs text-red-500">Eroare la încărcarea traseului.</p>
        )}
        {data && !isLoading && (
          <p className="text-xs text-neutral-500">
            {data.totalPoints === 0
              ? 'Niciun punct GPS în intervalul selectat.'
              : `${data.totalPoints.toLocaleString('ro-RO')} puncte GPS`}
          </p>
        )}
      </div>
    </div>
  );
}
