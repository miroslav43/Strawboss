'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Sprout, XCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  queryKeys,
  useCloseHarvestEvent,
  useCreateHarvestEvent,
  useUpdateHarvestEvent,
} from '@strawboss/api';
import type { MeteoHarvestEvent, SwathType } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { fromLocalInput, toLocalInput } from './format';

const SWATH_TYPES: SwathType[] = ['narrow', 'wide', 'turned'];
const MAX_AGE_MS = 28 * 24 * 3_600_000;

interface HarvestEventEditorProps {
  parcelId: string;
  parcelLabel: string;
  /** Edit mode when set; otherwise creates a new drying clock. */
  event?: MeteoHarvestEvent | null;
  /** Date pre-filled from the status history. The user must confirm or edit it. */
  hintAt?: string | null;
  onClose: () => void;
  /**
   * 409 HARVEST_EVENT_OPEN: the caller should show the already-open event for
   * editing (after the data refetch this component triggers).
   */
  onOpenExisting?: () => void;
}

/** Create / edit / close the drying-clock start ("harvest event") of a parcel. */
export function HarvestEventEditor({
  parcelId,
  parcelLabel,
  event,
  hintAt,
  onClose,
  onOpenExisting,
}: HarvestEventEditorProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const create = useCreateHarvestEvent(apiClient);
  const update = useUpdateHarvestEvent(apiClient);
  const close = useCloseHarvestEvent(apiClient);
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const initialSource = event?.harvestedAt ?? hintAt ?? null;
  const hintLocal = hintAt ? toLocalInput(hintAt) : null;
  const [when, setWhen] = useState(initialSource ? toLocalInput(initialSource) : '');
  const [swath, setSwath] = useState<SwathType>(event?.swathType ?? 'narrow');
  const [conflict, setConflict] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  const busy = create.isPending || update.isPending || close.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    setConflict(false);
    const iso = fromLocalInput(when);
    if (!iso) return setFieldError(t('meteo.event.dateRequired'));
    const ms = Date.parse(iso);
    if (ms > Date.now() + 5 * 60_000) return setFieldError(t('meteo.event.dateFuture'));
    if (ms < Date.now() - MAX_AGE_MS) return setFieldError(t('meteo.event.dateTooOld'));

    if (event) {
      update.mutate(
        { id: event.id, harvestedAt: iso, swathType: swath },
        { onSuccess: () => onCloseRef.current() },
      );
      return;
    }
    create.mutate(
      {
        parcelId,
        harvestedAt: iso,
        swathType: swath,
        // Only true when the user kept the pre-filled hint untouched.
        fromAuditHint: hintLocal !== null && when === hintLocal ? true : undefined,
      },
      {
        onSuccess: () => onCloseRef.current(),
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            setConflict(true);
            void queryClient.invalidateQueries({ queryKey: queryKeys.meteo.all });
          }
        },
      },
    );
  };

  const handleClose = () => {
    if (!event || !window.confirm(t('meteo.event.closeConfirm'))) return;
    close.mutate(event.id, { onSuccess: () => onCloseRef.current() });
  };

  const mutationError = create.error ?? update.error ?? close.error;
  const showGenericError = !!mutationError && !conflict;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 id={titleId} className="flex min-w-0 items-center gap-2 text-lg font-semibold text-neutral-800">
            <Sprout className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate">
              {event ? t('meteo.event.editTitle') : t('meteo.event.createTitle')} · {parcelLabel}
            </span>
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 px-6 py-5">
          <p className="text-xs text-neutral-500">{t('meteo.event.help')}</p>
          {hintAt && !event && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('meteo.event.hintNote')}
            </p>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-neutral-700">{t('meteo.event.harvestedAt')}</span>
            <input
              type="datetime-local"
              value={when}
              max={toLocalInput(new Date())}
              onChange={(e) => setWhen(e.target.value)}
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-neutral-700">{t('meteo.event.swath')}</span>
            <select
              value={swath}
              onChange={(e) => setSwath(e.target.value as SwathType)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            >
              {SWATH_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t(`meteo.swath.${s}`)}
                </option>
              ))}
            </select>
          </label>

          {fieldError && <p className="text-sm text-red-600">{fieldError}</p>}
          {conflict && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <p>{t('meteo.event.alreadyOpen')}</p>
              {onOpenExisting && (
                <button
                  type="button"
                  onClick={onOpenExisting}
                  className="mt-1 font-medium underline"
                >
                  {t('meteo.event.editOpen')}
                </button>
              )}
            </div>
          )}
          {showGenericError && <p className="text-sm text-red-600">{t('meteo.event.saveError')}</p>}

          <div className="flex items-center justify-between pt-2">
            {event ? (
              <button
                type="button"
                onClick={handleClose}
                disabled={busy}
                className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {t('meteo.event.close')}
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {event ? t('common.save') : t('meteo.event.start')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
