'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, CheckCircle2 } from 'lucide-react';
import type { PublicSignInfo } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';

/** Minimal self-contained canvas signature pad → PNG data URL. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
    ctx.lineTo(x, y);
    ctx.stroke();
    dirty.current = true;
  };
  const end = () => {
    drawing.current = false;
    if (dirty.current && canvasRef.current) {
      onChange(canvasRef.current.toDataURL('image/png'));
    }
  };
  const clear = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={600}
        height={220}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full touch-none rounded-lg border border-neutral-300 bg-white"
      />
      <button type="button" onClick={clear} className="mt-2 text-sm text-neutral-500 underline">
        {t('sign.clear')}
      </button>
    </div>
  );
}

export default function PublicSignPage() {
  const { t } = useI18n();
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [info, setInfo] = useState<PublicSignInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/v1/public/sign/${token}`);
        if (!res.ok) {
          if (alive) setLoadError(true);
          return;
        }
        if (alive) setInfo((await res.json()) as PublicSignInfo);
      } catch {
        if (alive) setLoadError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const submit = useCallback(async () => {
    if (!signature) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/public/sign/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature }),
      });
      if (!res.ok) {
        setSubmitError(t('sign.submitError'));
        return;
      }
      setDone(true);
    } catch {
      setSubmitError(t('sign.submitError'));
    } finally {
      setSubmitting(false);
    }
  }, [signature, token, t]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }
  if (loadError || !info) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <p className="text-center text-neutral-600">{t('sign.loadError')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-xl bg-neutral-50 px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold text-neutral-900">{info.organizationName}</h1>
      <h2 className="mb-6 text-lg font-medium text-neutral-600">{t('sign.title')}</h2>

      {done || info.alreadySigned ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-green-600" />
          <h3 className="text-lg font-semibold text-green-800">
            {done ? t('sign.successTitle') : t('sign.alreadySigned')}
          </h3>
          {done && <p className="mt-2 text-sm text-green-700">{t('sign.successBody')}</p>}
        </div>
      ) : (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-3 rounded-xl border border-neutral-200 bg-white p-5 text-sm">
            <Summary label={t('sign.baleCount')} value={String(info.baleCount)} />
            <Summary label={t('sign.crop')} value={info.cropType ?? t('sign.unknown')} />
            <Summary label={t('sign.parcel')} value={info.sourceParcelName ?? t('sign.unknown')} />
            <Summary
              label={t('sign.municipality')}
              value={info.sourceParcelMunicipality ?? t('sign.unknown')}
            />
          </dl>

          <p className="mb-2 text-sm font-medium text-neutral-700">{t('sign.signatureLabel')}</p>
          <SignaturePad onChange={setSignature} />

          {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!signature || submitting}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? t('sign.submitting') : t('sign.submit')}
          </button>
        </>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-neutral-800">{value}</dd>
    </div>
  );
}
