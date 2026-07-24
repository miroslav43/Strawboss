'use client';

import { useState } from 'react';
import { X, Check, Loader2, XCircle } from 'lucide-react';
import {
  useCreateTransporterRecord,
  useUpdateTransporterRecord,
  type TransporterRecordKind,
} from '@strawboss/api';
import type { BeneficiaryContact, BeneficiaryTruck, BeneficiaryDriver } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { apiClient } from '@/lib/api';
import type { RecordKind } from '@/app/[slug]/request/[beneficiarySlug]/BeneficiaryRecordModal';

type AnyRecord = BeneficiaryContact | BeneficiaryTruck | BeneficiaryDriver;

const KIND_PATH: Record<RecordKind, TransporterRecordKind> = {
  contact: 'contacts',
  truck: 'trucks',
  driver: 'drivers',
};

// Every truck in this fleet is a fixed 40000 kg (40 t) — parity with the portal.
const TRUCK_CAPACITY_TONS = 40000 / 1000;

const LABELS: Record<'contact' | 'driver', { name: string; phone: string; email: string }> = {
  contact: {
    name: 'beneficiaryPortal.requesterName',
    phone: 'beneficiaryPortal.requesterPhone',
    email: 'beneficiaryPortal.requesterEmail',
  },
  driver: {
    name: 'beneficiaryPortal.driverName',
    phone: 'beneficiaryPortal.driverPhone',
    email: 'beneficiaryPortal.driverEmail',
  },
};

const inputCls =
  'w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-[15px] text-bark ' +
  'placeholder:text-stone-400 shadow-sm transition-colors ' +
  'focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15';

/**
 * Authenticated copy of the portal's BeneficiaryRecordModal. Identical UI/UX; the
 * only difference is that saving goes through the transporter's authenticated
 * hooks (scoped server-side by assertAssigned) instead of the daily-PIN fetch. The
 * portal component is left untouched.
 */
