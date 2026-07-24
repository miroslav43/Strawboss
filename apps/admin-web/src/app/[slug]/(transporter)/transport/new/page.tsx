'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Loader2,
  CheckCircle2,
  UserRound,
  Truck,
  PackageCheck,
  Building2,
  Pencil,
} from 'lucide-react';
import {
  useTransporterBeneficiaries,
  useTransporterRecords,
  useSubmitTransporterRequest,
  type AssignedBeneficiary,
} from '@strawboss/api';
import type { BeneficiaryContact, BeneficiaryTruck, BeneficiaryDriver } from '@strawboss/types';
import type { CreateTransporterRequestInput } from '@strawboss/validation';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useOrgSlug } from '@/hooks/useOrgSlug';
import { BeneficiarySavedSelect } from '@/app/[slug]/request/[beneficiarySlug]/BeneficiarySavedSelect';
import { SelectedContactsChips } from '@/app/[slug]/request/[beneficiarySlug]/SelectedContactsChips';
import type { RecordKind } from '@/app/[slug]/request/[beneficiarySlug]/BeneficiaryRecordModal';
import { TransporterRecordModal } from './TransporterRecordModal';
import { TransporterRecordDeleteDialog } from './TransporterRecordDeleteDialog';

const inputCls =
  'w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-[15px] text-bark ' +
  'placeholder:text-stone-400 shadow-sm transition-colors ' +
  'focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15';

const MAX_CONTACTS = 10;

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
        {label}
      </h2>
    </div>
  );
}

