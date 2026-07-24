'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Building2, Save, CheckCircle2 } from 'lucide-react';
import {
  useTransporterBeneficiaries,
  useBeneficiaryOrderSettings,
  useSaveBeneficiaryOrderSettings,
  type AssignedBeneficiary,
} from '@strawboss/api';
import type { BeneficiaryOrderSettingsInput } from '@strawboss/validation';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const inputCls =
  'w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-[15px] text-bark ' +
  'placeholder:text-stone-400 shadow-sm transition-colors ' +
  'focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15';

type FormState = {
  transportValue: string;
  currency: string;
  paymentTermDays: string;
  baleCount: string;
  baleDimensions: string;
  goodsName: string;
  truckDescription: string;
  loadingLocality: string;
  loadingCountry: string;
  obs: string;
};
const BLANK: FormState = {
  transportValue: '',
  currency: 'EUR',
  paymentTermDays: '30',
  baleCount: '',
  baleDimensions: '',
  goodsName: '',
  truckDescription: '',
  loadingLocality: '',
  loadingCountry: '',
  obs: '',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-stone-600">{label}</span>
      {children}
    </label>
  );
}

/**
 * The transporter configures, per assigned beneficiary, the "comandă" (transport
 * order) fields that don't exist on a trip: price, payment term, standard bale
 * count/dimensions, goods, truck description, loading place, OBS. These merge with
 * each request's data to auto-generate the order PDF.
 */
