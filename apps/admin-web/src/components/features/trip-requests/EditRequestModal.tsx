'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Pencil, XCircle, Loader2, MapPin, Warehouse, Sprout, Info } from 'lucide-react';
import {
  useUpdateTripRequest,
  useDeliveryDestinations,
  useParcels,
  ApiError,
} from '@strawboss/api';
import type { TripRequest, DeliveryDestination, Parcel } from '@strawboss/types';
import { RequestStatus, CropType } from '@strawboss/types';
import type { UpdateTripRequestInput } from '@strawboss/validation';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { EMPTY } from '@/lib/date';
import { normalizeList } from '@/lib/normalize-api-list';
import { FarmParcelCascade } from '@/components/features/tasks/machine-plan/FarmParcelCascade';

const ParcelMapModal = dynamic(
  () =>
    import('@/components/features/tasks/daily-plan/ParcelMapModal').then((m) => m.ParcelMapModal),
  { ssr: false },
);

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

// Stable references — FarmParcelCascade takes these as props, and there is no
// other assignment in this context to exclude or count against.
const EMPTY_EXCLUDE = new Set<string>();
const EMPTY_ASSIGNED_COUNT = new Map<string, number>();

type SourceType = 'depot' | 'field';

/**
 * The edit form, flattened to strings.
 *
 * Every field is a string because that is what an `<input>` round-trips. The
 * conversion back (`'' -> null`, `Number()`, dropped on NaN) happens once, in
 * `buildPatch`, so there is exactly one place where "the operator cleared this
 * box" turns into "clear the column".
 */
type FormState = Record<TextKey, string>;

const TEXT_KEYS = [
  'requesterName',
  'requesterPhone',
  'requesterEmail',
  'companyName',
  'companyAddress',
  'companyCui',
  'truckRegistrationPlate',
  'truckMake',
  'truckModel',
  'truckCapacityTons',
  'trailerRegistrationPlate',
  'transporterName',
  'transporterCui',
  'transporterAddress',
  'driverName',
  'driverPhone',
  'driverEmail',
  'cropType',
  'quality',
  'tonsRequested',
  'neededDate',
  'unloadingDate',
  'destinationLocality',
  'destinationAddress',
  'notes',
] as const;
type TextKey = (typeof TEXT_KEYS)[number];

/** Keys the server stores as numeric — `Number()` on the way out, dropped if NaN. */
const NUMERIC_KEYS = new Set<TextKey>(['truckCapacityTons', 'tonsRequested']);

/** Keys that must never be cleared: the schema requires a non-empty value. */
const REQUIRED_KEYS = new Set<TextKey>([
  'requesterName',
  'requesterPhone',
  'truckRegistrationPlate',
  'driverName',
  'driverPhone',
]);

function requestToForm(r: TripRequest): FormState {
  const out = {} as FormState;
  for (const k of TEXT_KEYS) {
    const v = (r as unknown as Record<string, unknown>)[k];
    out[k] = v == null ? '' : String(v);
  }
  return out;
}

/**
 * Only what actually changed.
 *
 * Sending the whole form would make every save a full overwrite — which is how a
 * concurrent edit from the truck board silently loses. It also keeps the
 * server's `has()` checks meaningful: an absent key is "don't touch", which is
 * not the same as `null`.
 */
function buildPatch(r: TripRequest, form: FormState): UpdateTripRequestInput {
  const original = requestToForm(r);
  const patch: Record<string, unknown> = {};
  for (const k of TEXT_KEYS) {
    const next = form[k].trim();
    if (next === original[k].trim()) continue;
    if (next === '') {
      // A required field can never be cleared — the input carries `required`,
      // so this is a belt-and-braces guard against a programmatic empty.
      if (REQUIRED_KEYS.has(k)) continue;
      patch[k] = null;
      continue;
    }
    if (NUMERIC_KEYS.has(k)) {
      const n = Number(next);
      if (Number.isNaN(n)) continue;
      patch[k] = n;
      continue;
    }
    patch[k] = next;
  }
  return patch as UpdateTripRequestInput;
}

/**
 * Correct an auxiliary transport in place, instead of deleting and re-creating it.
 *
 * Only mounted for stages `canEditAuxStage` allows — the pencil that opens it is
 * disabled otherwise, and the backend recomputes the stage and refuses anyway.
 *
 * The section order mirrors `RequestDetailsModal` one-for-one on purpose: the
 * modal you open to READ a transport and the one you open to FIX it should look
 * like the same document.
 */
