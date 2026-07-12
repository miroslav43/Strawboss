'use client';

import { useEffect, useState } from 'react';
import { FileText, Download, ExternalLink } from 'lucide-react';
import type { Document as DocType, DocumentStatus } from '@strawboss/types';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

const statusStyles: Record<DocumentStatus, string> = {
  pending: 'bg-neutral-100 text-neutral-600',
  generating: 'bg-amber-100 text-amber-700',
  partial: 'bg-sky-100 text-sky-700',
  generated: 'bg-green-100 text-green-700',
  sent: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
};

/**
 * Decode a base64 `data:` URL into a same-origin `blob:` URL.
 *
 * The PDF is stored inline as `data:application/pdf;base64,...`. Chrome/Brave
 * block `data:` URLs inside iframes and as top-level navigations, so the
 * inline preview shows "blocked by Brave" and downloads misbehave. A `blob:`
 * URL renders, opens, and downloads cleanly in every browser.
 */
function dataUrlToBlobUrl(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  try {
    const mime = match[1];
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return null;
  }
}

interface DocumentViewerProps {
  document: DocType;
  className?: string;
}

export function DocumentViewer({ document: doc, className }: DocumentViewerProps) {
  const { t } = useI18n();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = doc.fileUrl;
    if (!url) {
      setObjectUrl(null);
      return;
    }
    if (url.startsWith('data:')) {
      const blobUrl = dataUrlToBlobUrl(url);
      setObjectUrl(blobUrl);
      return () => {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      };
    }
    // Already a real URL (e.g. Supabase Storage) or a same-origin server-relative
    // path (e.g. an uploaded aviz at `/api/v1/uploads/avize/<uuid>.pdf?exp&sig`,
    // pre-resolved by the caller) — use as-is; the browser loads it directly.
    if (url.startsWith('https://') || url.startsWith('http://localhost') || url.startsWith('/')) {
      setObjectUrl(url);
    } else {
      setObjectUrl(null);
    }
  }, [doc.fileUrl]);

  const isPdf = doc.mimeType === 'application/pdf';
  const downloadName = `${doc.title || 'document'}${isPdf ? '.pdf' : ''}`;

  return (
    <div className={cn('rounded-lg border border-neutral-200 bg-white', className)}>
      {/* Header */}
      <div className="flex items-start justify-between border-b border-neutral-100 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100">
            <FileText className="h-5 w-5 text-neutral-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-neutral-800">{doc.title}</h3>
            <p className="text-xs text-neutral-500">{t(`documents.types.${doc.documentType}`)}</p>
          </div>
        </div>
        <span
          className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusStyles[doc.status])}
        >
          {doc.status}
        </span>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-4 p-4 text-xs">
        {doc.generatedAt && (
          <div>
            <span className="text-neutral-400">Generated</span>
            <p className="text-neutral-700">{new Date(doc.generatedAt).toLocaleString()}</p>
          </div>
        )}
        {doc.sentAt && (
          <div>
            <span className="text-neutral-400">Sent</span>
            <p className="text-neutral-700">{new Date(doc.sentAt).toLocaleString()}</p>
          </div>
        )}
        {doc.fileSizeBytes != null && (
          <div>
            <span className="text-neutral-400">File size</span>
            <p className="text-neutral-700">{(doc.fileSizeBytes / 1024).toFixed(1)} KB</p>
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
      {objectUrl ? (
        <div className="space-y-3 border-t border-neutral-100 p-4">
          <div className="flex gap-2">
            <a
              href={objectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Deschide
            </a>
            <a
              href={objectUrl}
              download={downloadName}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <Download className="h-3.5 w-3.5" />
              Descarcă
            </a>
          </div>
          {isPdf && (
            <iframe
              src={objectUrl}
              className="h-96 w-full rounded border border-neutral-200"
              title={doc.title}
            />
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
