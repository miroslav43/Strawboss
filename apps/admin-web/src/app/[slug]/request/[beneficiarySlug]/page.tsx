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
  Building2,
  Pencil,
  MapPin,
  X,
} from 'lucide-react';
import { LeafletPointPicker } from '@/components/map/LeafletPointPicker';
import { CropType } from '@strawboss/types';
import type {
  PublicBeneficiaryInfo,
  BeneficiaryContact,
  BeneficiaryTruck,
  BeneficiaryDriver,
} from '@strawboss/types';
import { useI18n, normalizeUiLocale, type Locale } from '@/lib/i18n';
import { apiV1Url } from '@/lib/api';
import { BeneficiarySavedSelect } from './BeneficiarySavedSelect';
import { BeneficiaryRecordModal, type RecordKind } from './BeneficiaryRecordModal';
import { BeneficiaryRecordDeleteDialog } from './BeneficiaryRecordDeleteDialog';

const TRACTOR = '/brand/strawboss-tractor.svg';

// ── Shared UI atoms ────────────────────────────────────────────────────────

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
          <span className="ml-1 font-normal text-stone-400">
            ({t('beneficiaryPortal.optional')})
          </span>
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

// ── Form state ─────────────────────────────────────────────────────────────

// Only the pickup details are typed on every request; contact / truck / driver
// now come from the selected saved records.
type FormState = {
  cropType: string;
  neededDate: string;
  tonsRequested: string;
  destinationAddress: string;
  notes: string;
};

const BLANK: FormState = {
  cropType: '',
  neededDate: '',
  tonsRequested: '',
  destinationAddress: '',
  notes: '',
};

// ── Brand panel ────────────────────────────────────────────────────────────

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
              {t('beneficiaryPortal.brandEyebrow')}
            </p>
            <p className="text-base font-semibold text-cream">
              {orgName ?? t('beneficiaryPortal.brandEyebrow')}
            </p>
          </div>
        </div>

        {/* headline + trust (desktop-rich, compact on mobile) */}
        <div className="max-w-md">
          <h1 className="text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-[2.75rem]">
            {t('beneficiaryPortal.heroHeadline')}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-cream/80 sm:text-base">
            {t('beneficiaryPortal.heroSub')}
          </p>

          <ul className="mt-8 hidden space-y-3.5 lg:block">
            {[
              { icon: <ShieldCheck className="h-4 w-4" />, label: t('beneficiaryPortal.trust1') },
              { icon: <KeyRound className="h-4 w-4" />, label: t('beneficiaryPortal.trust2') },
              {
                icon: <SendHorizonal className="h-4 w-4" />,
                label: t('beneficiaryPortal.trust3'),
              },
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
          {t('beneficiaryPortal.poweredBy')}
        </p>
      </div>
    </aside>
  );
}

// ── Language toggle ────────────────────────────────────────────────────────

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

// ── Read-only chip ─────────────────────────────────────────────────────────

function ReadOnlyChip({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-stone-400">—</span>;
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-[15px] text-bark">
      {value}
    </div>
  );
}

/** Labelled, read-only display of a field from a selected saved record. */
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

// ── Page ──────────────────────────────────────────────────────────────────

type Step = 'pin' | 'form' | 'success';