export function TransporterRecordModal({
  kind,
  record,
  beneficiaryId,
  onSaved,
  onClose,
}: {
  kind: RecordKind;
  record?: AnyRecord;
  beneficiaryId: string;
  onSaved: (rec: AnyRecord) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const isEdit = !!record;
  const createRecord = useCreateTransporterRecord(apiClient);
  const updateRecord = useUpdateTransporterRecord(apiClient);

  const contactLike =
    kind !== 'truck' ? (record as BeneficiaryContact | BeneficiaryDriver) : undefined;
  const truck = kind === 'truck' ? (record as BeneficiaryTruck) : undefined;

  const [name, setName] = useState(contactLike?.name ?? '');
  const [phone, setPhone] = useState(contactLike?.phone ?? '');
  const [email, setEmail] = useState(contactLike?.email ?? '');
  const [plate, setPlate] = useState(truck?.truckRegistrationPlate ?? '');
  const [trailer, setTrailer] = useState(truck?.trailerRegistrationPlate ?? '');
  const [transporterName, setTransporterName] = useState(truck?.transporterName ?? '');
  const [transporterCui, setTransporterCui] = useState(truck?.transporterCui ?? '');
  const [transporterAddress, setTransporterAddress] = useState(truck?.transporterAddress ?? '');

  const [error, setError] = useState<string | null>(null);
  const saving = createRecord.isPending || updateRecord.isPending;

  const canSave =
    kind === 'truck'
      ? plate.trim() !== '' &&
        trailer.trim() !== '' &&
        transporterName.trim() !== '' &&
        transporterCui.trim() !== '' &&
        transporterAddress.trim() !== ''
      : name.trim() !== '' && phone.trim() !== '';

  const titleKey = isEdit
    ? `beneficiaryPortal.saved.edit${kind[0].toUpperCase()}${kind.slice(1)}Title`
    : `beneficiaryPortal.saved.create${kind[0].toUpperCase()}${kind.slice(1)}Title`;

  function buildFields(): Record<string, unknown> {
    if (kind === 'truck') {
      return {
        truckRegistrationPlate: plate.trim(),
        trailerRegistrationPlate: trailer.trim(),
        capacityTons: TRUCK_CAPACITY_TONS,
        transporterName: transporterName.trim(),
        transporterCui: transporterCui.trim(),
        transporterAddress: transporterAddress.trim(),
      };
    }
    return { name: name.trim(), phone: phone.trim(), email: email.trim() || null };
  }

  async function handleSubmit() {
    if (!canSave) return;
    setError(null);
    if (kind !== 'truck') {
      if (phone.trim().length < 4) {
        setError(t('beneficiaryPortal.saved.phoneInvalid'));
        return;
      }
      const em = email.trim();
      if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        setError(t('beneficiaryPortal.saved.emailInvalid'));
        return;
      }
    }
    const data = buildFields();
    const pluralKind = KIND_PATH[kind];
    try {
      const rec = (
        isEdit
          ? await updateRecord.mutateAsync({
              beneficiaryId,
              kind: pluralKind,
              id: record!.id,
              data,
            })
          : await createRecord.mutateAsync({ beneficiaryId, kind: pluralKind, data })
      ) as AnyRecord;
      onSaved(rec);
    } catch {
      setError(t('beneficiaryPortal.saved.saveError'));
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        style={{ maxHeight: 'min(90vh, 700px)' }}
      >
        <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
          <h2 className="text-base font-semibold text-bark">{t(titleKey)}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
          className="flex-1 space-y-4 overflow-y-auto px-6 py-5"
        >
          {kind === 'truck' ? (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-stone-600">
                  {t('beneficiaryPortal.truckRegistrationPlate')}
                  <span className="ml-0.5 text-rose-500">*</span>
                </span>
                <input
                  className={inputCls}
                  value={plate}
                  onChange={(e) => setPlate(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-stone-600">
                    {t('beneficiaryPortal.trailerRegistrationPlate')}
                    <span className="ml-0.5 text-rose-500">*</span>
                  </span>
                  <input
                    className={inputCls}
                    value={trailer}
                    onChange={(e) => setTrailer(e.target.value)}
                    required
                  />
                </label>
                <div className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-stone-600">
                    {t('beneficiaryPortal.truckCapacity')}
                  </span>
                  <p className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-[15px] font-medium text-stone-500">
                    {t('beneficiaryPortal.truckCapacityFixed')}
                  </p>
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-stone-600">
                  {t('beneficiaryPortal.transporterName')}
                  <span className="ml-0.5 text-rose-500">*</span>
                </span>
                <input
                  className={inputCls}
                  value={transporterName}
                  onChange={(e) => setTransporterName(e.target.value)}
                  required
                />
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-stone-600">
                    {t('beneficiaryPortal.transporterCui')}
                    <span className="ml-0.5 text-rose-500">*</span>
                  </span>
                  <input
                    className={inputCls}
                    value={transporterCui}
                    onChange={(e) => setTransporterCui(e.target.value)}
                    required
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-stone-600">
                    {t('beneficiaryPortal.transporterAddress')}
                    <span className="ml-0.5 text-rose-500">*</span>
                  </span>
                  <input
                    className={inputCls}
                    value={transporterAddress}
                    onChange={(e) => setTransporterAddress(e.target.value)}
                    required
                  />
                </label>
              </div>
            </>
          ) : (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-stone-600">
                  {t(LABELS[kind].name)}
                  <span className="ml-0.5 text-rose-500">*</span>
                </span>
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-stone-600">
                  {t(LABELS[kind].phone)}
                  <span className="ml-0.5 text-rose-500">*</span>
                </span>
                <input
                  className={inputCls}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-stone-600">
                  {t(LABELS[kind].email)}
                </span>
                <input
                  type="email"
                  className={inputCls}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            </>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
              <XCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
            >
              {t('beneficiaryPortal.saved.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving || !canSave}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {saving ? t('beneficiaryPortal.saved.saving') : t('beneficiaryPortal.saved.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
