import { FileText, Download, ExternalLink } from 'lucide-react';
import type { Document as DocType, DocumentType, DocumentStatus } from '@strawboss/types';
import { cn } from '@/lib/utils';

function isSafeUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://localhost') || url.startsWith('data:');
}

const typeLabels: Record<DocumentType, string> = {
  cmr: 'CMR',
  invoice: 'Invoice',
  delivery_note: 'Delivery Note',
  weight_ticket: 'Weight Ticket',
  report: 'Report',
};

const statusStyles: Record<DocumentStatus, string> = {
  pending: 'bg-neutral-100 text-neutral-600',
  generating: 'bg-amber-100 text-amber-700',
  generated: 'bg-green-100 text-green-700',
  sent: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
};

interface DocumentViewerProps {
  document: DocType;
  className?: string;
}

export function DocumentViewer({ document: doc, className }: DocumentViewerProps) {
  return (
    <div className={cn('rounded-lg border border-neutral-200 bg-white', className)}>
      {/* Header */}
      <div className="flex items-start justify-between border-b border-neutral-100 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100">
            <FileText className="h-5 w-5 text-neutral-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-neutral-800">
              {doc.title}
            </h3>
            <p className="text-xs text-neutral-500">
              {typeLabels[doc.documentType]}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            statusStyles[doc.status],
          )}
        >
          {doc.status}
        </span>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-4 p-4 text-xs">
        {doc.generatedAt && (
          <div>
            <span className="text-neutral-400">Generated</span>
            <p className="text-neutral-700">
              {new Date(doc.generatedAt).toLocaleString()}
            </p>
          </div>
        )}
        {doc.sentAt && (
          <div>
            <span className="text-neutral-400">Sent</span>
            <p className="text-neutral-700">
              {new Date(doc.sentAt).toLocaleString()}
            </p>
          </div>
        )}
        {doc.fileSizeBytes != null && (
          <div>
            <span className="text-neutral-400">File size</span>
            <p className="text-neutral-700">
              {(doc.fileSizeBytes / 1024).toFixed(1)} KB
            </p>
          </div>
        )}
        {doc.mimeType && (
          <div>
            <span className="text-neutral-400">Type</span>
            <p className="text-neutral-700">{doc.mimeType}</p>
          </div>
        )}
      </div>

      {/* Actions / Viewer */}
      {doc.fileUrl ? (
        <div className="border-t border-neutral-100 p-4">
          {doc.mimeType === 'application/pdf' && isSafeUrl(doc.fileUrl) ? (
            <iframe
              src={doc.fileUrl}
              className="h-96 w-full rounded border border-neutral-200"
              title={doc.title}
              sandbox="allow-same-origin"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex gap-2">
              <a
                href={doc.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View
              </a>
              <a
                href={doc.fileUrl}
                download
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-neutral-100 p-4 text-center text-xs text-neutral-400">
          No file available
        </div>
      )}
    </div>
  );
}
