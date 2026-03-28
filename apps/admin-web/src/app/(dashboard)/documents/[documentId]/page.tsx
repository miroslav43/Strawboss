'use client';
export const dynamic = 'force-dynamic';

import { use } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useDocument } from '@strawboss/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { DocumentViewer } from '@/components/shared/DocumentViewer';
import { apiClient } from '@/lib/api';

interface DocumentDetailPageProps {
  params: Promise<{ documentId: string }>;
}

export default function DocumentDetailPage({ params }: DocumentDetailPageProps) {
  const { documentId } = use(params);
  const docQuery = useDocument(apiClient, documentId);

  return (
    <div>
      <PageHeader
        title="Document Detail"
        actions={
          <Link
            href="/documents"
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Documents
          </Link>
        }
      />

      {docQuery.isLoading ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          Loading document...
        </div>
      ) : docQuery.isError ? (
        <div className="py-8 text-center text-sm text-red-500">
          Failed to load document. The backend may not be running.
        </div>
      ) : docQuery.data ? (
        <DocumentViewer document={docQuery.data} />
      ) : (
        <div className="py-8 text-center text-sm text-neutral-400">
          Document not found.
        </div>
      )}
    </div>
  );
}
