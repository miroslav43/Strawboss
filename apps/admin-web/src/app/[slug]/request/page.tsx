'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Loader2,
  CheckCircle2,
  ShieldCheck,
  KeyRound,
  SendHorizonal,
  UserRound,
  Truck,
  PackageCheck,
} from 'lucide-react';
import { CropType } from '@strawboss/types';
import type { PortalInfo, CreateTripRequestDto } from '@strawboss/types';
import { useI18n, normalizeUiLocale, type Locale } from '@/lib/i18n';

const TRACTOR = '/brand/strawboss-tractor.svg';

const inputCls =
  'w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-[15px] text-bark ' +
  'placeholder:text-stone-400 shadow-sm transition-colors ' +
  'focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15';

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
          <span className="ml-1 font-normal text-stone-400">({t('portal.optional')})</span>
        )}
      </span>
      {children}
    </label>
  );
}

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

type FormState = {
  requesterName: string;
  requesterPhone: string;
  requesterEmail: string;
  companyName: string;
  companyAddress: string;
  companyCui: string;
  truckRegistrationPlate: string;
  truckModel: string;
  truckCapacityTons: string;
  driverName: string;
  driverPhone: string;
  driverEmail: string;
  cropType: string;
  neededDate: string;
  tonsRequested: string;
  destinationAddress: string;
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
  truckModel: '',
  truckCapacityTons: '',
  driverName: '',
  driverPhone: '',
  driverEmail: '',
  cropType: '',
  neededDate: '',
  tonsRequested: '',
  destinationAddress: '',
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
    truckModel: trim(f.truckModel),
    truckCapacityTons: numOrNull(f.truckCapacityTons),
    driverName: f.driverName.trim(),
    driverPhone: f.driverPhone.trim(),
    driverEmail: trim(f.driverEmail),
    cropType: f.cropType ? (f.cropType as CropType) : null,
    neededDate: trim(f.neededDate),
    tonsRequested: numOrNull(f.tonsRequested),
    destinationAddress: trim(f.destinationAddress),
    notes: trim(f.notes),
  };
}

/** Left brand panel — full-height on desktop, a compact band on mobile. */
function BrandPanel({ orgName, t }: { orgName: string | null; t: (k: string) => string }) {
  return (
    <aside className="relative isolate overflow-hidden bg-gradient-to-b from-forest to-forest-deep text-cream lg:sticky lg:top-0 lg:h-screen">
      {/* field-rows motif + warm glow + bottom vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(120% 85% at 88% -12%, rgba(230,201,156,0.22), transparent 55%),' +
            'linear-gradient(to top, rgba(7,40,23,0.55), transparent 45%),' +
            'repeating-linear-gradient(118deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 26px)',
        }}
      />
      {/* oversized tractor watermark */}
      <img
        src={TRACTOR}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -bottom-10 -right-8 hidden w-72 opacity-[0.07] lg:block"
      />

      <div className="relative z-10 flex h-full flex-col justify-between gap-8 p-6 sm:p-10 lg:p-12">
        {/* brand */}
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cream/10 ring-1 ring-cream/20 backdrop-blur-sm">
            <img src={TRACTOR} alt="" width={28} height={28} className="h-7 w-7" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-straw">
              {t('portal.brandEyebrow')}
            </p>
            <p className="text-base font-semibold text-cream">{orgName ?? t('portal.title')}</p>
          </div>
        </div>

        {/* headline + trust (desktop-rich, compact on mobile) */}
        <div className="max-w-md">
          <h1 className="text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-[2.75rem]">
            {t('portal.heroHeadline')}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-cream/80 sm:text-base">
            {t('portal.heroSub')}
          </p>

          <ul className="mt-8 hidden space-y-3.5 lg:block">
            {[
              { icon: <ShieldCheck className="h-4 w-4" />, label: t('portal.trust1') },
              { icon: <KeyRound className="h-4 w-4" />, label: t('portal.trust2') },
              { icon: <SendHorizonal className="h-4 w-4" />, label: t('portal.trust3') },
            ].map((row) => (
              <li key={row.label} className="flex items-center gap-3 text-sm text-cream/90">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-cream/10 text-straw ring-1 ring-cream/15">
                  {row.icon}
                </span>
                {row.label}
              </li>
            ))}
          </ul>
        </div>

        <p className="hidden text-[11px] font-medium uppercase tracking-[0.16em] text-cream/40 lg:block">
          {t('portal.poweredBy')}
        </p>
      </div>
    </aside>
  );
}

