'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDocuments } from '@strawboss/api';
import { DocumentType } from '@strawboss/types';
import type { Document as DocType } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

const typeLabels: Record<DocumentType, string> = {
  cmr: 'CMR',
  invoice: 'Invoice',
  delivery_note: 'Delivery Note',
  weight_ticket: 'Weight Ticket',
  report: 'Report',
};

const statusStyles: Record<string, string> = {
  pending: 'bg-neutral-100 text-neutral-600',
  generating: 'bg-amber-100 text-amber-700',
  generated: 'bg-green-100 text-green-700',
  sent: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
};

const typeOptions = [
  { value: '', label: 'All Types' },
  ...Object.values(DocumentType).map((t) => ({
    value: t,
    label: typeLabels[t],
  })),
];

interface DocRow extends Record<string, unknown> {
  id: string;
  title: string;
  documentType: DocumentType;
  status: string;
  tripId: string;
  createdAt: string;
}

function toRow(doc: DocType): DocRow {
  return {
    id: doc.id,
    title: doc.title,
    documentType: doc.documentType,
    status: doc.status,
    tripId: doc.tripId,
    createdAt: doc.createdAt,
  };
}

const columns: Column<DocRow>[] = [
  {
    key: 'title',
    header: 'Title',
    sortable: true,
    render: (row) => (
      <span className="font-medium text-neutral-800">{row.title}</span>
    ),
  },
  {
    key: 'documentType',
    header: 'Type',
    render: (row) => (
      <span className="text-xs text-neutral-600">
        {typeLabels[row.documentType as DocumentType] ?? String(row.documentType)}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-xs font-medium',
          statusStyles[String(row.status)] ?? 'bg-neutral-100 text-neutral-600',
        )}
      >
        {String(row.status)}
      </span>
    ),
  },
  {
    key: 'tripId',
    header: 'Trip',
    render: (row) => (
      <span className="text-xs text-neutral-500">
        {String(row.tripId).slice(0, 8)}...
      </span>
    ),
  },
  {
    key: 'createdAt',
    header: 'Date',
    sortable: true,
    render: (row) => (
      <span className="text-xs text-neutral-500">
        {new Date(String(row.createdAt)).toLocaleDateString()}
      </span>
    ),
  },
];

export default function DocumentsPage() {
  const { t } = useI18n();
  const [typeFilter, setTypeFilter] = useState('');
  const router = useRouter();

  const docsQuery = useDocuments(apiClient);
  const allDocs: DocType[] = docsQuery.data ?? [];

  const docs = typeFilter
    ? allDocs.filter((d) => d.documentType === typeFilter)
    : allDocs;

  return (
    <div>
      <PageHeader title={t('documents.title')} />

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {typeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {docsQuery.isLoading ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          Loading documents...
        </div>
      ) : docsQuery.isError ? (
        <div className="py-8 text-center text-sm text-red-500">
          Failed to load documents. The backend may not be running.
        </div>
      ) : (
        <DataTable<DocRow>
          columns={columns}
          data={docs.map(toRow)}
          keyExtractor={(row) => row.id}
          onRowClick={(row) => router.push(`/documents/${row.id}`)}
        />
      )}
    </div>
  );
}