export default function TransporterBeneficiariesPage() {
  const { t } = useI18n();
  const beneficiariesQuery = useTransporterBeneficiaries(apiClient);
  const beneficiaries: AssignedBeneficiary[] = useMemo(
    () => (Array.isArray(beneficiariesQuery.data) ? beneficiariesQuery.data : []),
    [beneficiariesQuery.data],
  );

  const [beneficiaryId, setBeneficiaryId] = useState<string>('');
  const settingsQuery = useBeneficiaryOrderSettings(apiClient, beneficiaryId || null);
  const save = useSaveBeneficiaryOrderSettings(apiClient);

  const [form, setForm] = useState<FormState>(BLANK);
  const [seeded, setSeeded] = useState(false);
  const [saved, setSaved] = useState(false);
  const patch = (p: Partial<FormState>) => {
    setForm((s) => ({ ...s, ...p }));
    setSaved(false);
  };

  // Reset the seed flag whenever the selected beneficiary changes.
  useEffect(() => {
    setSeeded(false);
    setSaved(false);
  }, [beneficiaryId]);

  // Seed the form from the loaded settings (or defaults) once per beneficiary.
  useEffect(() => {
    if (seeded || !beneficiaryId || settingsQuery.isLoading) return;
    const s = settingsQuery.data;
    setForm(
      s
        ? {
            transportValue: s.transportValue != null ? String(s.transportValue) : '',
            currency: s.currency ?? 'EUR',
            paymentTermDays: s.paymentTermDays != null ? String(s.paymentTermDays) : '30',
            baleCount: s.baleCount != null ? String(s.baleCount) : '',
            baleDimensions: s.baleDimensions ?? '',
            goodsName: s.goodsName ?? '',
            truckDescription: s.truckDescription ?? '',
            loadingLocality: s.loadingLocality ?? '',
            loadingCountry: s.loadingCountry ?? '',
            obs: s.obs ?? '',
          }
        : BLANK,
    );
    setSeeded(true);
  }, [seeded, beneficiaryId, settingsQuery.isLoading, settingsQuery.data]);

  const numOrNull = (v: string): number | null => {
    const n = Number(v);
    return v.trim() === '' || Number.isNaN(n) ? null : n;
  };
  const strOrNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

  function handleSave() {
    if (!beneficiaryId) return;
    const data: BeneficiaryOrderSettingsInput = {
      transportValue: numOrNull(form.transportValue),
      currency: form.currency.trim() || 'EUR',
      paymentTermDays: numOrNull(form.paymentTermDays) ?? 30,
      baleCount: numOrNull(form.baleCount),
      baleDimensions: strOrNull(form.baleDimensions),
      goodsName: strOrNull(form.goodsName),
      truckDescription: strOrNull(form.truckDescription),
      loadingLocality: strOrNull(form.loadingLocality),
      loadingCountry: strOrNull(form.loadingCountry),
      obs: strOrNull(form.obs),
    };
    save.mutate({ beneficiaryId, data }, { onSuccess: () => setSaved(true) });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-bark">
          {t('transporter.beneficiaries.title')}
        </h1>
        <p className="mt-1 text-sm text-stone-500">{t('transporter.beneficiaries.subtitle')}</p>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
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
          <Field label={t('transporter.form.beneficiaryLabel')}>
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
        )}
      </section>

      {beneficiaryId && (
        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" />
            </span>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
              {t('transporter.beneficiaries.orderSection')}
            </h2>
          </div>

          {settingsQuery.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-stone-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.loading')}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                <Field label={t('transporter.beneficiaries.transportValue')}>
                  <input
                    type="number"
                    inputMode="decimal"
                    className={inputCls}
                    value={form.transportValue}
                    onChange={(e) => patch({ transportValue: e.target.value })}
                    placeholder="680"
                  />
                </Field>
                <Field label={t('transporter.beneficiaries.currency')}>
                  <input
                    className={inputCls}
                    value={form.currency}
                    onChange={(e) => patch({ currency: e.target.value })}
                    placeholder="EUR"
                  />
                </Field>
                <Field label={t('transporter.beneficiaries.paymentTermDays')}>
                  <input
                    type="number"
                    inputMode="numeric"
                    className={inputCls}
                    value={form.paymentTermDays}
                    onChange={(e) => patch({ paymentTermDays: e.target.value })}
                    placeholder="30"
                  />
                </Field>
                <Field label={t('transporter.beneficiaries.goodsName')}>
                  <input
                    className={inputCls}
                    value={form.goodsName}
                    onChange={(e) => patch({ goodsName: e.target.value })}
                    placeholder="PAIE"
                  />
                </Field>
                <Field label={t('transporter.beneficiaries.baleCount')}>
                  <input
                    type="number"
                    inputMode="numeric"
                    className={inputCls}
                    value={form.baleCount}
                    onChange={(e) => patch({ baleCount: e.target.value })}
                    placeholder="33"
                  />
                </Field>
                <Field label={t('transporter.beneficiaries.baleDimensions')}>
                  <input
                    className={inputCls}
                    value={form.baleDimensions}
                    onChange={(e) => patch({ baleDimensions: e.target.value })}
                    placeholder="240X120X90"
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label={t('transporter.beneficiaries.truckDescription')}>
                    <input
                      className={inputCls}
                      value={form.truckDescription}
                      onChange={(e) => patch({ truckDescription: e.target.value })}
                      placeholder="CAMION CU REMORCA MEGA/VARIO"
                    />
                  </Field>
                </div>
                <Field label={t('transporter.beneficiaries.loadingLocality')}>
                  <input
                    className={inputCls}
                    value={form.loadingLocality}
                    onChange={(e) => patch({ loadingLocality: e.target.value })}
                    placeholder="TIMIS"
                  />
                </Field>
                <Field label={t('transporter.beneficiaries.loadingCountry')}>
                  <input
                    className={inputCls}
                    value={form.loadingCountry}
                    onChange={(e) => patch({ loadingCountry: e.target.value })}
                    placeholder="RO"
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label={t('transporter.beneficiaries.obs')}>
                    <textarea
                      className={inputCls}
                      rows={2}
                      value={form.obs}
                      onChange={(e) => patch({ obs: e.target.value })}
                      placeholder="Actele în original se vor trimite la adresa: NU"
                    />
                  </Field>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-end gap-3">
                {saved && (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
                    <CheckCircle2 className="h-4 w-4" />
                    {t('transporter.beneficiaries.saved')}
                  </span>
                )}
                {save.isError && (
                  <span className="text-sm text-rose-600">
                    {(save.error as Error)?.message ?? t('accounts.assign.errorSave')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={save.isPending}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {save.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t('transporter.beneficiaries.save')}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