function LangToggle({ locale, onPick }: { locale: Locale; onPick: (l: Locale) => void }) {
  return (
    <div className="inline-flex items-center rounded-full border border-stone-200 bg-white/80 p-0.5 text-xs font-semibold shadow-sm backdrop-blur">
      {(['ro', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onPick(l)}
          aria-pressed={locale === l}
          className={`rounded-full px-3 py-1 uppercase tracking-wide transition-colors ${
            locale === l ? 'bg-primary text-white' : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export default function RequestPortalPage() {
  const { t, locale, setLocale } = useI18n();
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

  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);

  const patch = (p: Partial<FormState>) => setForm((s) => ({ ...s, ...p }));

  // Auto-detect the visitor's language on first visit (no stored choice yet).
  // persist:false keeps it a soft default — an explicit toggle still wins/persists.
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && !localStorage.getItem('strawboss-locale')) {
        setLocale(normalizeUiLocale(navigator.language), { persist: false });
      }
    } catch {
      /* ignore storage/SSR access errors */
    }
  }, [setLocale]);

  function setDigit(i: number, raw: string) {
    const d = raw.replace(/\D/g, '').slice(-1);
    const arr = code.split('');
    while (arr.length < 4) arr.push('');
    arr[i] = d;
    setCode(arr.join('').slice(0, 4));
    if (d && i < 3) codeRefs.current[i + 1]?.focus();
  }

  function onCodeKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[i] && i > 0) {
      e.preventDefault();
      codeRefs.current[i - 1]?.focus();
    }
  }

  function onCodePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (!digits) return;
    e.preventDefault();
    setCode(digits);
    codeRefs.current[Math.min(digits.length, 3)]?.focus();
  }

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
      const res = await fetch(`/api/v1/public/portal/${slug}/requests`, {
        method: 'POST',
        // Code travels in the body (not the URL) so it never lands in logs.
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...toDto(form), code }),
      });
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

  const showForm = !!portal && !done;

  return (
    <div className="min-h-screen bg-cream text-bark lg:grid lg:grid-cols-[minmax(0,38%)_minmax(0,1fr)]">
      <BrandPanel orgName={portal?.organizationName ?? null} t={t} />

      <main className="relative flex min-h-screen flex-col">
        <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
          <LangToggle locale={locale} onPick={(l) => setLocale(l)} />
        </div>

        <div
          className={`mx-auto flex w-full max-w-xl flex-1 flex-col px-5 pb-12 pt-20 sm:px-8 lg:pt-16 ${
            showForm ? 'justify-start' : 'lg:justify-center'
          }`}
        >
          {done ? (
            // ── Success ───────────────────────────────────────────────
            <div className="portal-rise rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-sm sm:p-10">
              <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <CheckCircle2 className="h-9 w-9" />
              </span>
              <h2 className="text-xl font-bold text-bark">{t('portal.successTitle')}</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-stone-500">
                {t('portal.successBody')}
              </p>
            </div>
          ) : !portal ? (
            // ── Step 1: access code ───────────────────────────────────
            <form
              onSubmit={verify}
              className="portal-rise rounded-3xl border border-stone-200 bg-white p-7 shadow-sm sm:p-9"
            >
              <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <KeyRound className="h-5 w-5" />
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-bark">
                {t('portal.step1Title')}
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-stone-500">
                {t('portal.step1Hint')}
              </p>

              <div
                className="mt-7 flex justify-between gap-2.5 sm:gap-3"
                role="group"
                aria-label={t('portal.step1Title')}
              >
                {[0, 1, 2, 3].map((i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      codeRefs.current[i] = el;
                    }}
                    value={code[i] ?? ''}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => onCodeKeyDown(i, e)}
                    onPaste={onCodePaste}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={1}
                    aria-label={`${t('portal.step1Title')} ${i + 1}`}
                    autoFocus={i === 0}
                    className={`h-16 w-full rounded-2xl border-2 bg-white text-center text-2xl font-bold text-bark shadow-sm outline-none transition-all sm:h-[4.5rem] ${
                      code[i] ? 'border-primary' : 'border-stone-300'
                    } focus:border-primary focus:ring-4 focus:ring-primary/15`}
                  />
                ))}
              </div>

              {codeError && (
                <p className="mt-3 text-sm font-medium text-rose-600" role="alert">
                  {codeError}
                </p>
              )}

              <button
                type="submit"
                disabled={verifying || code.length < 4}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {verifying && <Loader2 className="h-4 w-4 animate-spin" />}
                {verifying ? t('portal.verifying') : t('portal.codeSubmit')}
              </button>
            </form>
          ) : (
            // ── Step 2: request form ──────────────────────────────────
            <form onSubmit={submit} className="portal-rise space-y-5">
              <div className="mb-1">
                <h1 className="text-2xl font-bold tracking-tight text-bark sm:text-[1.7rem]">
                  {t('portal.step2Title')}
                </h1>
                <p className="mt-1 text-sm text-stone-500">{t('portal.step2Subtitle')}</p>
              </div>

              <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
                <SectionHeader
                  icon={<UserRound className="h-4 w-4" />}
                  label={t('portal.sectionRequester')}
                />
                <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                  <Field label={t('portal.requesterName')} required>
                    <input
                      className={inputCls}
                      required
                      value={form.requesterName}
                      onChange={(e) => patch({ requesterName: e.target.value })}
                    />
                  </Field>
                  <Field label={t('portal.requesterPhone')} required>
                    <input
                      className={inputCls}
                      required
                      value={form.requesterPhone}
                      onChange={(e) => patch({ requesterPhone: e.target.value })}
                    />
                  </Field>
                  <Field label={t('portal.requesterEmail')} required>
                    <input
                      type="email"
                      className={inputCls}
                      required
                      value={form.requesterEmail}
                      onChange={(e) => patch({ requesterEmail: e.target.value })}
                    />
                  </Field>
                  <Field label={t('portal.companyName')} required>
                    <input
                      className={inputCls}
                      required
                      value={form.companyName}
                      onChange={(e) => patch({ companyName: e.target.value })}
                    />
                  </Field>
                  <Field label={t('portal.companyAddress')} required>
                    <input
                      className={inputCls}
                      required
                      value={form.companyAddress}
                      onChange={(e) => patch({ companyAddress: e.target.value })}
                    />
                  </Field>
                  <Field label={t('portal.companyCui')} required>
                    <input
                      className={inputCls}
                      required
                      value={form.companyCui}
                      onChange={(e) => patch({ companyCui: e.target.value })}
                    />
                  </Field>
                </div>
              </section>

              <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
                <SectionHeader
                  icon={<Truck className="h-4 w-4" />}
                  label={t('portal.sectionTruck')}
                />
                <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                  <Field label={t('portal.truckRegistrationPlate')} required>
                    <input
                      className={inputCls}
                      required
                      value={form.truckRegistrationPlate}
                      onChange={(e) => patch({ truckRegistrationPlate: e.target.value })}
                    />
                  </Field>
                  <Field label={t('portal.truckCapacityTons')} required>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      className={inputCls}
                      required
                      value={form.truckCapacityTons}
                      onChange={(e) => patch({ truckCapacityTons: e.target.value })}
                    />
                  </Field>
                  <Field label={t('portal.truckModel')} required>
                    <input
                      className={inputCls}
                      required
                      value={form.truckModel}
                      onChange={(e) => patch({ truckModel: e.target.value })}
                    />
                  </Field>
                  <Field label={t('portal.driverName')} required>
                    <input
                      className={inputCls}
                      required
                      value={form.driverName}
                      onChange={(e) => patch({ driverName: e.target.value })}
                    />
                  </Field>
                  <Field label={t('portal.driverPhone')} required>
                    <input
                      className={inputCls}
                      required
                      value={form.driverPhone}
                      onChange={(e) => patch({ driverPhone: e.target.value })}
                    />
                  </Field>
                  <Field label={t('portal.driverEmail')} optional>
                    <input
                      type="email"
                      className={inputCls}
                      value={form.driverEmail}
                      onChange={(e) => patch({ driverEmail: e.target.value })}
                    />
                  </Field>
                </div>
              </section>

              <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
                <SectionHeader
                  icon={<PackageCheck className="h-4 w-4" />}
                  label={t('portal.sectionRequest')}
                />
                <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                  <Field label={t('portal.cropType')} required>
                    <select
                      className={inputCls}
                      required
                      value={form.cropType}
                      onChange={(e) => patch({ cropType: e.target.value })}
                    >
                      <option value="">{t('portal.cropTypePlaceholder')}</option>
                      {(portal.allowedCropTypes.length > 0
                        ? portal.allowedCropTypes
                        : Object.values(CropType)
                      ).map((c) => (
                        <option key={c} value={c}>
                          {t(`settings.organization.crop.${c}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t('portal.tonsRequested')} required>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      className={inputCls}
                      required
                      value={form.tonsRequested}
                      onChange={(e) => patch({ tonsRequested: e.target.value })}
                    />
                  </Field>
                  <Field label={t('portal.neededDate')} required>
                    <input
                      type="date"
                      className={inputCls}
                      required
                      value={form.neededDate}
                      onChange={(e) => patch({ neededDate: e.target.value })}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label={t('portal.destinationAddress')} required>
                      <input
                        className={inputCls}
                        required
                        value={form.destinationAddress}
                        onChange={(e) => patch({ destinationAddress: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label={t('portal.notes')} optional>
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
                <p className="text-xs text-stone-400">{t('portal.requiredNote')}</p>
                {submitError && (
                  <p className="text-sm font-medium text-rose-600" role="alert">
                    {submitError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitting ? t('portal.submitting') : t('portal.submit')}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
