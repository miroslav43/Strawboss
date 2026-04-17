'use client';

import { useState, useCallback, useEffect } from 'react';
import { ImageOff, X } from 'lucide-react';

interface ReceiptThumbProps {
  /**
   * Relative URL returned by the backend (e.g. `/api/v1/uploads/receipts/...webp`)
   * or `null`/empty when no receipt was uploaded. Absolute URLs also work.
   */
  url: string | null | undefined;
  /** Visual size of the thumbnail. Defaults to 56px. */
  size?: number;
  /** Optional label shown inside the lightbox. */
  caption?: string;
}

/**
 * Thumbnail of a receipt photo with a click-to-enlarge lightbox.
 *
 * Renders a graceful placeholder when `url` is missing — most offline logs
 * won't have a photo, so the list must stay readable without one.
 */
export function ReceiptThumb({ url, size = 56, caption }: ReceiptThumbProps) {
  const [open, setOpen] = useState(false);
  const [errored, setErrored] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Dismiss lightbox on Escape — expected behavior for a modal overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!url || errored) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-md border border-dashed border-neutral-300 bg-neutral-50 text-neutral-400"
        style={{ width: size, height: size }}
        aria-label="No receipt photo"
      >
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 overflow-hidden rounded-md border border-neutral-200 transition hover:border-primary hover:shadow"
        style={{ width: size, height: size }}
        aria-label="Open receipt photo"
      >
        <img
          src={url}
          alt={caption ?? 'Receipt'}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setErrored(true)}
        />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={close}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={url}
            alt={caption ?? 'Receipt'}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {caption ? (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-sm text-white">
              {caption}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
