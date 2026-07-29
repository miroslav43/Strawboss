'use client';
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, CheckCircle2, Camera, X } from 'lucide-react';
import type { PublicArrivalCmrInfo } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';

/** Same page ceiling as the loader's on-device scanner and the backend route. */
const MAX_PHOTOS = 10;

interface Photo {
  id: string;
  file: File;
  previewUrl: string;
}

/**
 * The public, unauthenticated page an external driver lands on after clicking
 * the SMS link sent when their auxiliary load finishes ("plecare"). At the
 * destination they come back here to upload the arrival CMR — 1..N photos,
 * captured straight from the phone camera — which is what completes the trip
 * (see TripsService.completeAuxiliaryOnArrivalCmr). One-time per token, same
 * as the sign page this replaces.
 *
 * Modeled on `[slug]/sign/[token]/page.tsx`: same raw-fetch (no auth header,
 * no ApiClient) pattern, same load/error/done states, and it sits in the same
 * spot outside both the `(dashboard)` and `(transporter)` route groups — so it
 * renders with zero auth, same as that page.
 */
export default function PublicCmrPage() {
  const { t } = useI18n();
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [info, setInfo] = useState<PublicArrivalCmrInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // One id per page load, sent with every attempt — pins the storage filename
  // so a retry after an ambiguous failure overwrites the same blob instead of
  // orphaning one (see CmrScansService.saveArrivalCmrFile).
  const scanId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/v1/public/cmr/${token}`);
        if (!res.ok) {
          if (alive) setLoadError(true);
          return;
        }
        if (alive) setInfo((await res.json()) as PublicArrivalCmrInfo);
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

  // Object URLs are only good for this tab's lifetime — revoke them as photos
  // are removed or the page unmounts, so a long session (several retakes)
  // doesn't leak memory.
  useEffect(() => {
    return () => {
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // Intentionally run once on mount; the deps are stable for this flow.
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same capture button fire again for the next page
    if (!file) return;
    setPhotos((prev) =>
      prev.length >= MAX_PHOTOS
        ? prev
        : [...prev, { id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) }],
    );
  }, []);

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const submit = useCallback(async () => {
    if (photos.length === 0) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const formData = new FormData();
      // Sent BEFORE the file parts — the server only reads scanId off the
      // FIRST file's already-parsed fields (see PublicPortalController.uploadCmr).
      formData.append('scanId', scanId);
      photos.forEach((p) => formData.append('file', p.file, p.file.name || 'cmr.jpg'));
      const res = await fetch(`/api/v1/public/cmr/${token}`, { method: 'POST', body: formData });
      if (!res.ok) {
        if (res.status === 409) {
          // Already uploaded — a double submit, or the driver used this same
          // link twice. Not an error worth alarming over; just show that state.
          setInfo((prev) => (prev ? { ...prev, alreadyUploaded: true } : prev));
        } else {
          setSubmitError(t('cmrArrival.submitError'));
        }
        return;
      }
      setDone(true);
    } catch {
      setSubmitError(t('cmrArrival.submitError'));
    } finally {
      setSubmitting(false);
    }
  }, [photos, scanId, token, t]);

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
        <p className="text-center text-neutral-600">{t('cmrArrival.loadError')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-xl bg-neutral-50 px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold text-neutral-900">{info.organizationName}</h1>
      <h2 className="mb-6 text-lg font-medium text-neutral-600">{t('cmrArrival.title')}</h2>

      {done || info.alreadyUploaded ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-green-600" />
          <h3 className="text-lg font-semibold text-green-800">
            {done ? t('cmrArrival.successTitle') : t('cmrArrival.alreadyUploaded')}
          </h3>
          {done && <p className="mt-2 text-sm text-green-700">{t('cmrArrival.successBody')}</p>}
        </div>
      ) : (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-3 rounded-xl border border-neutral-200 bg-white p-5 text-sm">
            <Summary
              label={t('cmrArrival.truckPlate')}
              value={info.truckPlate ?? t('cmrArrival.unknown')}
            />
            <Summary label={t('cmrArrival.baleCount')} value={String(info.baleCount)} />
            <Summary
              label={t('cmrArrival.destination')}
              value={info.destinationName ?? info.destinationAddress ?? t('cmrArrival.unknown')}
            />
          </dl>

          <p className="mb-3 text-sm text-neutral-600">{t('cmrArrival.hint')}</p>

          {photos.length > 0 && (
            <>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
                {t('cmrArrival.pagesLabel', { count: photos.length })}
              </p>
              <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
                {photos.map((p, i) => (
                  <div key={p.id} className="relative shrink-0">
                    {/* Plain <img>: this is a local blob: preview, not a remote asset, so next/image adds nothing. */}
                    <img
                      src={p.previewUrl}
                      alt=""
                      className="h-24 w-24 rounded-lg border border-neutral-200 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(p.id)}
                      aria-label={t('cmrArrival.removePhoto')}
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-black/70 p-0.5 text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                      {i + 1}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileChange}
          />

          {photos.length < MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 px-4 py-4 text-sm font-medium text-neutral-600 transition hover:border-primary hover:bg-neutral-50"
            >
              <Camera className="h-5 w-5" />
              {photos.length === 0 ? t('cmrArrival.addPhoto') : t('cmrArrival.addAnotherPhoto')}
            </button>
          )}

          {photos.length === 0 && (
            <p className="mb-3 text-xs text-neutral-400">{t('cmrArrival.noPhotos')}</p>
          )}
          {submitError && <p className="mb-3 text-sm text-red-600">{submitError}</p>}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={photos.length === 0 || submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? t('cmrArrival.submitting') : t('cmrArrival.submit')}
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