function Field({
  label,
  required,
  optional,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-stone-600">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
        {optional && (
          <span className="ml-1 font-normal text-stone-400">
            ({t('beneficiaryPortal.optional')})
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

function ReadOnlyChip({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-stone-400">—</span>;
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-[15px] text-bark">
      {value}
    </div>
  );
}

function LockedField({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-stone-600">{label}</span>
      <ReadOnlyChip
        value={value === null || value === undefined || value === '' ? null : String(value)}
      />
    </div>
  );
}

function EditSelectedButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:text-primary-700"
    >
      <Pencil className="h-3.5 w-3.5" />
      {t('beneficiaryPortal.saved.editSelected')}
    </button>
  );
}

type FormState = {
  quality: string;
  neededDate: string;
  unloadingDate: string;
  destinationAddress: string;
  destinationLocality: string;
  notes: string;
};
const BLANK: FormState = {
  quality: '',
  neededDate: '',
  unloadingDate: '',
  destinationAddress: '',
  destinationLocality: '',
  notes: '',
};

/**
 * The transporter's authenticated request form — an identical copy of the
 * beneficiary portal (Form B), minus the PIN step and plus a beneficiary picker
 * (scoped to the transporter's assigned beneficiaries). Reuses the portal's
 * presentational pieces (BeneficiarySavedSelect, SelectedContactsChips) and a
 * transporter-authenticated copy of the record add/edit/delete modals.
 */
export default function TransporterNewRequestPage() {
  const { t } = useI18n();
  const slug = useOrgSlug();

  const beneficiariesQuery = useTransporterBeneficiaries(apiClient);
  const beneficiaries: AssignedBeneficiary[] = useMemo(
    () => (Array.isArray(beneficiariesQuery.data) ? beneficiariesQuery.data : []),
    [beneficiariesQuery.data],
  );

  const [beneficiaryId, setBeneficiaryId] = useState<string>('');
  const selectedBeneficiary = beneficiaries.find((b) => b.id === beneficiaryId) ?? null;

  const contactsQuery = useTransporterRecords<BeneficiaryContact>(
    apiClient,
    beneficiaryId || null,
    'contacts',
  );
  const trucksQuery = useTransporterRecords<BeneficiaryTruck>(
    apiClient,
    beneficiaryId || null,
    'trucks',
  );
  const driversQuery = useTransporterRecords<BeneficiaryDriver>(
    apiClient,
    beneficiaryId || null,
    'drivers',
  );
  const contacts = contactsQuery.data ?? [];
  const trucks = trucksQuery.data ?? [];
  const drivers = driversQuery.data ?? [];

  const [selContactIds, setSelContactIds] = useState<string[]>([]);
  const [selTruckId, setSelTruckId] = useState<string | null>(null);
  const [selDriverId, setSelDriverId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const patch = (p: Partial<FormState>) => setForm((s) => ({ ...s, ...p }));

  const [recordModal, setRecordModal] = useState<{
    kind: RecordKind;
    record?: BeneficiaryContact | BeneficiaryTruck | BeneficiaryDriver;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: RecordKind;
    id: string;
    label: string;
  } | null>(null);

  const submit = useSubmitTransporterRequest(apiClient);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Switching beneficiary invalidates every selection (records are per-beneficiary).
  useEffect(() => {
    setSelContactIds([]);
    setSelTruckId(null);
    setSelDriverId(null);
  }, [beneficiaryId]);

  function addContact(id: string) {
    setSelContactIds((prev) =>
      prev.includes(id) || prev.length >= MAX_CONTACTS ? prev : [...prev, id],
    );
  }
  function removeContact(id: string) {
    setSelContactIds((prev) => prev.filter((x) => x !== id));
  }

  function handleSaved(rec: BeneficiaryContact | BeneficiaryTruck | BeneficiaryDriver) {
    if (!recordModal) return;
    const isNew = !recordModal.record;
    if (recordModal.kind === 'contact') {
      if (isNew) addContact(rec.id);
    } else if (recordModal.kind === 'truck') {
      if (isNew) setSelTruckId(rec.id);
    } else if (isNew) {
      setSelDriverId(rec.id);
    }
    setRecordModal(null);
  }

  function handleDeleted(id: string) {
    if (!deleteTarget) return;
    if (deleteTarget.kind === 'contact') setSelContactIds((prev) => prev.filter((x) => x !== id));
    else if (deleteTarget.kind === 'truck') setSelTruckId((cur) => (cur === id ? null : cur));
    else setSelDriverId((cur) => (cur === id ? null : cur));
    setDeleteTarget(null);
  }

  const selectedTruck = trucks.find((tk) => tk.id === selTruckId) ?? null;
  const selectedDriver = drivers.find((d) => d.id === selDriverId) ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const trim = (s: string) => (s.trim() === '' ? null : s.trim());
    const selectedContacts = selContactIds
      .map((id) => contacts.find((c) => c.id === id))
      .filter((c): c is BeneficiaryContact => !!c);
    const truck = selectedTruck;
    const driver = selectedDriver;

    if (!beneficiaryId) {
      setSubmitError(t('transporter.form.beneficiaryRequired'));
      return;
    }
    if (selectedContacts.length === 0) {
      setSubmitError(t('beneficiaryPortal.saved.contactsRequired'));
      return;
    }
    if (!truck || !driver) {
      setSubmitError(t('beneficiaryPortal.saved.selectAllError'));
      return;
    }
    if (!driver.phone?.trim()) {
      setSubmitError(t('beneficiaryPortal.saved.phoneRequired'));
      return;
    }
    if (!form.quality || !form.neededDate) {
      setSubmitError(t('beneficiaryPortal.requiredNote'));
      return;
    }
    const primary = selectedContacts[0];

    const payload: CreateTransporterRequestInput = {
      beneficiaryId,
      requesterName: primary.name,
      requesterPhone: primary.phone ?? '',
      requesterEmail: primary.email,
      truckRegistrationPlate: truck.truckRegistrationPlate,
      trailerRegistrationPlate: truck.trailerRegistrationPlate,
      truckCapacityTons: truck.capacityTons,
      transporterName: truck.transporterName,
      transporterCui: truck.transporterCui,
      transporterAddress: truck.transporterAddress,
      driverName: driver.name,
      driverPhone: driver.phone ?? '',
      driverEmail: driver.email,
      quality: form.quality as CreateTransporterRequestInput['quality'],
      neededDate: form.neededDate,
      unloadingDate: trim(form.unloadingDate),
      destinationAddress: trim(form.destinationAddress),
      destinationLocality: trim(form.destinationLocality),
      notes: trim(form.notes),
      contactIds: selContactIds,
      contactId: primary.id,
      truckId: truck.id,
      driverId: driver.id,
    };

    try {
      await submit.mutateAsync(payload);
      setDone(true);
    } catch {
      setSubmitError(t('beneficiaryPortal.submitError'));
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-sm sm:p-10">
          <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <CheckCircle2 className="h-9 w-9" />
          </span>
          <h2 className="text-xl font-bold text-bark">{t('beneficiaryPortal.successTitle')}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-stone-500">
            {t('beneficiaryPortal.successBody')}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              href={`/${slug}/transport`}
              className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              {t('transporter.form.backToTrips')}
            </Link>
            <button
              type="button"
              onClick={() => {
                setForm(BLANK);
                setSelContactIds([]);
                setSelTruckId(null);
                setSelDriverId(null);
                setDone(false);
              }}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              {t('transporter.form.newAnother')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-bark">
            {t('transporter.newRequestTitle')}
          </h1>
          <p className="mt-1 text-sm text-stone-500">{t('transporter.form.subtitle')}</p>
        </div>

        {/* Beneficiary picker */}
        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          <SectionHeader
            icon={<Building2 className="h-4 w-4" />}
            label={t('transporter.form.beneficiaryLabel')}
          />
          {beneficiariesQuery.isLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-stone-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.loading')}
            </div>
          ) : beneficiaries.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {t('transporter.form.noBeneficiaries')}
            </p>
          ) : (
            <>
              <Field label={t('transporter.form.beneficiaryLabel')} required>
                <select
                  className={inputCls}
                  value={beneficiaryId}
                  onChange={(e) => setBeneficiaryId(e.target.value)}
                >
                  <option value="">{t('transporter.form.beneficiaryPlaceholder')}</option>
                  {beneficiaries.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.displayName} — {b.companyName}
                    </option>
                  ))}
                </select>
              </Field>
              {selectedBeneficiary && (
                <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <LockedField
                    label={t('beneficiaryPortal.companyName')}
                    value={selectedBeneficiary.companyName}
                  />
                  <LockedField
                    label={t('beneficiaryPortal.companyCui')}
                    value={selectedBeneficiary.companyCui}
                  />
                  <div className="sm:col-span-2">
                    <LockedField
                      label={t('beneficiaryPortal.companyAddress')}
                      value={selectedBeneficiary.companyAddress}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {beneficiaryId && (
          <>
            {/* Contacts */}
            <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
              <SectionHeader
                icon={<UserRound className="h-4 w-4" />}
                label={t('beneficiaryPortal.sectionRequester')}
              />
              <SelectedContactsChips
                contacts={selContactIds
                  .map((id) => contacts.find((c) => c.id === id))
                  .filter((c): c is BeneficiaryContact => !!c)}
                onRemove={removeContact}
                onEdit={(c) => setRecordModal({ kind: 'contact', record: c })}
              />
              {selContactIds.length < MAX_CONTACTS ? (
                <BeneficiarySavedSelect
                  placeholder={t('beneficiaryPortal.saved.addContactPlaceholder')}
                  items={contacts.filter((c) => !selContactIds.includes(c.id))}
                  selectedId={null}
                  loading={contactsQuery.isLoading}
                  error={contactsQuery.isError}
                  getPrimary={(c) => c.name}
                  getSecondary={(c) => c.phone ?? c.email}
                  getSearchText={(c) => `${c.name} ${c.phone ?? ''} ${c.email ?? ''}`}
                  onSelect={addContact}
                  onAdd={() => setRecordModal({ kind: 'contact' })}
                  onEdit={(c) => setRecordModal({ kind: 'contact', record: c })}
                  onDelete={(c) => setDeleteTarget({ kind: 'contact', id: c.id, label: c.name })}
                  onRetry={() => void contactsQuery.refetch()}
                />
              ) : (
                <p className="mt-2 text-xs font-medium text-amber-600">
                  {t('beneficiaryPortal.saved.maxContactsReached')}
                </p>
              )}
            </section>

            {/* Truck */}
            <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
              <SectionHeader
                icon={<Truck className="h-4 w-4" />}
                label={t('beneficiaryPortal.sectionTruck')}
              />
              <BeneficiarySavedSelect
                placeholder={t('beneficiaryPortal.saved.selectTruck')}
                items={trucks}
                selectedId={selTruckId}
                loading={trucksQuery.isLoading}
                error={trucksQuery.isError}
                getPrimary={(tk) => tk.truckRegistrationPlate}
                getSecondary={(tk) =>
                  tk.transporterName ??
                  (tk.capacityTons != null ? `${tk.capacityTons * 1000} kg` : null)
                }
                getSearchText={(tk) =>
                  `${tk.truckRegistrationPlate} ${tk.trailerRegistrationPlate ?? ''} ${tk.transporterName ?? ''}`
                }
                onSelect={setSelTruckId}
                onAdd={() => setRecordModal({ kind: 'truck' })}
                onEdit={(tk) => setRecordModal({ kind: 'truck', record: tk })}
                onDelete={(tk) =>
                  setDeleteTarget({ kind: 'truck', id: tk.id, label: tk.truckRegistrationPlate })
                }
                onRetry={() => void trucksQuery.refetch()}
              />
              {selectedTruck && (
                <div className="mt-4">
                  <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                    <LockedField
                      label={t('beneficiaryPortal.truckRegistrationPlate')}
                      value={selectedTruck.truckRegistrationPlate}
                    />
                    <LockedField
                      label={t('beneficiaryPortal.trailerRegistrationPlate')}
                      value={selectedTruck.trailerRegistrationPlate}
                    />
                    <LockedField
                      label={t('beneficiaryPortal.transporterName')}
                      value={selectedTruck.transporterName}
                    />
                    <LockedField
                      label={t('beneficiaryPortal.transporterCui')}
                      value={selectedTruck.transporterCui}
                    />
                    <div className="sm:col-span-2">
                      <LockedField
                        label={t('beneficiaryPortal.transporterAddress')}
                        value={selectedTruck.transporterAddress}
                      />
                    </div>
                  </div>
                  <EditSelectedButton
                    onClick={() => setRecordModal({ kind: 'truck', record: selectedTruck })}
                  />
                </div>
              )}
            </section>

            {/* Driver */}
            <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
              <SectionHeader
                icon={<UserRound className="h-4 w-4" />}
                label={t('beneficiaryPortal.saved.driverLabel')}
              />
              <BeneficiarySavedSelect
                placeholder={t('beneficiaryPortal.saved.selectDriver')}
                items={drivers}
                selectedId={selDriverId}
                loading={driversQuery.isLoading}
                error={driversQuery.isError}
                getPrimary={(d) => d.name}
                getSecondary={(d) => d.phone ?? d.email}
                getSearchText={(d) => `${d.name} ${d.phone ?? ''} ${d.email ?? ''}`}
                onSelect={setSelDriverId}
                onAdd={() => setRecordModal({ kind: 'driver' })}
                onEdit={(d) => setRecordModal({ kind: 'driver', record: d })}
                onDelete={(d) => setDeleteTarget({ kind: 'driver', id: d.id, label: d.name })}
                onRetry={() => void driversQuery.refetch()}
              />
              {selectedDriver && (
                <div className="mt-4">
                  <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                    <LockedField
                      label={t('beneficiaryPortal.driverName')}
                      value={selectedDriver.name}
                    />
                    <LockedField
                      label={t('beneficiaryPortal.driverPhone')}
                      value={selectedDriver.phone}
                    />
                    <div className="sm:col-span-2">
                      <LockedField
                        label={t('beneficiaryPortal.driverEmail')}
                        value={selectedDriver.email}
                      />
                    </div>
                  </div>
                  <EditSelectedButton
                    onClick={() => setRecordModal({ kind: 'driver', record: selectedDriver })}
                  />
                </div>
              )}
            </section>

            {/* Pickup / request details */}
            <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
              <SectionHeader
                icon={<PackageCheck className="h-4 w-4" />}
                label={t('beneficiaryPortal.sectionRequest')}
              />
              <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                <Field label={t('beneficiaryPortal.quality')} required>
                  <select
                    className={inputCls}
                    required
                    value={form.quality}
                    onChange={(e) => patch({ quality: e.target.value })}
                  >
                    <option value="">{t('beneficiaryPortal.qualityPlaceholder')}</option>
                    <option value="quality_1">{t('beneficiaryPortal.quality1')}</option>
                    <option value="quality_2">{t('beneficiaryPortal.quality2')}</option>
                  </select>
                </Field>
                <Field label={t('beneficiaryPortal.neededDate')} required>
                  <input
                    type="date"
                    className={inputCls}
                    required
                    value={form.neededDate}
                    onChange={(e) => patch({ neededDate: e.target.value })}
                  />
                </Field>
                <Field label={t('transporter.form.unloadingDate')} optional>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.unloadingDate}
                    onChange={(e) => patch({ unloadingDate: e.target.value })}
                  />
                </Field>
                <Field label={t('beneficiaryPortal.destinationLocality')} optional>
                  <input
                    className={inputCls}
                    value={form.destinationLocality}
                    onChange={(e) => patch({ destinationLocality: e.target.value })}
                    placeholder={t('beneficiaryPortal.destinationLocalityPlaceholder')}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label={t('beneficiaryPortal.destinationAddress')} optional>
                    <input
                      className={inputCls}
                      value={form.destinationAddress}
                      onChange={(e) => patch({ destinationAddress: e.target.value })}
                      placeholder={t('beneficiaryPortal.destinationAddressPlaceholder')}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label={t('beneficiaryPortal.notes')} optional>
                    <textarea
                      className={inputCls}
                      rows={3}
                      value={form.notes}
                      onChange={(e) => patch({ notes: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            </section>

            <div className="flex flex-col gap-3 pt-1">
              <p className="text-xs text-stone-400">{t('beneficiaryPortal.requiredNote')}</p>
              {submitError && (
                <p className="text-sm font-medium text-rose-600" role="alert">
                  {submitError}
                </p>
              )}
              <button
                type="submit"
                disabled={submit.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {submit.isPending
                  ? t('beneficiaryPortal.submitting')
                  : t('beneficiaryPortal.submit')}
              </button>
            </div>
          </>
        )}
      </form>

      {recordModal && (
        <TransporterRecordModal
          kind={recordModal.kind}
          record={recordModal.record}
          beneficiaryId={beneficiaryId}
          onSaved={handleSaved}
          onClose={() => setRecordModal(null)}
        />
      )}
      {deleteTarget && (
        <TransporterRecordDeleteDialog
          kind={deleteTarget.kind}
          recordId={deleteTarget.id}
          recordLabel={deleteTarget.label}
          beneficiaryId={beneficiaryId}
          onDeleted={handleDeleted}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
