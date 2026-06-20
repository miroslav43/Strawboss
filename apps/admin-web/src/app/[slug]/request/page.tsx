'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { CropType } from '@strawboss/types';
import type { PortalInfo, CreateTripRequestDto } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

type FormState = {
  requesterName: string;
  requesterPhone: string;
  requesterEmail: string;
  companyName: string;
  companyAddress: string;
  companyCui: string;
  truckRegistrationPlate: string;
  truckMake: string;
  truckModel: string;
  truckCapacityTons: string;
  driverName: string;
  driverPhone: string;
  driverEmail: string;
  cropType: string;
  neededDate: string;
  tonsRequested: string;
  destinationAddress: string;
  destinationLocality: string;
  notes: string;
};

const BLANK: FormState = {
  requesterName: '',
  requesterPhone: '',
  requesterEmail: '',
  companyName: '',
  companyAddress: '',
  companyCui: '',
  truckRegistrationPlate: '',
  truckMake: '',
  truckModel: '',
  truckCapacityTons: '',
  driverName: '',
  driverPhone: '',
  driverEmail: '',
  cropType: '',
  neededDate: '',
  tonsRequested: '',
  destinationAddress: '',
  destinationLocality: '',
  notes: '',
};

function toDto(f: FormState): CreateTripRequestDto {
  const trim = (s: string) => (s.trim() === '' ? null : s.trim());
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
  return {
    requesterName: f.requesterName.trim(),
    requesterPhone: f.requesterPhone.trim(),
    requesterEmail: trim(f.requesterEmail),
    companyName: trim(f.companyName),
    companyAddress: trim(f.companyAddress),
    companyCui: trim(f.companyCui),
    truckRegistrationPlate: f.truckRegistrationPlate.trim(),
    truckMake: trim(f.truckMake),
    truckModel: trim(f.truckModel),
    truckCapacityTons: numOrNull(f.truckCapacityTons),
    driverName: f.driverName.trim(),
    driverPhone: f.driverPhone.trim(),
    driverEmail: trim(f.driverEmail),
    cropType: f.cropType ? (f.cropType as CropType) : null,
    neededDate: trim(f.neededDate),
    tonsRequested: numOrNull(f.tonsRequested),
    destinationAddress: trim(f.destinationAddress),
    destinationLocality: trim(f.destinationLocality),
    notes: trim(f.notes),
  };
}

