'use client';
export const dynamic = 'force-dynamic';

import { useState, useCallback } from 'react';
import { useAlerts, useAcknowledgeAlert } from '@strawboss/api';
import { AlertCategory, AlertSeverity } from '@strawboss/types';
import type { Alert, PaginatedResponse } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { AlertList } from '@/components/features/alerts/AlertList';
import { apiClient } from '@/lib/api';

const categoryOptions = [
  { value: '', label: 'All Categories' },
  ...Object.values(AlertCategory).map((c) => ({
    value: c,
    label: c.charAt(0).toUpperCase() + c.slice(1),
  })),
];

const severityOptions = [
  { value: '', label: 'All Severities' },
  ...Object.values(AlertSeverity).map((s) => ({
    value: s,
    label: s.charAt(0).toUpperCase() + s.slice(1),
  })),
];

const ackOptions = [
  { value: '', label: 'All' },
  { value: 'false', label: 'Unacknowledged' },
  { value: 'true', label: 'Acknowledged' },
];

export default function AlertsPage() {
  const [categoryFilter, setCategoryFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [ackFilter, setAckFilter] = useState('');
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  const filters: Record<string, string> = {};
  if (categoryFilter) filters.category = categoryFilter;
  if (severityFilter) filters.severity = severityFilter;
  if (ackFilter) filters.acknowledged = ackFilter;
  const hasFilters = Object.keys(filters).length > 0;

  const alertsQuery = useAlerts(apiClient, hasFilters ? filters : undefined);
  const acknowledgeMutation = useAcknowledgeAlert(apiClient);

  const alertsResponse = alertsQuery.data as PaginatedResponse<Alert> | undefined;
  const alerts = alertsResponse?.data ?? [];

  const handleAcknowledge = useCallback(
    (id: string) => {
      setAcknowledgingId(id);
      acknowledgeMutation.mutate(
        { id },
        {
          onSettled: () => setAcknowledgingId(null),
        },
      );
    },
    [acknowledgeMutation],
  );

  return (
    <div>
      <PageHeader title="Alerts" />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {categoryOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {severityOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={ackFilter}
          onChange={(e) => setAckFilter(e.target.value)}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {ackOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Alerts list */}
      {alertsQuery.isLoading ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          Loading alerts...
        </div>
      ) : alertsQuery.isError ? (
        <div className="py-8 text-center text-sm text-red-500">
          Failed to load alerts. The backend may not be running.
        </div>
      ) : (
        <AlertList
          alerts={alerts}
          onAcknowledge={handleAcknowledge}
          acknowledging={acknowledgingId}
        />
      )}
    </div>
  );
}
