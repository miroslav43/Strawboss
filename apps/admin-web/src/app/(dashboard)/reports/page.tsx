'use client';

import { useState } from 'react';
import { useProductionReport, useCostReport } from '@strawboss/api';
import type { ProductionReport, CostReport } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { ReportFilters } from '@/components/features/reports/ReportFilters';
import { BaleCountChart } from '@/components/features/reports/BaleCountChart';
import { CostBreakdownChart } from '@/components/features/reports/CostBreakdownChart';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

type Tab = 'production' | 'costs';

interface ProductionRow extends Record<string, unknown> {
  parcelId: string;
  parcelName: string;
  produced: number;
  loaded: number;
  delivered: number;
  lossPercentage: number;
}

const productionColumns: Column<ProductionRow>[] = [
  {
    key: 'parcelName',
    header: 'Parcel',
    sortable: true,
    render: (row) => (
      <span className="font-medium text-neutral-800">{row.parcelName}</span>
    ),
  },
  { key: 'produced', header: 'Produced', sortable: true },
  { key: 'loaded', header: 'Loaded', sortable: true },
  { key: 'delivered', header: 'Delivered', sortable: true },
  {
    key: 'lossPercentage',
    header: 'Loss %',
    sortable: true,
    render: (row) => {
      const val = Number(row.lossPercentage);
      return (
        <span
          className={cn(
            'text-sm font-medium',
            val > 5 ? 'text-red-600' : val > 2 ? 'text-amber-600' : 'text-green-600',
          )}
        >
          {val.toFixed(1)}%
        </span>
      );
    },
  },
];

interface CostRow extends Record<string, unknown> {
  entityId: string;
  entityName: string;
  entityType: string;
  fuelCost: number;
  consumableCost: number;
  totalCost: number;
}

const costColumns: Column<CostRow>[] = [
  {
    key: 'entityName',
    header: 'Entity',
    sortable: true,
    render: (row) => (
      <span className="font-medium text-neutral-800">{row.entityName}</span>
    ),
  },
  {
    key: 'entityType',
    header: 'Type',
    render: (row) => (
      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
        {String(row.entityType)}
      </span>
    ),
  },
  {
    key: 'fuelCost',
    header: 'Fuel Cost',
    sortable: true,
    render: (row) => `$${Number(row.fuelCost).toLocaleString()}`,
  },
  {
    key: 'consumableCost',
    header: 'Consumable Cost',
    sortable: true,
    render: (row) => `$${Number(row.consumableCost).toLocaleString()}`,
  },
  {
    key: 'totalCost',
    header: 'Total',
    sortable: true,
    render: (row) => (
      <span className="font-semibold text-neutral-800">
        ${Number(row.totalCost).toLocaleString()}
      </span>
    ),
  },
];

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('production');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filters: Record<string, string> = {};
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;
  const hasFilters = Object.keys(filters).length > 0;

  const productionQuery = useProductionReport(
    apiClient,
    hasFilters ? filters : undefined,
  );
  const costQuery = useCostReport(
    apiClient,
    hasFilters ? filters : undefined,
  );

  const production: ProductionReport[] = productionQuery.data ?? [];
  const costs: CostReport[] = costQuery.data ?? [];

  return (
    <div>
      <PageHeader title="Reports" />

      {/* Filters */}
      <div className="mb-6">
        <ReportFilters
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
        />
      </div>

      {/* Tab selector */}
      <div className="mb-6 flex gap-1 rounded-lg bg-neutral-100 p-1">
        <button
          onClick={() => setTab('production')}
          className={cn(
            'rounded-md px-4 py-2 text-sm font-medium transition-colors',
            tab === 'production'
              ? 'bg-white text-neutral-800 shadow-sm'
              : 'text-neutral-500 hover:text-neutral-700',
          )}
        >
          Production
        </button>
        <button
          onClick={() => setTab('costs')}
          className={cn(
            'rounded-md px-4 py-2 text-sm font-medium transition-colors',
            tab === 'costs'
              ? 'bg-white text-neutral-800 shadow-sm'
              : 'text-neutral-500 hover:text-neutral-700',
          )}
        >
          Costs
        </button>
      </div>

      {/* Content */}
      {tab === 'production' && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-neutral-800">
            Production Report
          </h2>
          {productionQuery.isLoading ? (
            <div className="py-8 text-center text-sm text-neutral-400">
              Loading production data...
            </div>
          ) : productionQuery.isError ? (
            <div className="py-8 text-center text-sm text-red-500">
              Failed to load data. The backend may not be running.
            </div>
          ) : (
            <>
              <BaleCountChart data={production} />
              <DataTable<ProductionRow>
                columns={productionColumns}
                data={production.map((p) => ({ ...p }) as ProductionRow)}
                keyExtractor={(row) => row.parcelId}
              />
            </>
          )}
        </div>
      )}

      {tab === 'costs' && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-neutral-800">
            Cost Report
          </h2>
          {costQuery.isLoading ? (
            <div className="py-8 text-center text-sm text-neutral-400">
              Loading cost data...
            </div>
          ) : costQuery.isError ? (
            <div className="py-8 text-center text-sm text-red-500">
              Failed to load data. The backend may not be running.
            </div>
          ) : (
            <>
              <CostBreakdownChart data={costs} />
              <DataTable<CostRow>
                columns={costColumns}
                data={costs.map((c) => ({ ...c }) as CostRow)}
                keyExtractor={(row) => row.entityId}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
