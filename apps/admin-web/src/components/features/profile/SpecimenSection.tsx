'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Signature, Eraser, Check, AlertCircle } from 'lucide-react';
import { useUploadSpecimen } from '@strawboss/api';
import type { User } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Resolve a server-relative URL to an absolute one the browser can fetch.
 */
function resolveUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith('/')) return `${API_URL}${pathOrUrl}`;
  return `${API_URL}/${pathOrUrl}`;
}

interface SpecimenSectionProps {
  profile: User;
}

/**
 * Signature specimen capture + preview for admin-web.
 *
 * The current specimen (if any) is shown as a preview image. Clicking
 * "Înlocuiește" opens a small HTML5 canvas pad where the user draws their
 * signature with the pointer/finger; saving POSTs the canvas as a PNG to
 * `/api/v1/profile/specimen` and updates the profile cache.
 *
 * We deliberately skip `react-signature-canvas` to avoid adding a new dep —
 * the canvas pointer-events setup below is ~60 lines and sufficient.
 */
export function SpecimenSection({ profile }: SpecimenSectionProps) {
  const { t } = useI18n();
  const uploadSpecimen = useUploadSpecimen(apiClient);
  const [isDrawing, setIsDrawing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasStrokesRef = useRef(false);

  // Auto-dismiss feedback after 4 s so the UI doesn't pile up state.
  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(id);
  }, [feedback]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    hasStrokesRef.current = false;
  }, []);

  // Resize the canvas to its CSS box and clear it whenever drawing opens.
  useEffect(() => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    clearCanvas();
  }, [isDrawing, clearCanvas]);

  const pointAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const { x, y } = pointAt(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pointAt(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasStrokesRef.current = true;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    drawingRef.current = false;
  };

  const handleSave = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!hasStrokesRef.current) {
      setFeedback({ type: 'error', message: t('settings.profile.specimen.errorNoStrokes') });
      return;
    }

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    );
    if (!blob) {
      setFeedback({ type: 'error', message: t('settings.profile.specimen.errorEncode') });
      return;
    }

    const form = new FormData();
    form.append('file', new File([blob], 'specimen.png', { type: 'image/png' }));

    uploadSpecimen.mutate(form, {
      onSuccess: () => {
        setFeedback({ type: 'success', message: t('settings.profile.specimen.successSaved') });
        setIsDrawing(false);
      },
      onError: () => {
        setFeedback({ type: 'error', message: t('settings.profile.specimen.errorSave') });
      },
    });
  }, [uploadSpecimen, t]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex h-32 w-full max-w-sm items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 sm:w-64">
          {profile.signatureSpecimenUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolveUrl(profile.signatureSpecimenUrl)}
              alt={t('settings.profile.specimen.imageAlt')}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-xs text-neutral-400">{t('settings.profile.specimen.empty')}</span>
          )}
        </div>
        <div className="flex-1 text-sm text-neutral-600">
          <p>{t('settings.profile.specimen.description')}</p>
        </div>
      </div>

      {!isDrawing ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => setIsDrawing(true)}
            className={cn(
              'flex items-center gap-2 rounded-md border border-green-700 px-4 py-2 text-sm font-medium text-green-700',
              'hover:bg-green-50',
            )}
          >
            <Signature className="h-4 w-4" />
            {profile.signatureSpecimenUrl
              ? t('settings.profile.specimen.replace')
              : t('settings.profile.specimen.create')}
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <canvas
            ref={canvasRef}
            className="h-44 w-full cursor-crosshair touch-none rounded-lg border border-neutral-300 bg-white"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={clearCanvas}
              className="flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              <Eraser className="h-4 w-4" />
              {t('settings.profile.specimen.clear')}
            </button>
            <button
              type="button"
              onClick={() => setIsDrawing(false)}
              disabled={uploadSpecimen.isPending}
              className="rounded-md px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={uploadSpecimen.isPending}
              className={cn(
                'flex items-center gap-2 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white',
                'hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {uploadSpecimen.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {t('settings.profile.specimen.save')}
            </button>
          </div>
        </div>
      )}

      {feedback ? (
        <div
          className={cn(
            'mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
            feedback.type === 'success'
              ? 'border border-green-200 bg-green-50 text-green-700'
              : 'border border-red-200 bg-red-50 text-red-700',
          )}
        >
          {feedback.type === 'success' ? (
            <Check className="h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          )}
          {feedback.message}
        </div>
      ) : null}
    </div>
  );
}
