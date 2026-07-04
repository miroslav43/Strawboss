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
  tonsRequested: number | null;
  neededDate: string | null;
  notes: string | null;
  pickup: TransportLocation;
  delivery: TransportLocation;
  routeUrl: string | null;
  distanceKm: number | null;
  staticMapUrl: string | null;
}

export interface TransportConfirmedSmsCtx {
  pickupName: string;
  pickupMapsUrl: string | null;
  deliveryAddress: string | null;
  deliveryMapsUrl: string | null;
  distanceKm: number | null;
  neededDate: string | null;
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
      (ctx.tonsRequested != null ? `Tone: ${ctx.tonsRequested}\n` : '') +
      (ctx.neededDate ? `Data necesară: ${ctx.neededDate}\n` : '') +
      (ctx.destinationAddress ? `Livrare la: ${ctx.destinationAddress}\n` : '') +
      `\nConfirmați sau anulați cererea din pagina Cereri transport.`,
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

    const body =
      `Bună ziua${ctx.recipientName ? `, ${ctx.recipientName}` : ''}.\n\n` +
      `Transportul a fost confirmat de ${ctx.organizationName}.\n\n` +
      `RIDICARE (depozit): ${ctx.pickup.label}${ctx.pickup.address ? `, ${ctx.pickup.address}` : ''}\n` +
      (ctx.pickup.mapsUrl ? `${ctx.pickup.mapsUrl}\n` : '') +
      `LIVRARE: ${ctx.delivery.address ?? '-'}\n` +
      (ctx.delivery.mapsUrl ? `${ctx.delivery.mapsUrl}\n` : '') +
      (km ? `\nDistanță: ${km}\n` : '') +
      (ctx.routeUrl ? `Rută: ${ctx.routeUrl}\n` : '') +
      (ctx.cropType ? `\nRecoltă: ${ctx.cropType}` : '') +
      (ctx.tonsRequested != null ? `\nTone: ${ctx.tonsRequested}` : '') +
      (ctx.neededDate ? `\nData necesară: ${ctx.neededDate}` : '') +
      (ctx.driverName ? `\nȘofer: ${ctx.driverName}` : '') +
      (ctx.notes ? `\nNote: ${ctx.notes}` : '');

    const locBlock = (loc: TransportLocation, color: string, icon: string) => `
      <div style="border:1px solid #e5e7eb;border-left:4px solid ${color};border-radius:8px;padding:12px 14px;margin:10px 0">
        <div style="font-weight:700;font-size:13px;color:#374151">${icon} ${esc(loc.label)}</div>
        <div style="font-size:14px;color:#111827;margin-top:2px">${esc(loc.address) || '—'}</div>
        ${loc.mapsUrl ? `<a href="${esc(loc.mapsUrl)}" style="display:inline-block;margin-top:6px;font-size:13px;color:${color};text-decoration:none">↗ Deschide în Google Maps</a>` : ''}
      </div>`;

    const summaryRow = (label: string, value: string | null) =>
      value
        ? `<tr><td style="padding:2px 10px 2px 0;color:#6b7280;font-size:13px">${esc(label)}</td><td style="padding:2px 0;font-size:13px;color:#111827">${esc(value)}</td></tr>`
        : '';

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
        <div style="background:#4f7942;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0">
          <div style="font-size:19px;font-weight:700">Transport confirmat</div>
          <div style="font-size:13px;opacity:.9;margin-top:2px">${esc(ctx.organizationName)}</div>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:20px 22px;border-radius:0 0 12px 12px">
          <p style="margin:0 0 14px">Bună ziua${ctx.recipientName ? `, ${esc(ctx.recipientName)}` : ''},</p>
          <p style="margin:0 0 14px">Cererea de transport a fost confirmată. Mai jos aveți detaliile cursei.</p>
          <table style="border-collapse:collapse;margin:0 0 6px">
            ${summaryRow('Șofer', ctx.driverName)}
            ${summaryRow('Recoltă', ctx.cropType)}
            ${summaryRow('Tone', ctx.tonsRequested != null ? String(ctx.tonsRequested) : null)}
            ${summaryRow('Data necesară', ctx.neededDate)}
            ${summaryRow('Note', ctx.notes)}
          </table>
          ${locBlock(ctx.pickup, '#16a34a', '📍')}
          ${locBlock(ctx.delivery, '#dc2626', '🏁')}
          ${km ? `<p style="margin:12px 0 4px;font-size:14px"><strong>Distanță:</strong> ${km}${ctx.routeUrl ? ` &nbsp;·&nbsp; <a href="${esc(ctx.routeUrl)}" style="color:#1d4ed8;text-decoration:none">Vezi ruta ↗</a>` : ''}</p>` : ''}
          ${ctx.staticMapUrl ? `<img src="${esc(ctx.staticMapUrl)}" width="600" style="display:block;max-width:100%;border-radius:8px;margin-top:10px;border:1px solid #e5e7eb" alt="Rută depozit → livrare" />` : ''}
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
};

export { fmtCoordsUrl, fmtDirectionsUrl };
