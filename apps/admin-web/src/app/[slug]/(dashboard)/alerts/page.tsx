'use client';
export const dynamic = 'force-dynamic';

import { useState, useCallback, useMemo } from 'react';
import { useAlerts, useAcknowledgeAlert } from '@strawboss/api';
import { AlertCategory, AlertSeverity } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { AlertList } from '@/components/features/alerts/AlertList';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function AlertsPage() {
  const { t } = useI18n();
  const [categoryFilter, setCategoryFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [ackFilter, setAckFilter] = useState('');
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  const categoryOptions = useMemo(
    () => [
      { value: '', label: t('alerts.filterAllCategories') },
      ...Object.values(AlertCategory).map((c) => ({
        value: c,
        label: t(`alerts.category.${c}`),
      })),
    ],
    [t],
  );

  const severityOptions = useMemo(
    () => [
      { value: '', label: t('alerts.filterAllSeverities') },
      ...Object.values(AlertSeverity).map((s) => ({
        value: s,
        label: t(`alerts.severity.${s}`),
      })),
    ],
    [t],
  );

  const ackOptions = useMemo(
    () => [
      { value: '', label: t('alerts.filterAll') },
      { value: 'false', label: t('alerts.filterUnacknowledged') },
      { value: 'true', label: t('alerts.filterAcknowledged') },
    ],
    [t],
  );

  const filters: Record<string, string> = {};
  if (categoryFilter) filters.category = categoryFilter;
  if (severityFilter) filters.severity = severityFilter;
  if (ackFilter) filters.isAcknowledged = ackFilter;
  const hasFilters = Object.keys(filters).length > 0;

  const alertsQuery = useAlerts(apiClient, hasFilters ? filters : undefined);
  const acknowledgeMutation = useAcknowledgeAlert(apiClient);

  const alerts = alertsQuery.data ?? [];

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
      <PageHeader title={t('alerts.title')} />

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
          {t('alerts.loading')}
        </div>
      ) : alertsQuery.isError ? (
        <div className="py-8 text-center text-sm text-red-500">
          {t('alerts.loadError')}
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
