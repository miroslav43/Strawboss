import { MessageKind, type Locale } from '@strawboss/types';

/**
 * Pure render functions per MessageKind, one per Locale (Task 6.3):
 * `messageTemplates[kind][locale](ctx)`. They produce the human-readable
 * subject/body(/html) only — channel + recipient are decided by the call site.
 *
 * The `ro` entry under every kind is byte-identical to the pre-6.3
 * Romanian-only implementation (see task-6.3-report.md for the moved-string
 * table) — only wrapped in the new `{ ro, en, hu }` shape, never reworded.
 * `en`/`hu` are new translations.
 *
 * This file deliberately does NOT route through the shared `tServer` catalog
 * (../common/i18n) the way push notifications (Task 6.2) and the CMR/comandă
 * PDF labels (Task 6.3, cmr.service.ts / comanda.service.ts) do. Several of
 * these templates (transport_confirmed, aviz_uploaded) interleave dozens of
 * conditional lines and HTML fragments per kind — decomposing every fragment
 * into a flat catalog key would fragment sentences unnaturally across
 * languages and make a byte-identity review much harder. Instead each kind
 * keeps ONE render function, parameterized by a small file-local
 * `..._STRINGS: Record<Locale, {...}>` dictionary defined just above it —
 * same DRY benefit (no HTML-building logic tripled three times) without
 * depending on the global catalog.
 */

export interface NewRequestAdminCtx {
  companyName: string | null;
  requesterName: string;
  requesterPhone: string;
  cropType: string | null;
  // beneficiary portal: 'quality_1' | 'quality_2' (absent on the non-beneficiary portal)
  quality?: string | null;
  neededDate: string | null;
  tonsRequested: number | null;
  destinationAddress: string | null;
}

/** Human label for the beneficiary quality grade, per locale. */
const QUALITY_LABELS: Record<Locale, { quality_1: string; quality_2: string }> = {
  ro: { quality_1: 'Calitate 1', quality_2: 'Calitate 2' },
  en: { quality_1: 'Quality 1', quality_2: 'Quality 2' },
  hu: { quality_1: '1. minőség', quality_2: '2. minőség' },
};
function qualityLabel(quality: string | null | undefined, locale: Locale): string | null {
  if (quality === 'quality_1' || quality === 'quality_2') return QUALITY_LABELS[locale][quality];
  return quality ?? null;
}

export interface RequestConfirmedCtx {
  organizationName: string;
  requesterName: string;
  neededDate: string | null;
}

export interface DriverAssignedCtx {
  loaderName: string | null;
  loaderPhone: string | null;
  parcelName: string | null;
  locality: string | null;
  mapsUrl: string | null;
  cropType: string | null;
}

export interface DriverArrivalCmrLinkCtx {
  cmrUrl: string;
  baleCount: number;
}

export interface TransportLocation {
  label: string;
  address: string | null;
  mapsUrl: string | null;
}

export interface TransportConfirmedCtx {
  organizationName: string;
  recipientName: string | null;
  driverName: string;
  cropType: string | null;
  quality: string | null;
  tonsRequested: number | null;
  neededDate: string | null;
  notes: string | null;
  requesterPhone: string | null;
  companyName: string | null;
  companyCui: string | null;
  companyAddress: string | null;
  truckRegistrationPlate: string | null;
  trailerRegistrationPlate: string | null;
  truckCapacityTons: number | null;
  transporterName: string | null;
  transporterCui: string | null;
  transporterAddress: string | null;
  pickup: TransportLocation;
  delivery: TransportLocation;
  routeUrl: string | null;
  distanceKm: number | null;
  staticMapUrl: string | null;
  // Optional absolute URL to a raster brand logo shown in the header (EMAIL_LOGO_URL).
  logoUrl: string | null;
}

export interface TransportConfirmedSmsCtx {
  pickupName: string;
  pickupMapsUrl: string | null;
  deliveryAddress: string | null;
  deliveryMapsUrl: string | null;
  distanceKm: number | null;
  neededDate: string | null;
}

export interface AvizUploadedCtx {
  organizationName: string;
  recipientName: string | null;
  companyName: string | null;
  truckRegistrationPlate: string | null;
  neededDate: string | null;
  /** Absolute, signed, no-auth download URL to the aviz PDF (valid ~7 days). */
  downloadUrl: string;
  /** Optional absolute URL to a raster brand logo shown in the header (EMAIL_LOGO_URL). */
  logoUrl: string | null;
}

export interface AvizUploadedSmsCtx {
  truckRegistrationPlate: string | null;
  /** Absolute, signed download URL to the aviz PDF. Keep the rest of the copy GSM-7. */
  downloadUrl: string;
}

function fmtCoordsUrl(
  lat: number | null | undefined,
  lon: number | null | undefined,
): string | null {
  if (lat == null || lon == null) return null;
  return `https://www.google.com/maps?q=${lat},${lon}`;
}

