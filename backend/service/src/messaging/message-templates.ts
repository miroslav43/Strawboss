import { MessageKind } from '@strawboss/types';

/**
 * Pure render functions per MessageKind. They produce the human-readable
 * subject/body only — channel + recipient are decided by the call site. Romanian
 * copy to match the rest of the operator-facing app.
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

/** Human label for the beneficiary quality grade. */
function qualityLabel(quality: string | null | undefined): string | null {
  if (quality === 'quality_1') return 'Calitate 1';
  if (quality === 'quality_2') return 'Calitate 2';
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

export interface DriverSignLinkCtx {
  signUrl: string;
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

export const messageTemplates = {
  [MessageKind.new_request_admin]: (ctx: NewRequestAdminCtx) => ({
    subject: `Cerere nouă de transport${ctx.companyName ? ` — ${ctx.companyName}` : ''}`,
    body:
      `O nouă cerere de transport a fost trimisă prin portal.\n\n` +
      `Solicitant: ${ctx.requesterName} (${ctx.requesterPhone})\n` +
      (ctx.companyName ? `Firmă: ${ctx.companyName}\n` : '') +
      (ctx.cropType ? `Recoltă: ${ctx.cropType}\n` : '') +
      (qualityLabel(ctx.quality) ? `Calitate: ${qualityLabel(ctx.quality)}\n` : '') +
      (ctx.neededDate ? `Data necesară: ${ctx.neededDate}\n` : '') +
      (ctx.destinationAddress ? `Livrare la: ${ctx.destinationAddress}\n` : '') +
      `\nConfirmați sau anulați cererea din pagina Curse, secțiunea „De confirmat".`,
  }),

  [MessageKind.request_confirmed_requester]: (ctx: RequestConfirmedCtx) => ({
    subject: `Cererea dvs. de transport a fost confirmată`,
    body:
      `Bună ziua, ${ctx.requesterName}.\n\n` +
      `Cererea dvs. de transport către ${ctx.organizationName} a fost confirmată` +
      (ctx.neededDate ? ` pentru data ${ctx.neededDate}` : '') +
      `.\nȘoferul va primi instrucțiunile de încărcare prin SMS.`,
  }),

  [MessageKind.driver_assigned]: (ctx: DriverAssignedCtx) => ({
    body:
      `Ați fost asignat pentru încărcare.\n` +
      (ctx.parcelName ? `Parcelă: ${ctx.parcelName}` : 'Parcelă: -') +
      (ctx.locality ? `, ${ctx.locality}` : '') +
      `\n` +
      (ctx.loaderName ? `Operator încărcare: ${ctx.loaderName}` : '') +
      (ctx.loaderPhone ? ` (tel: ${ctx.loaderPhone})` : '') +
      (ctx.cropType ? `\nRecoltă: ${ctx.cropType}` : '') +
      (ctx.mapsUrl ? `\nHartă: ${ctx.mapsUrl}` : ''),
  }),

  [MessageKind.driver_loaded_sign_link]: (ctx: DriverSignLinkCtx) => ({
    body:
      `Încărcarea a fost finalizată (${ctx.baleCount} baloți).\n` +
      `Confirmați și semnați aici pentru a pleca:\n${ctx.signUrl}`,
  }),

  [MessageKind.transport_confirmed]: (ctx: TransportConfirmedCtx) => {
    const km = ctx.distanceKm != null ? `~${Math.round(ctx.distanceKm)} km` : null;
    const subject = `Transport confirmat — ridicare din ${ctx.pickup.address ?? ctx.pickup.label}`;

    // Numeric columns arrive as strings from postgres.js — normalize + trim
    // trailing zeros so "40.00" renders as "40 t".
    const fmtTons = (v: number | string | null): string | null => {
      if (v == null) return null;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return null;
      const s = Number.isInteger(n)
        ? String(n)
        : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
      return `${s} t`;
    };

    const quality = qualityLabel(ctx.quality);
    const tons = fmtTons(ctx.tonsRequested);
    const capacity = fmtTons(ctx.truckCapacityTons);

    // Plain-text fallback — mirrors the HTML sections, only non-empty lines.
    const line = (label: string, value: string | null) => (value ? `${label}: ${value}\n` : '');
    const body =
      `Bună ziua${ctx.recipientName ? `, ${ctx.recipientName}` : ''}.\n\n` +
      `Transportul a fost confirmat de ${ctx.organizationName}.\n\n` +
      `DETALII TRANSPORT\n` +
      line('Calitate', quality) +
      line('Recoltă', ctx.cropType) +
      line('Cantitate', tons) +
      line('Data necesară', ctx.neededDate) +
      `\nFIRMĂ BENEFICIAR\n` +
      line('Firmă', ctx.companyName) +
      line('CUI', ctx.companyCui) +
      line('Adresă', ctx.companyAddress) +
      `\nTRANSPORTATOR & CAMION\n` +
      line('Transportator', ctx.transporterName) +
      line('CUI', ctx.transporterCui) +
      line('Adresă', ctx.transporterAddress) +
      line('Nr. înmatriculare', ctx.truckRegistrationPlate) +
      line('Remorcă', ctx.trailerRegistrationPlate) +
      line('Capacitate', capacity) +
      `\nȘOFER & CONTACT\n` +
      line('Șofer', ctx.driverName) +
      line('Telefon contact', ctx.requesterPhone) +
      `\nRUTĂ\n` +
      `Ridicare (depozit): ${ctx.pickup.label}${ctx.pickup.address ? `, ${ctx.pickup.address}` : ''}\n` +
      (ctx.pickup.mapsUrl ? `${ctx.pickup.mapsUrl}\n` : '') +
      `Livrare: ${ctx.delivery.address ?? '-'}\n` +
      (ctx.delivery.mapsUrl ? `${ctx.delivery.mapsUrl}\n` : '') +
      (km ? `Distanță: ${km}\n` : '') +
      (ctx.routeUrl ? `Rută: ${ctx.routeUrl}\n` : '') +
      (ctx.notes ? `\nNote: ${ctx.notes}\n` : '');

    const locBlock = (loc: TransportLocation, color: string, icon: string) => `
      <div style="border:1px solid #e5e7eb;border-left:4px solid ${color};border-radius:10px;padding:12px 14px;margin:10px 0">
        <div style="font-weight:700;font-size:13px;color:#374151">${icon} ${esc(loc.label)}</div>
        <div style="font-size:14px;color:#111827;margin-top:2px">${esc(loc.address) || '—'}</div>
        ${loc.mapsUrl ? `<a href="${esc(loc.mapsUrl)}" style="display:inline-block;margin-top:6px;font-size:13px;color:${color};text-decoration:none">↗ Deschide în Google Maps</a>` : ''}
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
                <div style="color:#ffffff;font-size:21px;font-weight:700;letter-spacing:-.01em">✅ Transport confirmat</div>
                <div style="color:#d9ecd9;font-size:13px;margin-top:3px">${esc(ctx.organizationName)}</div>
              </td>
            </tr></table>
          </div>
          <div style="padding:24px 28px;color:#1f2937">
            <p style="margin:0 0 6px;font-size:15px">Bună ziua${ctx.recipientName ? `, <strong>${esc(ctx.recipientName)}</strong>` : ''},</p>
            <p style="margin:0 0 2px;font-size:14px;color:#4b5563">Cererea de transport a fost confirmată. Mai jos aveți toate detaliile cursei.</p>
            ${section(
              'Detalii transport',
              [
                summaryRow('Calitate', quality),
                summaryRow('Recoltă', ctx.cropType),
                summaryRow('Cantitate', tons),
                summaryRow('Data necesară', ctx.neededDate),
              ].join(''),
            )}
            ${section(
              'Firmă beneficiar',
              [
                summaryRow('Firmă', ctx.companyName),
                summaryRow('CUI', ctx.companyCui),
                summaryRow('Adresă', ctx.companyAddress),
              ].join(''),
            )}
            ${section(
              'Transportator & camion',
              [
                summaryRow('Transportator', ctx.transporterName),
                summaryRow('CUI', ctx.transporterCui),
                summaryRow('Adresă', ctx.transporterAddress),
                summaryRow('Nr. înmatriculare', ctx.truckRegistrationPlate),
                summaryRow('Remorcă', ctx.trailerRegistrationPlate),
                summaryRow('Capacitate', capacity),
              ].join(''),
            )}
            ${section(
              'Șofer & contact',
              [
                summaryRow('Șofer', ctx.driverName),
                summaryRow('Telefon contact', ctx.requesterPhone),
              ].join(''),
            )}
            <div style="margin:20px 0 0">
              <div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#0A5C36;margin:0 0 8px">Rută</div>
              ${locBlock(ctx.pickup, '#16a34a', '📍')}
              ${locBlock(ctx.delivery, '#dc2626', '🏁')}
              ${km ? `<p style="margin:12px 0 4px;font-size:14px"><strong>Distanță:</strong> ${km}${ctx.routeUrl ? ` &nbsp;·&nbsp; <a href="${esc(ctx.routeUrl)}" style="color:#1d4ed8;text-decoration:none">Vezi ruta ↗</a>` : ''}</p>` : ''}
              ${ctx.staticMapUrl ? `<img src="${esc(ctx.staticMapUrl)}" width="600" style="display:block;max-width:100%;border-radius:10px;margin-top:10px;border:1px solid #e5e7eb" alt="Rută depozit → livrare" />` : ''}
            </div>
            ${ctx.notes ? `<div style="margin:20px 0 0;padding:12px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px"><div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#6b7280;margin:0 0 4px">Note</div><div style="font-size:14px;color:#111827;white-space:pre-line">${esc(ctx.notes)}</div></div>` : ''}
          </div>
          <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #eef0f2;text-align:center">
            <div style="font-size:11px;color:#9ca3af">Mesaj trimis automat de <strong style="color:#0A5C36">StrawBoss</strong>${ctx.organizationName ? ` · ${esc(ctx.organizationName)}` : ''}</div>
          </div>
        </div>
      </div>`;

    return { subject, body, html };
  },

  [MessageKind.transport_confirmed_driver_sms]: (ctx: TransportConfirmedSmsCtx) => {
    const km = ctx.distanceKm != null ? ` (~${Math.round(ctx.distanceKm)} km)` : '';
    return {
      body:
        `Transport confirmat.` +
        (ctx.neededDate ? ` Data: ${ctx.neededDate}.` : '') +
        `\nRidicare: ${ctx.pickupName}${ctx.pickupMapsUrl ? ` ${ctx.pickupMapsUrl}` : ''}` +
        `\nLivrare: ${ctx.deliveryAddress ?? '-'}${ctx.deliveryMapsUrl ? ` ${ctx.deliveryMapsUrl}` : ''}` +
        km,
    };
  },

  [MessageKind.aviz_uploaded]: (ctx: AvizUploadedCtx) => {
    const who = ctx.companyName ?? ctx.truckRegistrationPlate ?? null;
    const subject = `Aviz de transport${who ? ` — ${who}` : ''}`;
    const greeting = ctx.recipientName ? `Bună ziua, ${ctx.recipientName},` : 'Bună ziua,';

    const body =
      `${greeting}\n\n` +
      `Avizul de însoțire a mărfii a fost încărcat` +
      (ctx.companyName ? ` pentru ${ctx.companyName}` : '') +
      `.\n` +
      (ctx.truckRegistrationPlate ? `Camion: ${ctx.truckRegistrationPlate}\n` : '') +
      (ctx.neededDate ? `Data: ${ctx.neededDate}\n` : '') +
      `\nDescarcă avizul: ${ctx.downloadUrl}\n` +
      `(Avizul este atașat și ca PDF la acest email.)\n\n` +
      `— ${ctx.organizationName}`;

    const logo = ctx.logoUrl
      ? `<img src="${esc(ctx.logoUrl)}" alt="${esc(ctx.organizationName)}" style="height:40px;display:block;margin:0 auto 8px" />`
      : '';
    const rows = [
      ctx.companyName ? ['Firmă', ctx.companyName] : null,
      ctx.truckRegistrationPlate ? ['Camion', ctx.truckRegistrationPlate] : null,
      ctx.neededDate ? ['Data', ctx.neededDate] : null,
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
      `<div style="color:#fff;font-size:18px;font-weight:700">Aviz de transport</div></div>` +
      `<div style="padding:20px">` +
      `<p style="margin:0 0 12px;color:#0f172a;font-size:14px">${esc(greeting)}</p>` +
      `<p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.5">Avizul de însoțire a mărfii a fost încărcat. Îl poți descărca de mai jos; este atașat și ca PDF la acest email.</p>` +
      (rowsHtml ? `<table style="margin:0 0 16px">${rowsHtml}</table>` : '') +
      `<a href="${esc(ctx.downloadUrl)}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-size:14px;font-weight:600">Descarcă avizul (PDF)</a>` +
      `<p style="margin:16px 0 0;color:#94a3b8;font-size:12px">${esc(ctx.organizationName)}</p>` +
      `</div></div></div>`;

    return { subject, body, html };
  },

  [MessageKind.aviz_uploaded_sms]: (ctx: AvizUploadedSmsCtx) => ({
    // GSM-7 friendly (no diacritics) so the SMS stays as few segments as possible.
    body: `Aviz transport${ctx.truckRegistrationPlate ? ` ${ctx.truckRegistrationPlate}` : ''}: ${ctx.downloadUrl}`,
  }),
};

export { fmtCoordsUrl, fmtDirectionsUrl };
