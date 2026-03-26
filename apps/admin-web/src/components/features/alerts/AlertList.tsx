'use client';

import {
  AlertTriangle,
  Shield,
  Wrench,
  ShieldAlert,
  MonitorCog,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import type { Alert, AlertCategory, AlertSeverity } from '@strawboss/types';
import { cn } from '@/lib/utils';

const categoryIcons: Record<AlertCategory, typeof AlertTriangle> = {
  fraud: Shield,
  anomaly: AlertTriangle,
  maintenance: Wrench,
  safety: ShieldAlert,
  system: MonitorCog,
};

const categoryLabels: Record<AlertCategory, string> = {
  fraud: 'Fraud',
  anomaly: 'Anomaly',
  maintenance: 'Maintenance',
  safety: 'Safety',
  system: 'System',
};

const severityStyles: Record<AlertSeverity, string> = {
  low: 'bg-neutral-100 text-neutral-600',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const severityLabels: Record<AlertSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

interface AlertListProps {
  alerts: Alert[];
  onAcknowledge: (id: string) => void;
  acknowledging?: string | null;
}

export function AlertList({ alerts, onAcknowledge, acknowledging }: AlertListProps) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 py-8 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-400" />
        <p className="text-sm text-neutral-500">No alerts to show</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert) => {
        const CategoryIcon = categoryIcons[alert.category] ?? AlertTriangle;
        const isAcking = acknowledging === alert.id;

        return (
          <div
            key={alert.id}
            className={cn(
              'rounded-lg border bg-white p-4 transition-colors',
              alert.isAcknowledged
                ? 'border-neutral-100 opacity-60'
                : 'border-neutral-200',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              {/* Left side */}
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100">
                  <CategoryIcon className="h-4 w-4 text-neutral-600" />
                </div>
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                        severityStyles[alert.severity],
                      )}
                    >
                      {severityLabels[alert.severity]}
                    </span>
                    <span className="text-[10px] text-neutral-400">
                      {categoryLabels[alert.category]}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-neutral-800">
                    {alert.title}
                  </h4>
                  <p className="mt-0.5 text-xs text-neutral-600">
                    {alert.description}
                  </p>

                  {/* Related links */}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {alert.tripId && (
                      <a
                        href={`/trips/${alert.tripId}`}
                        className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Trip
                      </a>
                    )}
                    {alert.machineId && (
                      <span className="text-[11px] text-neutral-500">
                        Machine: {alert.machineId.slice(0, 8)}...
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-[10px] text-neutral-400">
                    {new Date(alert.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Acknowledge button */}
              {!alert.isAcknowledged && (
                <button
                  onClick={() => onAcknowledge(alert.id)}
                  disabled={isAcking}
                  className={cn(
                    'flex-shrink-0 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700',
                    'hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                >
                  {isAcking ? 'Acknowledging...' : 'Acknowledge'}
                </button>
              )}
              {alert.isAcknowledged && (
                <span className="flex-shrink-0 text-xs text-green-600">
                  Acknowledged
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