/** Google Maps driving-directions link between two points. */
function fmtDirectionsUrl(
  from: { lat: number; lon: number } | null,
  to: { lat: number; lon: number } | null,
): string | null {
  if (!from || !to) return null;
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${from.lat},${from.lon}&destination=${to.lat},${to.lon}&travelmode=driving`
  );
}

/** Minimal HTML escaping for values interpolated into the email body. */
function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────
// new_request_admin (email)
// ─────────────────────────────────────────────────────────────────────────

const NEW_REQUEST_ADMIN_STRINGS: Record<
  Locale,
  {
    subject: string;
    intro: string;
    requesterLabel: string;
    companyLabel: string;
    cropLabel: string;
    qualityLabel: string;
    neededDateLabel: string;
    destinationLabel: string;
    closing: string;
  }
> = {
  ro: {
    subject: 'Cerere nouă de transport',
    intro: 'O nouă cerere de transport a fost trimisă prin portal.\n\n',
    requesterLabel: 'Solicitant',
    companyLabel: 'Firmă',
    cropLabel: 'Recoltă',
    qualityLabel: 'Calitate',
    neededDateLabel: 'Data necesară',
    destinationLabel: 'Livrare la',
    closing: '\nConfirmați sau anulați cererea din pagina Curse, secțiunea „De confirmat".',
  },
  en: {
    subject: 'New transport request',
    intro: 'A new transport request was submitted through the portal.\n\n',
    requesterLabel: 'Requester',
    companyLabel: 'Company',
    cropLabel: 'Crop',
    qualityLabel: 'Quality',
    neededDateLabel: 'Needed date',
    destinationLabel: 'Deliver to',
    closing: '\nConfirm or cancel the request from the Trips page, "To confirm" section.',
  },
  hu: {
    subject: 'Új szállítási kérelem',
    intro: 'Egy új szállítási kérelem érkezett a portálon keresztül.\n\n',
    requesterLabel: 'Igénylő',
    companyLabel: 'Cég',
    cropLabel: 'Termény',
    qualityLabel: 'Minőség',
    neededDateLabel: 'Szükséges dátum',
    destinationLabel: 'Szállítás ide',
    closing:
      '\nErősítse meg vagy mondja le a kérelmet a Fuvarok oldalon, a „Megerősítendő” szakaszban.',
  },
};

function renderNewRequestAdmin(ctx: NewRequestAdminCtx, locale: Locale) {
  const s = NEW_REQUEST_ADMIN_STRINGS[locale];
  const subject = `${s.subject}${ctx.companyName ? ` — ${ctx.companyName}` : ''}`;
  const line = (label: string, value: string | null) => (value ? `${label}: ${value}\n` : '');
  const body =
    s.intro +
    `${s.requesterLabel}: ${ctx.requesterName} (${ctx.requesterPhone})\n` +
    line(s.companyLabel, ctx.companyName) +
    line(s.cropLabel, ctx.cropType) +
    line(s.qualityLabel, qualityLabel(ctx.quality, locale)) +
    line(s.neededDateLabel, ctx.neededDate) +
    line(s.destinationLabel, ctx.destinationAddress) +
    s.closing;
  return { subject, body };
}

// ─────────────────────────────────────────────────────────────────────────
// request_confirmed_requester (email) — currently unused by any call site,
// kept translated for parity with the other 7 kinds.
// ─────────────────────────────────────────────────────────────────────────

const REQUEST_CONFIRMED_STRINGS: Record<
  Locale,
  {
    subject: string;
    greetingPrefix: string;
    greetingSuffix: string;
    confirmedPrefix: string;
    confirmedMiddle: string;
    neededDatePrefix: string;
    closing: string;
  }
> = {
  ro: {
    subject: 'Cererea dvs. de transport a fost confirmată',
    greetingPrefix: 'Bună ziua, ',
    greetingSuffix: '.\n\n',
    confirmedPrefix: 'Cererea dvs. de transport către ',
    confirmedMiddle: ' a fost confirmată',
    neededDatePrefix: ' pentru data ',
    closing: '.\nȘoferul va primi instrucțiunile de încărcare prin SMS.',
  },
  en: {
    subject: 'Your transport request has been confirmed',
    greetingPrefix: 'Hello, ',
    greetingSuffix: '.\n\n',
    confirmedPrefix: 'Your transport request to ',
    confirmedMiddle: ' has been confirmed',
    neededDatePrefix: ' for ',
    closing: '.\nThe driver will receive the loading instructions by SMS.',
  },
  hu: {
    subject: 'A szállítási kérelme megerősítésre került',
    greetingPrefix: 'Jó napot, ',
    greetingSuffix: '.\n\n',
    confirmedPrefix: 'A(z) ',
    confirmedMiddle: ' részére küldött szállítási kérelme megerősítésre került',
    neededDatePrefix: ' a következő időpontra: ',
    closing: '.\nA sofőr SMS-ben kapja meg a rakodási utasításokat.',
  },
};

function renderRequestConfirmedRequester(ctx: RequestConfirmedCtx, locale: Locale) {
  const s = REQUEST_CONFIRMED_STRINGS[locale];
  const subject = s.subject;
  const body =
    `${s.greetingPrefix}${ctx.requesterName}${s.greetingSuffix}` +
    `${s.confirmedPrefix}${ctx.organizationName}${s.confirmedMiddle}` +
    (ctx.neededDate ? `${s.neededDatePrefix}${ctx.neededDate}` : '') +
    s.closing;
  return { subject, body };
}

// ─────────────────────────────────────────────────────────────────────────
// driver_assigned (SMS)
// ─────────────────────────────────────────────────────────────────────────

const DRIVER_ASSIGNED_STRINGS: Record<
  Locale,
  {
    intro: string;
    parcelLabel: string;
    loaderLabel: string;
    telLabel: string;
    cropLabel: string;
    mapLabel: string;
  }
> = {
  ro: {
    intro: 'Ați fost asignat pentru încărcare.\n',
    parcelLabel: 'Parcelă',
    loaderLabel: 'Operator încărcare',
    telLabel: 'tel',
    cropLabel: 'Recoltă',
    mapLabel: 'Hartă',
  },
  en: {
    intro: 'You have been assigned for loading.\n',
    parcelLabel: 'Field',
    loaderLabel: 'Loading operator',
    telLabel: 'tel',
    cropLabel: 'Crop',
    mapLabel: 'Map',
  },
  hu: {
    intro: 'Rakodásra lett kijelölve.\n',
    parcelLabel: 'Tábla',
    loaderLabel: 'Rakodó kezelő',
    telLabel: 'tel',
    cropLabel: 'Termény',
    mapLabel: 'Térkép',
  },
};

function renderDriverAssigned(ctx: DriverAssignedCtx, locale: Locale) {
  const s = DRIVER_ASSIGNED_STRINGS[locale];
  const body =
    s.intro +
    (ctx.parcelName ? `${s.parcelLabel}: ${ctx.parcelName}` : `${s.parcelLabel}: -`) +
    (ctx.locality ? `, ${ctx.locality}` : '') +
    `\n` +
    (ctx.loaderName ? `${s.loaderLabel}: ${ctx.loaderName}` : '') +
    (ctx.loaderPhone ? ` (${s.telLabel}: ${ctx.loaderPhone})` : '') +
    (ctx.cropType ? `\n${s.cropLabel}: ${ctx.cropType}` : '') +
    (ctx.mapsUrl ? `\n${s.mapLabel}: ${ctx.mapsUrl}` : '');
  return { body };
}

// ─────────────────────────────────────────────────────────────────────────
// driver_arrival_cmr_link (SMS)
// ─────────────────────────────────────────────────────────────────────────

const DRIVER_ARRIVAL_CMR_LINK_STRINGS: Record<
  Locale,
  { loadedPrefix: string; loadedSuffix: string; instructions: string }
> = {
  ro: {
    loadedPrefix: 'Încărcarea a fost finalizată (',
    loadedSuffix: ' baloți).\n',
    instructions: 'La sosirea la destinație, încărcați o poză a CMR-ului aici:\n',
  },
  en: {
    loadedPrefix: 'Loading complete (',
    loadedSuffix: ' bales).\n',
    instructions: 'When you arrive at the destination, upload a photo of the CMR here:\n',
  },
  hu: {
    loadedPrefix: 'A rakodás befejeződött (',
    loadedSuffix: ' bála).\n',
    instructions: 'A célállomásra érkezéskor töltsön fel egy fotót a CMR-ről itt:\n',
  },
};

function renderDriverArrivalCmrLink(ctx: DriverArrivalCmrLinkCtx, locale: Locale) {
  const s = DRIVER_ARRIVAL_CMR_LINK_STRINGS[locale];
  const body = `${s.loadedPrefix}${ctx.baleCount}${s.loadedSuffix}${s.instructions}${ctx.cmrUrl}`;
  return { body };
}

// ─────────────────────────────────────────────────────────────────────────
// transport_confirmed (email, subject + plain-text body + html)
// ─────────────────────────────────────────────────────────────────────────

const TRANSPORT_CONFIRMED_STRINGS: Record<
  Locale,
  {
    subjectPrefix: string;
    greetingBare: string;
    introConfirmedPrefix: string;
    introConfirmedSuffix: string;
    sectionDetailsUpper: string;
    sectionCompanyUpper: string;
    sectionCarrierUpper: string;
    sectionDriverUpper: string;
    sectionRouteUpper: string;
    labelQuality: string;
    labelCrop: string;
    labelQuantity: string;
    labelNeededDate: string;
    labelCompany: string;
    labelCui: string;
    labelAddress: string;
    labelCarrier: string;
    labelPlate: string;
    labelTrailer: string;
    labelCapacity: string;
    labelDriver: string;
    labelContactPhone: string;
    pickupLabel: string;
    deliveryLabel: string;
    routeWord: string;
    distanceLabel: string;
    notesLabel: string;
    openMapsLink: string;
    headerTitle: string;
    htmlIntro: string;
    sectionDetails: string;
    sectionCompany: string;
    sectionCarrier: string;
    sectionDriver: string;
    viewRoute: string;
    routeMapAlt: string;
    footerSentBy: string;
  }
> = {
  ro: {
    subjectPrefix: 'Transport confirmat — ridicare din ',
    greetingBare: 'Bună ziua',
    introConfirmedPrefix: 'Transportul a fost confirmat de ',
    introConfirmedSuffix: '.\n\n',
    sectionDetailsUpper: 'DETALII TRANSPORT',
    sectionCompanyUpper: 'FIRMĂ BENEFICIAR',
    sectionCarrierUpper: 'TRANSPORTATOR & CAMION',
    sectionDriverUpper: 'ȘOFER & CONTACT',
    sectionRouteUpper: 'RUTĂ',
    labelQuality: 'Calitate',
    labelCrop: 'Recoltă',
    labelQuantity: 'Cantitate',
    labelNeededDate: 'Data necesară',
    labelCompany: 'Firmă',
    labelCui: 'CUI',
    labelAddress: 'Adresă',
    labelCarrier: 'Transportator',
    labelPlate: 'Nr. înmatriculare',
    labelTrailer: 'Remorcă',
    labelCapacity: 'Capacitate',
    labelDriver: 'Șofer',
    labelContactPhone: 'Telefon contact',
    pickupLabel: 'Ridicare (depozit)',
    deliveryLabel: 'Livrare',
    routeWord: 'Rută',
    distanceLabel: 'Distanță',
    notesLabel: 'Note',
    openMapsLink: '↗ Deschide în Google Maps',
    headerTitle: '✅ Transport confirmat',
    htmlIntro: 'Cererea de transport a fost confirmată. Mai jos aveți toate detaliile cursei.',
    sectionDetails: 'Detalii transport',
    sectionCompany: 'Firmă beneficiar',
    sectionCarrier: 'Transportator & camion',
    sectionDriver: 'Șofer & contact',
    viewRoute: 'Vezi ruta ↗',
    routeMapAlt: 'Rută depozit → livrare',
    footerSentBy: 'Mesaj trimis automat de',
  },
  en: {
    subjectPrefix: 'Transport confirmed — pickup from ',
    greetingBare: 'Hello',
    introConfirmedPrefix: 'The transport has been confirmed by ',
    introConfirmedSuffix: '.\n\n',
    sectionDetailsUpper: 'TRANSPORT DETAILS',
    sectionCompanyUpper: 'BENEFICIARY COMPANY',
    sectionCarrierUpper: 'CARRIER & TRUCK',
    sectionDriverUpper: 'DRIVER & CONTACT',
    sectionRouteUpper: 'ROUTE',
    labelQuality: 'Quality',
    labelCrop: 'Crop',
    labelQuantity: 'Quantity',
    labelNeededDate: 'Needed date',
    labelCompany: 'Company',
    labelCui: 'Tax ID',
    labelAddress: 'Address',
    labelCarrier: 'Carrier',
    labelPlate: 'Registration no.',
    labelTrailer: 'Trailer',
    labelCapacity: 'Capacity',
    labelDriver: 'Driver',
    labelContactPhone: 'Contact phone',
    pickupLabel: 'Pickup (depot)',
    deliveryLabel: 'Delivery',
    routeWord: 'Route',
    distanceLabel: 'Distance',
    notesLabel: 'Notes',
    openMapsLink: '↗ Open in Google Maps',
    headerTitle: '✅ Transport confirmed',
    htmlIntro: 'The transport request has been confirmed. All the trip details are below.',
    sectionDetails: 'Transport details',
    sectionCompany: 'Beneficiary company',
    sectionCarrier: 'Carrier & truck',
    sectionDriver: 'Driver & contact',
    viewRoute: 'View route ↗',
    routeMapAlt: 'Route depot → delivery',
    footerSentBy: 'Message sent automatically by',
  },
  hu: {
    subjectPrefix: 'Fuvar megerősítve — felvétel innen: ',
    greetingBare: 'Jó napot',
    introConfirmedPrefix: 'A fuvart megerősítette: ',
    introConfirmedSuffix: '.\n\n',
    sectionDetailsUpper: 'FUVAR ADATAI',
    sectionCompanyUpper: 'KEDVEZMÉNYEZETT CÉG',
    sectionCarrierUpper: 'FUVAROZÓ ÉS KAMION',
    sectionDriverUpper: 'SOFŐR ÉS KAPCSOLAT',
    sectionRouteUpper: 'ÚTVONAL',
    labelQuality: 'Minőség',
    labelCrop: 'Termény',
    labelQuantity: 'Mennyiség',
    labelNeededDate: 'Szükséges dátum',
    labelCompany: 'Cég',
    labelCui: 'Adószám',
    labelAddress: 'Cím',
    labelCarrier: 'Fuvarozó',
    labelPlate: 'Rendszám',
    labelTrailer: 'Pótkocsi',
    labelCapacity: 'Kapacitás',
    labelDriver: 'Sofőr',
    labelContactPhone: 'Kapcsolattartó telefon',
    pickupLabel: 'Felvétel (raktár)',
    deliveryLabel: 'Szállítás',
    routeWord: 'Útvonal',
    distanceLabel: 'Távolság',
    notesLabel: 'Megjegyzés',
    openMapsLink: '↗ Megnyitás Google Maps-en',
    headerTitle: '✅ Fuvar megerősítve',
    htmlIntro:
      'A szállítási kérelem megerősítésre került. A fuvar összes részlete alább található.',
    sectionDetails: 'Fuvar adatai',
    sectionCompany: 'Kedvezményezett cég',
    sectionCarrier: 'Fuvarozó és kamion',
    sectionDriver: 'Sofőr és kapcsolat',
    viewRoute: 'Útvonal megtekintése ↗',
    routeMapAlt: 'Útvonal: raktár → szállítás',
    footerSentBy: 'Az üzenetet automatikusan küldte:',
  },
};

function renderTransportConfirmed(ctx: TransportConfirmedCtx, locale: Locale) {
  const s = TRANSPORT_CONFIRMED_STRINGS[locale];
  const km = ctx.distanceKm != null ? `~${Math.round(ctx.distanceKm)} km` : null;
  const subject = `${s.subjectPrefix}${ctx.pickup.address ?? ctx.pickup.label}`;

  // Numeric columns arrive as strings from postgres.js — normalize + trim
  // trailing zeros so "40.00" renders as "40 t". Unit stays "t" in every
  // locale — it is the SI/ISO abbreviation for tonne, not a translated word.
  const fmtTons = (v: number | string | null): string | null => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return null;
    const str = Number.isInteger(n)
      ? String(n)
      : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${str} t`;
  };

  const quality = qualityLabel(ctx.quality, locale);
  const tons = fmtTons(ctx.tonsRequested);
  const capacity = fmtTons(ctx.truckCapacityTons);

  // Plain-text fallback — mirrors the HTML sections, only non-empty lines.
  const line = (label: string, value: string | null) => (value ? `${label}: ${value}\n` : '');
  const body =
    `${s.greetingBare}${ctx.recipientName ? `, ${ctx.recipientName}` : ''}.\n\n` +
    `${s.introConfirmedPrefix}${ctx.organizationName}${s.introConfirmedSuffix}` +
    `${s.sectionDetailsUpper}\n` +
    line(s.labelQuality, quality) +
    line(s.labelCrop, ctx.cropType) +
    line(s.labelQuantity, tons) +
    line(s.labelNeededDate, ctx.neededDate) +
    `\n${s.sectionCompanyUpper}\n` +
    line(s.labelCompany, ctx.companyName) +
    line(s.labelCui, ctx.companyCui) +
    line(s.labelAddress, ctx.companyAddress) +
    `\n${s.sectionCarrierUpper}\n` +
    line(s.labelCarrier, ctx.transporterName) +
    line(s.labelCui, ctx.transporterCui) +
    line(s.labelAddress, ctx.transporterAddress) +
    line(s.labelPlate, ctx.truckRegistrationPlate) +
    line(s.labelTrailer, ctx.trailerRegistrationPlate) +
    line(s.labelCapacity, capacity) +
    `\n${s.sectionDriverUpper}\n` +
    line(s.labelDriver, ctx.driverName) +
    line(s.labelContactPhone, ctx.requesterPhone) +
    `\n${s.sectionRouteUpper}\n` +
    `${s.pickupLabel}: ${ctx.pickup.label}${ctx.pickup.address ? `, ${ctx.pickup.address}` : ''}\n` +
    (ctx.pickup.mapsUrl ? `${ctx.pickup.mapsUrl}\n` : '') +
    `${s.deliveryLabel}: ${ctx.delivery.address ?? '-'}\n` +
    (ctx.delivery.mapsUrl ? `${ctx.delivery.mapsUrl}\n` : '') +
    (km ? `${s.distanceLabel}: ${km}\n` : '') +
    (ctx.routeUrl ? `${s.routeWord}: ${ctx.routeUrl}\n` : '') +
    (ctx.notes ? `\n${s.notesLabel}: ${ctx.notes}\n` : '');

  const locBlock = (loc: TransportLocation, color: string, icon: string) => `
      <div style="border:1px solid #e5e7eb;border-left:4px solid ${color};border-radius:10px;padding:12px 14px;margin:10px 0">
        <div style="font-weight:700;font-size:13px;color:#374151">${icon} ${esc(loc.label)}</div>
        <div style="font-size:14px;color:#111827;margin-top:2px">${esc(loc.address) || '—'}</div>
        ${loc.mapsUrl ? `<a href="${esc(loc.mapsUrl)}" style="display:inline-block;margin-top:6px;font-size:13px;color:${color};text-decoration:none">${s.openMapsLink}</a>` : ''}
      </div>`;

  const summaryRow = (label: string, value: string | null) =>
    value
      ? `<tr><td style="padding:4px 16px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:4px 0;font-size:13px;color:#111827;font-weight:500">${esc(value)}</td></tr>`
      : '';

  // A titled section — collapses to '' when it has no non-empty rows.
  const section = (title: string, rowsHtml: string) =>
    rowsHtml.trim()
      ? `<div style="margin:20px 0 0">
             <div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#0A5C36;margin:0 0 8px">${esc(title)}</div>
             <table style="border-collapse:collapse;width:100%">${rowsHtml}</table>
           </div>`
      : '';

  const html = `
      <div style="background:#f3f4f6;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
          <div style="background:linear-gradient(135deg,#0A5C36 0%,#1E8449 100%);padding:24px 28px">
            <table role="presentation" style="width:100%;border-collapse:collapse"><tr>
              ${ctx.logoUrl ? `<td style="width:46px;vertical-align:middle;padding-right:14px"><img src="${esc(ctx.logoUrl)}" alt="" width="46" height="46" style="display:block;border-radius:10px" /></td>` : ''}
              <td style="vertical-align:middle">
                <div style="color:#ffffff;font-size:21px;font-weight:700;letter-spacing:-.01em">${s.headerTitle}</div>
                <div style="color:#d9ecd9;font-size:13px;margin-top:3px">${esc(ctx.organizationName)}</div>
              </td>
            </tr></table>
          </div>
          <div style="padding:24px 28px;color:#1f2937">
            <p style="margin:0 0 6px;font-size:15px">${s.greetingBare}${ctx.recipientName ? `, <strong>${esc(ctx.recipientName)}</strong>` : ''},</p>
            <p style="margin:0 0 2px;font-size:14px;color:#4b5563">${s.htmlIntro}</p>
            ${section(
              s.sectionDetails,
              [
                summaryRow(s.labelQuality, quality),
                summaryRow(s.labelCrop, ctx.cropType),
                summaryRow(s.labelQuantity, tons),
                summaryRow(s.labelNeededDate, ctx.neededDate),
              ].join(''),
            )}
            ${section(
              s.sectionCompany,
              [
                summaryRow(s.labelCompany, ctx.companyName),
                summaryRow(s.labelCui, ctx.companyCui),
                summaryRow(s.labelAddress, ctx.companyAddress),
              ].join(''),
            )}
            ${section(
              s.sectionCarrier,
              [
                summaryRow(s.labelCarrier, ctx.transporterName),
                summaryRow(s.labelCui, ctx.transporterCui),
                summaryRow(s.labelAddress, ctx.transporterAddress),
                summaryRow(s.labelPlate, ctx.truckRegistrationPlate),
                summaryRow(s.labelTrailer, ctx.trailerRegistrationPlate),
                summaryRow(s.labelCapacity, capacity),
              ].join(''),
            )}
            ${section(
              s.sectionDriver,
              [
                summaryRow(s.labelDriver, ctx.driverName),
                summaryRow(s.labelContactPhone, ctx.requesterPhone),
              ].join(''),
            )}
            <div style="margin:20px 0 0">
              <div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#0A5C36;margin:0 0 8px">${s.routeWord}</div>
              ${locBlock(ctx.pickup, '#16a34a', '📍')}
              ${locBlock(ctx.delivery, '#dc2626', '🏁')}
              ${km ? `<p style="margin:12px 0 4px;font-size:14px"><strong>${s.distanceLabel}:</strong> ${km}${ctx.routeUrl ? ` &nbsp;·&nbsp; <a href="${esc(ctx.routeUrl)}" style="color:#1d4ed8;text-decoration:none">${s.viewRoute}</a>` : ''}</p>` : ''}
              ${ctx.staticMapUrl ? `<img src="${esc(ctx.staticMapUrl)}" width="600" style="display:block;max-width:100%;border-radius:10px;margin-top:10px;border:1px solid #e5e7eb" alt="${s.routeMapAlt}" />` : ''}
            </div>
            ${ctx.notes ? `<div style="margin:20px 0 0;padding:12px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px"><div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#6b7280;margin:0 0 4px">${s.notesLabel}</div><div style="font-size:14px;color:#111827;white-space:pre-line">${esc(ctx.notes)}</div></div>` : ''}
          </div>
          <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #eef0f2;text-align:center">
            <div style="font-size:11px;color:#9ca3af">${s.footerSentBy} <strong style="color:#0A5C36">StrawBoss</strong>${ctx.organizationName ? ` · ${esc(ctx.organizationName)}` : ''}</div>
          </div>
        </div>
      </div>`;

  return { subject, body, html };
}

// ─────────────────────────────────────────────────────────────────────────
// transport_confirmed_driver_sms (SMS)
// ─────────────────────────────────────────────────────────────────────────

const TRANSPORT_CONFIRMED_SMS_STRINGS: Record<
  Locale,
  { confirmed: string; dateLabel: string; pickupLabel: string; deliveryLabel: string }
> = {
  ro: {
    confirmed: 'Transport confirmat.',
    dateLabel: 'Data',
    pickupLabel: 'Ridicare',
    deliveryLabel: 'Livrare',
  },
  en: {
    confirmed: 'Transport confirmed.',
    dateLabel: 'Date',
    pickupLabel: 'Pickup',
    deliveryLabel: 'Delivery',
  },
  hu: {
    confirmed: 'A fuvar megerősítve.',
    dateLabel: 'Dátum',
    pickupLabel: 'Felvétel',
    deliveryLabel: 'Szállítás',
  },
};

function renderTransportConfirmedDriverSms(ctx: TransportConfirmedSmsCtx, locale: Locale) {
  const s = TRANSPORT_CONFIRMED_SMS_STRINGS[locale];
  const km = ctx.distanceKm != null ? ` (~${Math.round(ctx.distanceKm)} km)` : '';
  const body =
    s.confirmed +
    (ctx.neededDate ? ` ${s.dateLabel}: ${ctx.neededDate}.` : '') +
    `\n${s.pickupLabel}: ${ctx.pickupName}${ctx.pickupMapsUrl ? ` ${ctx.pickupMapsUrl}` : ''}` +
    `\n${s.deliveryLabel}: ${ctx.deliveryAddress ?? '-'}${ctx.deliveryMapsUrl ? ` ${ctx.deliveryMapsUrl}` : ''}` +
    km;
  return { body };
}

// ─────────────────────────────────────────────────────────────────────────
// aviz_uploaded (email)
// ─────────────────────────────────────────────────────────────────────────

const AVIZ_UPLOADED_STRINGS: Record<
  Locale,
  {
    subjectBase: string;
    greetingPrefix: string;
    greetingNoName: string;
    bodyLoadedIntro: string;
    forCompanyPrefix: string;
    truckLabel: string;
    dateLabel: string;
    downloadLabel: string;
    attachedNote: string;
    htmlTitle: string;
    htmlIntro: string;
    htmlButton: string;
    labelCompany: string;
  }
> = {
  ro: {
    subjectBase: 'Aviz de transport',
    greetingPrefix: 'Bună ziua, ',
    greetingNoName: 'Bună ziua,',
    bodyLoadedIntro: 'Avizul de însoțire a mărfii a fost încărcat',
    forCompanyPrefix: ' pentru ',
    truckLabel: 'Camion',
    dateLabel: 'Data',
    downloadLabel: 'Descarcă avizul',
    attachedNote: '(Avizul este atașat și ca PDF la acest email.)',
    htmlTitle: 'Aviz de transport',
    htmlIntro:
      'Avizul de însoțire a mărfii a fost încărcat. Îl poți descărca de mai jos; este atașat și ca PDF la acest email.',
    htmlButton: 'Descarcă avizul (PDF)',
    labelCompany: 'Firmă',
  },
  en: {
    subjectBase: 'Transport advice note',
    greetingPrefix: 'Hello, ',
    greetingNoName: 'Hello,',
    bodyLoadedIntro: 'The goods accompanying advice note has been uploaded',
    forCompanyPrefix: ' for ',
    truckLabel: 'Truck',
    dateLabel: 'Date',
    downloadLabel: 'Download the advice note',
    attachedNote: '(The advice note is also attached to this email as a PDF.)',
    htmlTitle: 'Transport advice note',
    htmlIntro:
      'The goods accompanying advice note has been uploaded. You can download it below; it is also attached to this email as a PDF.',
    htmlButton: 'Download the advice note (PDF)',
    labelCompany: 'Company',
  },
  hu: {
    subjectBase: 'Szállítólevél',
    greetingPrefix: 'Jó napot, ',
    greetingNoName: 'Jó napot,',
    bodyLoadedIntro: 'Az áru kísérő szállítólevele feltöltésre került',
    forCompanyPrefix: ' a következő részére: ',
    truckLabel: 'Kamion',
    dateLabel: 'Dátum',
    downloadLabel: 'Szállítólevél letöltése',
    attachedNote: '(A szállítólevelet PDF formátumban is csatoltuk ehhez az e-mailhez.)',
    htmlTitle: 'Szállítólevél',
    htmlIntro:
      'Az áru kísérő szállítólevele feltöltésre került. Alább letöltheti; ehhez az e-mailhez PDF formátumban is csatoltuk.',
    htmlButton: 'Szállítólevél letöltése (PDF)',
    labelCompany: 'Cég',
  },
};

function renderAvizUploaded(ctx: AvizUploadedCtx, locale: Locale) {
  const s = AVIZ_UPLOADED_STRINGS[locale];
  const who = ctx.companyName ?? ctx.truckRegistrationPlate ?? null;
  const subject = `${s.subjectBase}${who ? ` — ${who}` : ''}`;
  const greeting = ctx.recipientName
    ? `${s.greetingPrefix}${ctx.recipientName},`
    : s.greetingNoName;

  const body =
    `${greeting}\n\n` +
    s.bodyLoadedIntro +
    (ctx.companyName ? `${s.forCompanyPrefix}${ctx.companyName}` : '') +
    `.\n` +
    (ctx.truckRegistrationPlate ? `${s.truckLabel}: ${ctx.truckRegistrationPlate}\n` : '') +
    (ctx.neededDate ? `${s.dateLabel}: ${ctx.neededDate}\n` : '') +
    `\n${s.downloadLabel}: ${ctx.downloadUrl}\n` +
    `${s.attachedNote}\n\n` +
    `— ${ctx.organizationName}`;

  const logo = ctx.logoUrl
    ? `<img src="${esc(ctx.logoUrl)}" alt="${esc(ctx.organizationName)}" style="height:40px;display:block;margin:0 auto 8px" />`
    : '';
  const rows = [
    ctx.companyName ? [s.labelCompany, ctx.companyName] : null,
    ctx.truckRegistrationPlate ? [s.truckLabel, ctx.truckRegistrationPlate] : null,
    ctx.neededDate ? [s.dateLabel, ctx.neededDate] : null,
  ].filter(Boolean) as [string, string][];
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:13px">${esc(k)}</td>` +
        `<td style="padding:4px 0;color:#0f172a;font-size:13px;font-weight:600">${esc(v)}</td></tr>`,
    )
    .join('');

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f1f5f9;padding:24px">` +
    `<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">` +
    `<div style="background:linear-gradient(135deg,#16a34a,#15803d);padding:20px;text-align:center">` +
    logo +
    `<div style="color:#fff;font-size:18px;font-weight:700">${s.htmlTitle}</div></div>` +
    `<div style="padding:20px">` +
    `<p style="margin:0 0 12px;color:#0f172a;font-size:14px">${esc(greeting)}</p>` +
    `<p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.5">${s.htmlIntro}</p>` +
    (rowsHtml ? `<table style="margin:0 0 16px">${rowsHtml}</table>` : '') +
    `<a href="${esc(ctx.downloadUrl)}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-size:14px;font-weight:600">${s.htmlButton}</a>` +
    `<p style="margin:16px 0 0;color:#94a3b8;font-size:12px">${esc(ctx.organizationName)}</p>` +
    `</div></div></div>`;

  return { subject, body, html };
}