export function EditRequestModal({
  request,
  onClose,
}: {
  request: TripRequest;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const update = useUpdateTripRequest(apiClient);
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /*
   * Seeded ONCE, deliberately.
   *
   * `trip_requests` is in the realtime publication, so the ledger behind this
   * modal refetches on any change. A `useState(requestToForm(request))` that
   * re-derived on re-render would reset the form under the operator's fingers
   * mid-typing.
   */
  const [form, setForm] = useState<FormState>(() => requestToForm(request));
  const [resend, setResend] = useState(false);
  const [noChanges, setNoChanges] = useState(false);

  const confirmed = request.status === RequestStatus.confirmed;

  // Pickup source — only meaningful once the request has been confirmed (that is
  // when a source was chosen at all).
  const [sourceType, setSourceType] = useState<SourceType>(
    request.sourceParcelId ? 'field' : 'depot',
  );
  const [depotId, setDepotId] = useState(request.sourceDepotId ?? '');
  const [parcelId, setParcelId] = useState(request.sourceParcelId ?? '');
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const [showParcelMap, setShowParcelMap] = useState(false);

  const { data: rawDepots } = useDeliveryDestinations(apiClient);
  const { data: rawParcels } = useParcels(apiClient);
  const depots = useMemo(
    () => normalizeList<DeliveryDestination>(rawDepots).filter((d) => d.isActive),
    [rawDepots],
  );
  const parcels = useMemo(() => normalizeList<Parcel>(rawParcels), [rawParcels]);
  const selectedParcel = useMemo(
    () => parcels.find((p) => p.id === parcelId) ?? null,
    [parcels, parcelId],
  );

  // Dialog semantics: focus in on mount, restore on unmount, Escape to close.
  // Copied from AvizUploadModal — the sibling confirm/cancel modals have none.
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

  const set = (k: TextKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setNoChanges(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const destTouched =
    form.destinationLocality.trim() !== (request.destinationLocality ?? '').trim() ||
    form.destinationAddress.trim() !== (request.destinationAddress ?? '').trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const patch = buildPatch(request, form);

    // Pickup source travels as the XOR pair the server expects: setting one
    // clears the other in the same statement.
    if (confirmed) {
      const nextDepot = sourceType === 'depot' ? depotId || null : null;
      const nextParcel = sourceType === 'field' ? parcelId || null : null;
      if (nextDepot !== (request.sourceDepotId ?? null) || nextParcel !== (request.sourceParcelId ?? null)) {
        patch.sourceDepotId = nextDepot;
        patch.sourceParcelId = nextParcel;
      }
    }

    if (!Object.keys(patch).length && !resend) {
      setNoChanges(true);
      return;
    }
    update.mutate(
      { id: request.id, data: { ...patch, ...(resend ? { resendConfirmation: true } : {}) } },
      { onSuccess: onClose },
    );
  };

  // Branch on the machine-readable code, never on the message text.
  const errorMessage = (() => {
    if (!update.isError) return null;
    const code =
      update.error instanceof ApiError
        ? (update.error.data as { error?: string } | undefined)?.error
        : undefined;
    if (code === 'stage_not_editable') return t('tripRequests.editStageError');
    if (code === 'validation_failed') return t('tripRequests.editValidationError');
    return t('tripRequests.editError');
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        style={{ maxHeight: 'min(90vh, 900px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2
            id={titleId}
            className="flex min-w-0 items-center gap-2 text-lg font-semibold text-neutral-800"
          >
            <Pencil className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate">
              {t('tripRequests.editTitle')}
              {request.truckRegistrationPlate ? ` · ${request.truckRegistrationPlate}` : ''}
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

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {/* What an edit reaches beyond this table. Only true once a truck and
                a trip exist — before that the write touches one row. */}
            {confirmed && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{t('tripRequests.editCascadeNote')}</span>
              </p>
            )}

            <Section title={t('tripRequests.sectionRequester')}>
              <Field label={t('tripRequests.colRequester')} required>
                <input value={form.requesterName} onChange={set('requesterName')} required className={inputCls} />
              </Field>
              <Field label={t('tripRequests.requesterPhone')} required>
                <input value={form.requesterPhone} onChange={set('requesterPhone')} required className={inputCls} />
              </Field>
              <Field label={t('tripRequests.requesterEmail')}>
                <input type="email" value={form.requesterEmail} onChange={set('requesterEmail')} className={inputCls} />
              </Field>
              <Field label={t('tripRequests.colCompany')}>
                <input value={form.companyName} onChange={set('companyName')} className={inputCls} />
              </Field>
              <Field label={t('tripRequests.companyAddress')}>
                <input value={form.companyAddress} onChange={set('companyAddress')} className={inputCls} />
              </Field>
              <Field label={t('tripRequests.cui')}>
                <input value={form.companyCui} onChange={set('companyCui')} className={inputCls} />
              </Field>
            </Section>

            <Section title={t('tripRequests.sectionTruck')}>
              <Field label={t('tripRequests.truckPlate')} hint={t('tripRequests.editPlateHint')} required>
                <input
                  value={form.truckRegistrationPlate}
                  onChange={set('truckRegistrationPlate')}
                  required
                  className={cn(inputCls, 'font-mono')}
                />
              </Field>
              <Field label={t('tripRequests.trailerPlate')}>
                <input
                  value={form.trailerRegistrationPlate}
                  onChange={set('trailerRegistrationPlate')}
                  className={cn(inputCls, 'font-mono')}
                />
              </Field>
              <Field label={t('tripRequests.truckMake')}>
                <input value={form.truckMake} onChange={set('truckMake')} className={inputCls} />
              </Field>
              <Field label={t('tripRequests.truckModel')}>
                <input value={form.truckModel} onChange={set('truckModel')} className={inputCls} />
              </Field>
              <Field label={t('tripRequests.truckCapacity')}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.truckCapacityTons}
                  onChange={set('truckCapacityTons')}
                  className={inputCls}
                />
              </Field>
            </Section>

            <Section title={t('tripRequests.sectionDriver')}>
              <Field label={t('tripRequests.colDriver')} required>
                <input value={form.driverName} onChange={set('driverName')} required className={inputCls} />
              </Field>
              <Field label={t('tripRequests.driverPhone')} required>
                <input value={form.driverPhone} onChange={set('driverPhone')} required className={inputCls} />
              </Field>
              <Field label={t('tripRequests.driverEmail')}>
                <input type="email" value={form.driverEmail} onChange={set('driverEmail')} className={inputCls} />
              </Field>
            </Section>

            <Section title={t('tripRequests.sectionCargo')}>
              {/* A SELECT, not a text box: crop_type is a PG enum, so a typed
                  value that is not in it would come back as a 400 the operator
                  cannot act on. Same source + label keys the public portal uses. */}
              <Field label={t('tripRequests.colCrop')}>
                <select value={form.cropType} onChange={set('cropType')} className={inputCls}>
                  <option value="">{EMPTY}</option>
                  {Object.values(CropType).map((c) => (
                    <option key={c} value={c}>
                      {t(`settings.organization.crop.${c}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('tripRequests.quality')}>
                <select value={form.quality} onChange={set('quality')} className={inputCls}>
                  <option value="">{EMPTY}</option>
                  <option value="quality_1">{t('tripRequests.quality1')}</option>
                  <option value="quality_2">{t('tripRequests.quality2')}</option>
                </select>
              </Field>
              <Field label={t('tripRequests.colTons')}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.tonsRequested}
                  onChange={set('tonsRequested')}
                  className={inputCls}
                />
              </Field>
              {/* The single most misleading field in this form if left unexplained:
                  the planner never reads needed_date — the day the truck actually
                  works is task_assignments.assignment_date, set on the truck board. */}
              <Field label={t('tripRequests.colNeededDate')} hint={t('tripRequests.editNeededDateHint')}>
                <input type="date" value={form.neededDate} onChange={set('neededDate')} className={inputCls} />
              </Field>
              <Field label={t('tripRequests.unloadingDate')}>
                <input type="date" value={form.unloadingDate} onChange={set('unloadingDate')} className={inputCls} />
              </Field>
              <Field label={t('tripRequests.notes')}>
                <input value={form.notes} onChange={set('notes')} className={inputCls} />
              </Field>
            </Section>

            <Section title={t('tripRequests.sectionDestination')}>
              <Field
                label={t('tripRequests.destinationLocality')}
                hint={destTouched && request.destinationCoords ? t('tripRequests.editDestCoordsHint') : undefined}
              >
                <input
                  value={form.destinationLocality}
                  onChange={set('destinationLocality')}
                  className={inputCls}
                />
              </Field>
              <Field label={t('tripRequests.destinationAddress')}>
                <input
                  value={form.destinationAddress}
                  onChange={set('destinationAddress')}
                  className={inputCls}
                />
              </Field>
            </Section>

            <Section title={t('tripRequests.sectionTransporter')}>
              <Field label={t('tripRequests.transporterName')}>
                <input value={form.transporterName} onChange={set('transporterName')} className={inputCls} />
              </Field>
              <Field label={t('tripRequests.transporterCui')}>
                <input value={form.transporterCui} onChange={set('transporterCui')} className={inputCls} />
              </Field>
              <Field label={t('tripRequests.transporterAddress')}>
                <input value={form.transporterAddress} onChange={set('transporterAddress')} className={inputCls} />
              </Field>
            </Section>

            {/* Pickup source: "I picked the wrong depot at confirm". Only exists
                once confirmed, and it corrects the PAPER — the loader's actual
                pickup comes from their own task and from where they really were. */}
            {confirmed && (
              <Section title={t('tripRequests.editSectionSource')}>
                <div className="sm:col-span-2">
                  <p className="mb-2 text-xs text-neutral-500">{t('tripRequests.editSourceHint')}</p>
                  <div className="mb-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSourceType('depot')}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors',
                        sourceType === 'depot'
                          ? 'border-green-400 bg-green-50 text-green-700'
                          : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary hover:text-primary',
                      )}
                    >
                      <Warehouse className="h-3.5 w-3.5" />
                      {t('tripRequests.sourceTypeDepot')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceType('field')}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors',
                        sourceType === 'field'
                          ? 'border-green-400 bg-green-50 text-green-700'
                          : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary hover:text-primary',
                      )}
                    >
                      <Sprout className="h-3.5 w-3.5" />
                      {t('tripRequests.sourceTypeField')}
                    </button>
                  </div>

                  {sourceType === 'depot' ? (
                    <select
                      value={depotId}
                      onChange={(e) => setDepotId(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">{t('tripRequests.depotPlaceholder')}</option>
                      {depots.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                          {d.address ? ` — ${d.address}` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="relative">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowFieldPicker((v) => !v)}
                          className={cn(inputCls, 'flex-1 text-left')}
                        >
                          {selectedParcel
                            ? `${selectedParcel.code}${selectedParcel.farmName ? `, ${selectedParcel.farmName}` : ''}`
                            : t('tripRequests.fieldPlaceholder')}
                        </button>
                        <button
                          type="button"
                          data-cascade-keep-open
                          onClick={() => {
                            setShowParcelMap(true);
                            setShowFieldPicker(false);
                          }}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-xs font-medium text-neutral-700 hover:border-primary hover:text-primary"
                        >
                          <MapPin className="h-3.5 w-3.5" aria-hidden />
                          {t('tasks.selectOnMap')}
                        </button>
                      </div>
                      {showFieldPicker && (
                        <FarmParcelCascade
                          parcels={parcels}
                          excludeParcelIds={EMPTY_EXCLUDE}
                          assignedCountByParcel={EMPTY_ASSIGNED_COUNT}
                          color="green"
                          onSelect={(id) => setParcelId(id)}
                          onClose={() => setShowFieldPicker(false)}
                        />
                      )}
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Shown, not hidden: the operator can see a value they cannot change here. */}
            {(request.tripNumber || request.comandaOrderNo || request.confirmedByName) && (
              <div
                title={t('tripRequests.editFrozenHint')}
                className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 sm:grid-cols-3"
              >
                {request.tripNumber && (
                  <p>
                    {t('tripRequests.colTrip')}:{' '}
                    <span className="font-medium text-neutral-700">{request.tripNumber}</span>
                  </p>
                )}
                {request.comandaOrderNo != null && (
                  <p>
                    {t('tripRequests.comandaOrderNo')}:{' '}
                    <span className="font-medium text-neutral-700">{request.comandaOrderNo}</span>
                  </p>
                )}
                {request.confirmedByName && (
                  <p>
                    {t('tripRequests.confirmedBy')}:{' '}
                    <span className="font-medium text-neutral-700">{request.confirmedByName}</span>
                  </p>
                )}
              </div>
            )}

            {/* The confirmation already went out with the OLD data. Opt-in, because
                a tonnage typo does not deserve an SMS and a wrong phone does. */}
            {confirmed && (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-neutral-200 px-3 py-2">
                <input
                  type="checkbox"
                  checked={resend}
                  onChange={(e) => setResend(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-primary focus:ring-primary"
                />
                <span className="text-sm text-neutral-700">
                  {t('tripRequests.editResend')}
                  <span className="block text-xs text-neutral-400">
                    {t('tripRequests.editResendHint')}
                  </span>
                </span>
              </label>
            )}

            {noChanges && (
              <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-500">
                {t('tripRequests.editNoChanges')}
              </p>
            )}
            {errorMessage && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{errorMessage}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t border-neutral-200 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={update.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {update.isPending ? t('tripRequests.editSaving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>

      {showParcelMap && (
        <ParcelMapModal
          parcels={parcels}
          // The map is a multi-select picker; a pickup source is exactly one
          // field, so take the first — same reduction ConfirmRequestModal makes.
          onSelect={(parcelIds: string[]) => {
            if (parcelIds[0]) setParcelId(parcelIds[0]);
            setShowParcelMap(false);
          }}
          onClose={() => setShowParcelMap(false)}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        {title}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {hint && <p className="mb-1 text-xs text-neutral-500">{hint}</p>}
      {children}
    </div>
  );
}