export default function BeneficiaryPortalPage() {
  const { t, locale, setLocale } = useI18n();
  const params = useParams<{ slug: string; beneficiarySlug: string }>();
  const orgSlug = params.slug;
  const beneficiarySlug = params.beneficiarySlug;

  // Beneficiary public info (loaded on mount)
  const [info, setInfo] = useState<PublicBeneficiaryInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [infoError, setInfoError] = useState(false);

  // PIN step
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinVerifying, setPinVerifying] = useState(false);
  const pinRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Form step
  const [form, setForm] = useState<FormState>(BLANK);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [destCoords, setDestCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [showMapPicker, setShowMapPicker] = useState(false);

  // Saved per-beneficiary records (loaded once the PIN is verified)
  const [contacts, setContacts] = useState<BeneficiaryContact[]>([]);
  const [trucks, setTrucks] = useState<BeneficiaryTruck[]>([]);
  const [drivers, setDrivers] = useState<BeneficiaryDriver[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [contactsError, setContactsError] = useState(false);
  const [trucksError, setTrucksError] = useState(false);
  const [driversError, setDriversError] = useState(false);
  const [selContactId, setSelContactId] = useState<string | null>(null);
  const [selTruckId, setSelTruckId] = useState<string | null>(null);
  const [selDriverId, setSelDriverId] = useState<string | null>(null);
  const [recordModal, setRecordModal] = useState<{
    kind: RecordKind;
    record?: BeneficiaryContact | BeneficiaryTruck | BeneficiaryDriver;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: RecordKind;
    id: string;
    label: string;
  } | null>(null);

  // Current step
  const [step, setStep] = useState<Step>('pin');

  const patch = (p: Partial<FormState>) => setForm((s) => ({ ...s, ...p }));

  // Auto-detect locale on first visit
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && !localStorage.getItem('strawboss-locale')) {
        setLocale(normalizeUiLocale(navigator.language), { persist: false });
      }
    } catch {
      /* ignore storage/SSR errors */
    }
  }, [setLocale]);

  // Load beneficiary public info on mount
  useEffect(() => {
    const controller = new AbortController();
    setInfoLoading(true);
    fetch(apiV1Url(`/public/portal/${orgSlug}/beneficiary/${beneficiarySlug}`), {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('load failed');
        setInfo((await res.json()) as PublicBeneficiaryInfo);
      })
      .catch(() => {
        if (!controller.signal.aborted) setInfoError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setInfoLoading(false);
      });
    return () => controller.abort();
  }, [orgSlug, beneficiarySlug]);

  // PIN digit input helpers
  function setDigit(i: number, raw: string) {
    const d = raw.replace(/\D/g, '').slice(-1);
    const arr = pin.split('');
    while (arr.length < 4) arr.push('');
    arr[i] = d;
    setPin(arr.join('').slice(0, 4));
    if (d && i < 3) pinRefs.current[i + 1]?.focus();
  }

  function onPinKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !pin[i] && i > 0) {
      e.preventDefault();
      pinRefs.current[i - 1]?.focus();
    }
  }

  function onPinPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (!digits) return;
    e.preventDefault();
    setPin(digits);
    pinRefs.current[Math.min(digits.length, 3)]?.focus();
  }

  async function verifyPin(e: React.FormEvent) {
    e.preventDefault();
    setPinError(null);
    if (!/^\d{4}$/.test(pin)) {
      setPinError(t('beneficiaryPortal.pinInvalid'));
      return;
    }
    setPinVerifying(true);
    try {
      const res = await fetch(
        apiV1Url(`/public/portal/${orgSlug}/beneficiary/${beneficiarySlug}/verify`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin }),
        },
      );
      if (!res.ok) {
        setPinError(
          res.status === 429
            ? t('beneficiaryPortal.pinThrottled')
            : res.status === 410
              ? t('beneficiaryPortal.pinExpired')
              : res.status === 401 || res.status === 403
                ? t('beneficiaryPortal.pinInvalid')
                : t('beneficiaryPortal.pinError'),
        );
        return;
      }
      setStep('form');
      void loadSavedLists();
    } catch {
      setPinError(t('beneficiaryPortal.pinError'));
    } finally {
      setPinVerifying(false);
    }
  }

  // ── Saved-record loaders (PIN-gated; pin travels in the body) ──────────────
  async function fetchSavedList(kindPath: string): Promise<unknown> {
    const res = await fetch(
      apiV1Url(`/public/portal/${orgSlug}/beneficiary/${beneficiarySlug}/${kindPath}/list`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      },
    );
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  async function loadSavedLists() {
    setSavedLoading(true);
    setContactsError(false);
    setTrucksError(false);
    setDriversError(false);
    const [c, tr, d] = await Promise.allSettled([
      fetchSavedList('contacts'),
      fetchSavedList('trucks'),
      fetchSavedList('drivers'),
    ]);
    if (c.status === 'fulfilled') setContacts(c.value as BeneficiaryContact[]);
    else setContactsError(true);
    if (tr.status === 'fulfilled') setTrucks(tr.value as BeneficiaryTruck[]);
    else setTrucksError(true);
    if (d.status === 'fulfilled') setDrivers(d.value as BeneficiaryDriver[]);
    else setDriversError(true);
    setSavedLoading(false);
  }

  async function reloadContacts() {
    setContactsError(false);
    try {
      setContacts((await fetchSavedList('contacts')) as BeneficiaryContact[]);
    } catch {
      setContactsError(true);
    }
  }
  async function reloadTrucks() {
    setTrucksError(false);
    try {
      setTrucks((await fetchSavedList('trucks')) as BeneficiaryTruck[]);
    } catch {
      setTrucksError(true);
    }
  }
  async function reloadDrivers() {
    setDriversError(false);
    try {
      setDrivers((await fetchSavedList('drivers')) as BeneficiaryDriver[]);
    } catch {
      setDriversError(true);
    }
  }

  function upsertById<T extends { id: string }>(list: T[], rec: T): T[] {
    return list.some((x) => x.id === rec.id)
      ? list.map((x) => (x.id === rec.id ? rec : x))
      : [rec, ...list];
  }

  // After create/edit: upsert into the list; auto-select only when newly created.
  function handleSaved(rec: BeneficiaryContact | BeneficiaryTruck | BeneficiaryDriver) {
    if (!recordModal) return;
    const isNew = !recordModal.record;
    if (recordModal.kind === 'contact') {
      const r = rec as BeneficiaryContact;
      setContacts((prev) => upsertById(prev, r));
      if (isNew) setSelContactId(r.id);
    } else if (recordModal.kind === 'truck') {
      const r = rec as BeneficiaryTruck;
      setTrucks((prev) => upsertById(prev, r));
      if (isNew) setSelTruckId(r.id);
    } else {
      const r = rec as BeneficiaryDriver;
      setDrivers((prev) => upsertById(prev, r));
      if (isNew) setSelDriverId(r.id);
    }
    setRecordModal(null);
  }

  // After delete: drop from the list and clear the selection if it pointed there.
  function handleDeleted(id: string) {
    if (!deleteTarget) return;
    if (deleteTarget.kind === 'contact') {
      setContacts((prev) => prev.filter((x) => x.id !== id));
      setSelContactId((cur) => (cur === id ? null : cur));
    } else if (deleteTarget.kind === 'truck') {
      setTrucks((prev) => prev.filter((x) => x.id !== id));
      setSelTruckId((cur) => (cur === id ? null : cur));
    } else {
      setDrivers((prev) => prev.filter((x) => x.id !== id));
      setSelDriverId((cur) => (cur === id ? null : cur));
    }
    setDeleteTarget(null);
  }

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);

    const trim = (s: string) => (s.trim() === '' ? null : s.trim());
    const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

    const contact = contacts.find((c) => c.id === selContactId);
    const truck = trucks.find((tk) => tk.id === selTruckId);
    const driver = drivers.find((d) => d.id === selDriverId);
    if (!contact || !truck || !driver) {
      setSubmitError(t('beneficiaryPortal.saved.selectAllError'));
      setSubmitting(false);
      return;
    }
    // requesterPhone / driverPhone are required (min 4) by the submit schema; the
    // save modal enforces this, but guard against a record with a missing phone.
    if (!contact.phone?.trim() || !driver.phone?.trim()) {
      setSubmitError(t('beneficiaryPortal.saved.phoneRequired'));
      setSubmitting(false);
      return;
    }

    const payload = {
      requesterName: contact.name,
      requesterPhone: contact.phone ?? '',
      requesterEmail: contact.email,
      truckRegistrationPlate: truck.truckRegistrationPlate,
      trailerRegistrationPlate: truck.trailerRegistrationPlate,
      truckCapacityTons: truck.capacityTons,
      transporterName: truck.transporterName,
      transporterCui: truck.transporterCui,
      transporterAddress: truck.transporterAddress,
      driverName: driver.name,
      driverPhone: driver.phone ?? '',
      driverEmail: driver.email,
      cropType: form.cropType || null,
      neededDate: trim(form.neededDate),
      tonsRequested: numOrNull(form.tonsRequested),
      destinationAddress: trim(form.destinationAddress),
      destinationCoords: destCoords,
      notes: trim(form.notes),
      contactId: contact.id,
      truckId: truck.id,
      driverId: driver.id,
      pin,
    };

    try {
      const res = await fetch(
        apiV1Url(`/public/portal/${orgSlug}/beneficiary/${beneficiarySlug}/requests`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        setSubmitError(
          res.status === 429
            ? t('beneficiaryPortal.pinThrottled')
            : res.status === 410
              ? t('beneficiaryPortal.pinExpired')
              : res.status === 401
                ? t('beneficiaryPortal.pinInvalid')
                : t('beneficiaryPortal.submitError'),
        );
        return;
      }
      setStep('success');
    } catch {
      setSubmitError(t('beneficiaryPortal.submitError'));
    } finally {
      setSubmitting(false);
    }
  }

  const allowedCrops =
    info && info.allowedCropTypes.length > 0 ? info.allowedCropTypes : Object.values(CropType);

  const selectedContact = contacts.find((c) => c.id === selContactId) ?? null;
  const selectedTruck = trucks.find((tk) => tk.id === selTruckId) ?? null;
  const selectedDriver = drivers.find((d) => d.id === selDriverId) ?? null;

  return (
    <div className="min-h-screen bg-cream text-bark lg:grid lg:grid-cols-[minmax(0,38%)_minmax(0,1fr)]">
      <BrandPanel orgName={info?.organizationName ?? null} t={t} />

      <main className="relative flex min-h-screen flex-col">
        <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
          <LangToggle locale={locale} onPick={(l) => setLocale(l)} />
        </div>

        <div
          className={`mx-auto flex w-full max-w-xl flex-1 flex-col px-5 pb-12 pt-20 sm:px-8 lg:pt-16 ${
            step === 'form' ? 'justify-start' : 'lg:justify-center'
          }`}
        >
          {/* ── Loading info error ── */}
          {infoLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-stone-400">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}

          {!infoLoading && infoError && (
            <div className="rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-sm">
              <p className="text-sm text-rose-600">{t('beneficiaryPortal.loadError')}</p>
            </div>
          )}

          {/* ── Step A: PIN entry ── */}
          {!infoLoading && !infoError && step === 'pin' && (
            <form
              onSubmit={verifyPin}
              className="portal-rise rounded-3xl border border-stone-200 bg-white p-7 shadow-sm sm:p-9"
            >
              <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <KeyRound className="h-5 w-5" />
              </span>

              {info && (
                <p className="mb-1 text-lg font-semibold text-bark">
                  {t('beneficiaryPortal.pinStep1Title').replace('{name}', info.displayName)}
                </p>
              )}
              <p className="mt-1.5 text-sm leading-relaxed text-stone-500">
                {t('beneficiaryPortal.pinStep1Hint')}
              </p>

              <div
                className="mt-7 flex justify-between gap-2.5 sm:gap-3"
                role="group"
                aria-label={t('beneficiaryPortal.pinStep1Title')}
              >
                {[0, 1, 2, 3].map((i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      pinRefs.current[i] = el;
                    }}
                    value={pin[i] ?? ''}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => onPinKeyDown(i, e)}
                    onPaste={onPinPaste}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={1}
                    aria-label={`PIN ${i + 1}`}
                    autoFocus={i === 0}
                    className={`h-16 w-full rounded-2xl border-2 bg-white text-center text-2xl font-bold text-bark shadow-sm outline-none transition-all sm:h-[4.5rem] ${
                      pin[i] ? 'border-primary' : 'border-stone-300'
                    } focus:border-primary focus:ring-4 focus:ring-primary/15`}
                  />
                ))}
              </div>

              {pinError && (
                <p className="mt-3 text-sm font-medium text-rose-600" role="alert">
                  {pinError}
                </p>
              )}

              <button
                type="submit"
                disabled={pinVerifying || pin.length < 4}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pinVerifying && <Loader2 className="h-4 w-4 animate-spin" />}
                {pinVerifying
                  ? t('beneficiaryPortal.pinVerifying')
                  : t('beneficiaryPortal.pinContinue')}
              </button>
            </form>
          )}

          {/* ── Step B: Request form ── */}
          {!infoLoading && !infoError && step === 'form' && (
            <form onSubmit={submitRequest} className="portal-rise space-y-5">
              <div className="mb-1">
                <h1 className="text-2xl font-bold tracking-tight text-bark sm:text-[1.7rem]">
                  {t('beneficiaryPortal.step2Title')}
                </h1>
                <p className="mt-1 text-sm text-stone-500">
                  {t('beneficiaryPortal.step2Subtitle')}
                </p>
              </div>

              {/* Company info — read-only */}
              <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
                <SectionHeader
                  icon={<Building2 className="h-4 w-4" />}
                  label={t('beneficiaryPortal.sectionCompany')}
                />
                <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                  <div className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-stone-600">
                      {t('beneficiaryPortal.companyName')}
                    </span>
                    <ReadOnlyChip value={info?.companyName} />
                  </div>
                  <div className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-stone-600">
                      {t('beneficiaryPortal.companyCui')}
                    </span>
                    <ReadOnlyChip value={info?.companyCui} />
                  </div>
                  <div className="block sm:col-span-2">
                    <span className="mb-1.5 block text-[13px] font-medium text-stone-600">
                      {t('beneficiaryPortal.companyAddress')}
                    </span>
                    <ReadOnlyChip value={info?.companyAddress} />
                  </div>
                </div>
                <p className="mt-3 text-xs text-stone-400">
                  {t('beneficiaryPortal.companyPrefilledNote')}
                </p>
              </section>

              {/* Contact person — pick a saved one or add new */}
              <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
                <SectionHeader
                  icon={<UserRound className="h-4 w-4" />}
                  label={t('beneficiaryPortal.sectionRequester')}
                />
                <BeneficiarySavedSelect
                  placeholder={t('beneficiaryPortal.saved.selectContact')}
                  items={contacts}
                  selectedId={selContactId}
                  loading={savedLoading}
                  error={contactsError}
                  getPrimary={(c) => c.name}
                  getSecondary={(c) => c.phone ?? c.email}
                  getSearchText={(c) => `${c.name} ${c.phone ?? ''} ${c.email ?? ''}`}
                  onSelect={setSelContactId}
                  onAdd={() => setRecordModal({ kind: 'contact' })}
                  onEdit={(c) => setRecordModal({ kind: 'contact', record: c })}
                  onDelete={(c) => setDeleteTarget({ kind: 'contact', id: c.id, label: c.name })}
                  onRetry={() => void reloadContacts()}
                />
                {selectedContact && (
                  <div className="mt-4">
                    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                      <LockedField
                        label={t('beneficiaryPortal.requesterName')}
                        value={selectedContact.name}
                      />
                      <LockedField
                        label={t('beneficiaryPortal.requesterPhone')}
                        value={selectedContact.phone}
                      />
                      <div className="sm:col-span-2">
                        <LockedField
                          label={t('beneficiaryPortal.requesterEmail')}
                          value={selectedContact.email}
                        />
                      </div>
                    </div>
                    <EditSelectedButton
                      onClick={() => setRecordModal({ kind: 'contact', record: selectedContact })}
                    />
                  </div>
                )}
              </section>

              {/* Truck + Transporter — pick a saved one or add new */}
              <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
                <SectionHeader
                  icon={<Truck className="h-4 w-4" />}
                  label={t('beneficiaryPortal.sectionTruck')}
                />
                <BeneficiarySavedSelect
                  placeholder={t('beneficiaryPortal.saved.selectTruck')}
                  items={trucks}
                  selectedId={selTruckId}
                  loading={savedLoading}
                  error={trucksError}
                  getPrimary={(tk) => tk.truckRegistrationPlate}
                  getSecondary={(tk) =>
                    tk.transporterName ?? (tk.capacityTons != null ? `${tk.capacityTons} t` : null)
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
                  onRetry={() => void reloadTrucks()}
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
                        label={t('beneficiaryPortal.truckCapacityTons')}
                        value={selectedTruck.capacityTons}
                      />
                      <LockedField
                        label={t('beneficiaryPortal.transporterName')}
                        value={selectedTruck.transporterName}
                      />
                      <LockedField
                        label={t('beneficiaryPortal.transporterCui')}
                        value={selectedTruck.transporterCui}
                      />
                      <LockedField
                        label={t('beneficiaryPortal.transporterAddress')}
                        value={selectedTruck.transporterAddress}
                      />
                    </div>
                    <EditSelectedButton
                      onClick={() => setRecordModal({ kind: 'truck', record: selectedTruck })}
                    />
                  </div>
                )}
              </section>

              {/* Driver — pick a saved one or add new */}
              <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
                <SectionHeader
                  icon={<UserRound className="h-4 w-4" />}
                  label={t('beneficiaryPortal.saved.driverLabel')}
                />
                <BeneficiarySavedSelect
                  placeholder={t('beneficiaryPortal.saved.selectDriver')}
                  items={drivers}
                  selectedId={selDriverId}
                  loading={savedLoading}
                  error={driversError}
                  getPrimary={(d) => d.name}
                  getSecondary={(d) => d.phone ?? d.email}
                  getSearchText={(d) => `${d.name} ${d.phone ?? ''} ${d.email ?? ''}`}
                  onSelect={setSelDriverId}
                  onAdd={() => setRecordModal({ kind: 'driver' })}
                  onEdit={(d) => setRecordModal({ kind: 'driver', record: d })}
                  onDelete={(d) => setDeleteTarget({ kind: 'driver', id: d.id, label: d.name })}
                  onRetry={() => void reloadDrivers()}
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
                  <Field label={t('beneficiaryPortal.cropType')} required>
                    <select
                      className={inputCls}
                      required
                      value={form.cropType}
                      onChange={(e) => patch({ cropType: e.target.value })}
                    >
                      <option value="">{t('beneficiaryPortal.cropTypePlaceholder')}</option>
                      {allowedCrops.map((c) => (
                        <option key={c} value={c}>
                          {t(`settings.organization.crop.${c}`)}
                        </option>
                      ))}
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
                  <Field label={t('beneficiaryPortal.tonsRequested')} required>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      className={inputCls}
                      required
                      value={form.tonsRequested}
                      onChange={(e) => patch({ tonsRequested: e.target.value })}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label={t('beneficiaryPortal.destinationAddress')} required>
                      <input
                        className={inputCls}
                        required
                        value={form.destinationAddress}
                        onChange={(e) => patch({ destinationAddress: e.target.value })}
                      />
                    </Field>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowMapPicker(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[13px] font-medium text-stone-600 transition-colors hover:border-primary hover:text-primary"
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        {t('beneficiaryPortal.pickOnMap')}
                      </button>
                      {destCoords && (
                        <span className="inline-flex items-center gap-1 text-[13px] font-medium text-primary">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {t('beneficiaryPortal.coordsSet')}
                          <button
                            type="button"
                            onClick={() => setDestCoords(null)}
                            className="ml-1 text-stone-400 hover:text-stone-600"
                            aria-label={t('beneficiaryPortal.coordsClear')}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      )}
                    </div>
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
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitting ? t('beneficiaryPortal.submitting') : t('beneficiaryPortal.submit')}
                </button>
              </div>
            </form>
          )}

          {/* ── Step C: Success ── */}
          {step === 'success' && (
            <div className="portal-rise rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-sm sm:p-10">
              <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <CheckCircle2 className="h-9 w-9" />
              </span>
              <h2 className="text-xl font-bold text-bark">{t('beneficiaryPortal.successTitle')}</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-stone-500">
                {t('beneficiaryPortal.successBody')}
              </p>
            </div>
          )}
        </div>
      </main>

      {showMapPicker && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div
            className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
            style={{ maxHeight: 'min(90vh, 640px)' }}
          >
            <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
              <div>
                <h2 className="text-base font-semibold text-bark">
                  {t('beneficiaryPortal.mapPickerTitle')}
                </h2>
                <p className="text-xs text-stone-500">{t('beneficiaryPortal.mapPickerHint')}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowMapPicker(false)}
                className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="relative flex-1">
              <LeafletPointPicker
                initial={destCoords}
                onChange={(lat, lon) => setDestCoords({ lat, lon })}
                className="h-full min-h-[320px] w-full"
              />
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-stone-100 bg-stone-50 px-5 py-3">
              <span className="text-xs text-stone-500">
                {destCoords
                  ? `${destCoords.lat.toFixed(5)}, ${destCoords.lon.toFixed(5)}`
                  : t('beneficiaryPortal.mapPickerNone')}
              </span>
              <button
                type="button"
                onClick={() => setShowMapPicker(false)}
                disabled={!destCoords}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {t('beneficiaryPortal.mapPickerConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {recordModal && (
        <BeneficiaryRecordModal
          kind={recordModal.kind}
          record={recordModal.record}
          orgSlug={orgSlug}
          beneficiarySlug={beneficiarySlug}
          pin={pin}
          onSaved={handleSaved}
          onClose={() => setRecordModal(null)}
        />
      )}
      {deleteTarget && (
        <BeneficiaryRecordDeleteDialog
          kind={deleteTarget.kind}
          recordId={deleteTarget.id}
          recordLabel={deleteTarget.label}
          orgSlug={orgSlug}
          beneficiarySlug={beneficiarySlug}
          pin={pin}
          onDeleted={handleDeleted}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