// ─────────────────────────────────────────────────────────────────────────
// aviz_uploaded_sms (SMS)
// ─────────────────────────────────────────────────────────────────────────

// RO/HU labels stay diacritic-free on purpose — GSM-7 encoding, fewer SMS
// segments (same reasoning as the original Romanian-only literal).
const AVIZ_UPLOADED_SMS_STRINGS: Record<Locale, { label: string }> = {
  ro: { label: 'Aviz transport' },
  en: { label: 'Transport advice' },
  hu: { label: 'Szallitolevel' },
};

function renderAvizUploadedSms(ctx: AvizUploadedSmsCtx, locale: Locale) {
  const s = AVIZ_UPLOADED_SMS_STRINGS[locale];
  return {
    body: `${s.label}${ctx.truckRegistrationPlate ? ` ${ctx.truckRegistrationPlate}` : ''}: ${ctx.downloadUrl}`,
  };
}

export const messageTemplates = {
  [MessageKind.new_request_admin]: {
    ro: (ctx: NewRequestAdminCtx) => renderNewRequestAdmin(ctx, 'ro'),
    en: (ctx: NewRequestAdminCtx) => renderNewRequestAdmin(ctx, 'en'),
    hu: (ctx: NewRequestAdminCtx) => renderNewRequestAdmin(ctx, 'hu'),
  },

  [MessageKind.request_confirmed_requester]: {
    ro: (ctx: RequestConfirmedCtx) => renderRequestConfirmedRequester(ctx, 'ro'),
    en: (ctx: RequestConfirmedCtx) => renderRequestConfirmedRequester(ctx, 'en'),
    hu: (ctx: RequestConfirmedCtx) => renderRequestConfirmedRequester(ctx, 'hu'),
  },

  [MessageKind.driver_assigned]: {
    ro: (ctx: DriverAssignedCtx) => renderDriverAssigned(ctx, 'ro'),
    en: (ctx: DriverAssignedCtx) => renderDriverAssigned(ctx, 'en'),
    hu: (ctx: DriverAssignedCtx) => renderDriverAssigned(ctx, 'hu'),
  },

  [MessageKind.driver_arrival_cmr_link]: {
    ro: (ctx: DriverArrivalCmrLinkCtx) => renderDriverArrivalCmrLink(ctx, 'ro'),
    en: (ctx: DriverArrivalCmrLinkCtx) => renderDriverArrivalCmrLink(ctx, 'en'),
    hu: (ctx: DriverArrivalCmrLinkCtx) => renderDriverArrivalCmrLink(ctx, 'hu'),
  },

  [MessageKind.transport_confirmed]: {
    ro: (ctx: TransportConfirmedCtx) => renderTransportConfirmed(ctx, 'ro'),
    en: (ctx: TransportConfirmedCtx) => renderTransportConfirmed(ctx, 'en'),
    hu: (ctx: TransportConfirmedCtx) => renderTransportConfirmed(ctx, 'hu'),
  },

  [MessageKind.transport_confirmed_driver_sms]: {
    ro: (ctx: TransportConfirmedSmsCtx) => renderTransportConfirmedDriverSms(ctx, 'ro'),
    en: (ctx: TransportConfirmedSmsCtx) => renderTransportConfirmedDriverSms(ctx, 'en'),
    hu: (ctx: TransportConfirmedSmsCtx) => renderTransportConfirmedDriverSms(ctx, 'hu'),
  },

  [MessageKind.aviz_uploaded]: {
    ro: (ctx: AvizUploadedCtx) => renderAvizUploaded(ctx, 'ro'),
    en: (ctx: AvizUploadedCtx) => renderAvizUploaded(ctx, 'en'),
    hu: (ctx: AvizUploadedCtx) => renderAvizUploaded(ctx, 'hu'),
  },

  [MessageKind.aviz_uploaded_sms]: {
    ro: (ctx: AvizUploadedSmsCtx) => renderAvizUploadedSms(ctx, 'ro'),
    en: (ctx: AvizUploadedSmsCtx) => renderAvizUploadedSms(ctx, 'en'),
    hu: (ctx: AvizUploadedSmsCtx) => renderAvizUploadedSms(ctx, 'hu'),
  },
};

export { fmtCoordsUrl, fmtDirectionsUrl };