export default function RequestPortalPage() {
  const { t } = useI18n();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [code, setCode] = useState('');
  const [portal, setPortal] = useState<PortalInfo | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(BLANK);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const patch = (p: Partial<FormState>) => setForm((s) => ({ ...s, ...p }));

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setCodeError(null);
    if (!/^\d{4}$/.test(code)) {
      setCodeError(t('portal.codeInvalid'));
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch(`/api/v1/public/portal/${slug}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setCodeError(res.status === 403 ? t('portal.codeInvalid') : t('portal.codeError'));
        return;
      }
      setPortal((await res.json()) as PortalInfo);
    } catch {
      setCodeError(t('portal.codeError'));
    } finally {
      setVerifying(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/v1/public/portal/${slug}/requests?code=${encodeURIComponent(code)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toDto(form)),
        },
      );
      if (!res.ok) {
        setSubmitError(t('portal.submitError'));
        return;
      }
      setDone(true);
    } catch {
      setSubmitError(t('portal.submitError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-neutral-50 px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900">
        {portal ? portal.organizationName : t('portal.title')}
      </h1>

      {done ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-green-600" />
          <h2 className="text-lg font-semibold text-green-800">{t('portal.successTitle')}</h2>
          <p className="mt-2 text-sm text-green-700">{t('portal.successBody')}</p>
        </div>
      ) : !portal ? (
        <form onSubmit={verify} className="rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-neutral-900">{t('portal.step1Title')}</h2>
          <p className="mb-4 mt-1 text-sm text-neutral-500">{t('portal.step1Hint')}</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder={t('portal.codePlaceholder')}
            className={`${inputCls} text-center text-2xl tracking-[0.5em]`}
          />
          {codeError && <p className="mt-2 text-sm text-red-600">{codeError}</p>}
          <button
            type="submit"
            disabled={verifying}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {verifying && <Loader2 className="h-4 w-4 animate-spin" />}
            {verifying ? t('portal.verifying') : t('portal.codeSubmit')}
          </button>
        </form>
      ) : (
        <form onSubmit={submit} className="space-y-6">
          <p className="text-sm text-neutral-500">{t('portal.step2Subtitle')}</p>
          <p className="text-xs text-neutral-400">{t('portal.requiredNote')}</p>

          <section className="grid grid-cols-1 gap-4 rounded-xl border border-neutral-200 bg-white p-6 sm:grid-cols-2">
            <Field label={t('portal.requesterName')} required>
              <input
                className={inputCls}
                value={form.requesterName}
                onChange={(e) => patch({ requesterName: e.target.value })}
              />
            </Field>
            <Field label={t('portal.requesterPhone')} required>
              <input
                className={inputCls}
                value={form.requesterPhone}
                onChange={(e) => patch({ requesterPhone: e.target.value })}
              />
            </Field>
            <Field label={t('portal.requesterEmail')}>
              <input
                type="email"
                className={inputCls}
                value={form.requesterEmail}
                onChange={(e) => patch({ requesterEmail: e.target.value })}
              />
            </Field>
            <Field label={t('portal.companyName')}>
              <input
                className={inputCls}
                value={form.companyName}
                onChange={(e) => patch({ companyName: e.target.value })}
              />
            </Field>
            <Field label={t('portal.companyAddress')}>
              <input
                className={inputCls}
                value={form.companyAddress}
                onChange={(e) => patch({ companyAddress: e.target.value })}
              />
            </Field>
            <Field label={t('portal.companyCui')}>
              <input
                className={inputCls}
                value={form.companyCui}
                onChange={(e) => patch({ companyCui: e.target.value })}
              />
            </Field>
          </section>

          <section className="grid grid-cols-1 gap-4 rounded-xl border border-neutral-200 bg-white p-6 sm:grid-cols-2">
            <Field label={t('portal.truckRegistrationPlate')} required>
              <input
                className={inputCls}
                value={form.truckRegistrationPlate}
                onChange={(e) => patch({ truckRegistrationPlate: e.target.value })}
              />
            </Field>
            <Field label={t('portal.truckCapacityTons')}>
              <input
                type="number"
                min="0"
                step="0.1"
                className={inputCls}
                value={form.truckCapacityTons}
                onChange={(e) => patch({ truckCapacityTons: e.target.value })}
              />
            </Field>
            <Field label={t('portal.truckMake')}>
              <input
                className={inputCls}
                value={form.truckMake}
                onChange={(e) => patch({ truckMake: e.target.value })}
              />
            </Field>
            <Field label={t('portal.truckModel')}>
              <input
                className={inputCls}
                value={form.truckModel}
                onChange={(e) => patch({ truckModel: e.target.value })}
              />
            </Field>
            <Field label={t('portal.driverName')} required>
              <input
                className={inputCls}
                value={form.driverName}
                onChange={(e) => patch({ driverName: e.target.value })}
              />
            </Field>
            <Field label={t('portal.driverPhone')} required>
              <input
                className={inputCls}
                value={form.driverPhone}
                onChange={(e) => patch({ driverPhone: e.target.value })}
              />
            </Field>
            <Field label={t('portal.driverEmail')}>
              <input
                type="email"
                className={inputCls}
                value={form.driverEmail}
                onChange={(e) => patch({ driverEmail: e.target.value })}
              />
            </Field>
          </section>

          <section className="grid grid-cols-1 gap-4 rounded-xl border border-neutral-200 bg-white p-6 sm:grid-cols-2">
            <Field label={t('portal.cropType')}>
              <select
                className={inputCls}
                value={form.cropType}
                onChange={(e) => patch({ cropType: e.target.value })}
              >
                <option value="">{t('portal.cropTypePlaceholder')}</option>
                {portal.allowedCropTypes.map((c) => (
                  <option key={c} value={c}>
                    {t(`settings.organization.crop.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('portal.tonsRequested')}>
              <input
                type="number"
                min="0"
                step="0.1"
                className={inputCls}
                value={form.tonsRequested}
                onChange={(e) => patch({ tonsRequested: e.target.value })}
              />
            </Field>
            <Field label={t('portal.neededDate')}>
              <input
                type="date"
                className={inputCls}
                value={form.neededDate}
                onChange={(e) => patch({ neededDate: e.target.value })}
              />
            </Field>
            <Field label={t('portal.destinationLocality')}>
              <input
                className={inputCls}
                value={form.destinationLocality}
                onChange={(e) => patch({ destinationLocality: e.target.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('portal.destinationAddress')}>
                <input
                  className={inputCls}
                  value={form.destinationAddress}
                  onChange={(e) => patch({ destinationAddress: e.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label={t('portal.notes')}>
                <textarea
                  className={inputCls}
                  rows={3}
                  value={form.notes}
                  onChange={(e) => patch({ notes: e.target.value })}
                />
              </Field>
            </div>
          </section>

          {submitError && <p className="text-sm text-red-600">{submitError}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? t('portal.submitting') : t('portal.submit')}
          </button>
        </form>
      )}
    </div>
  );
}
