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
  neededDate: string | null;
  tonsRequested: number | null;
  destinationAddress: string | null;
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

function fmtCoordsUrl(
  lat: number | null | undefined,
  lon: number | null | undefined,
): string | null {
  if (lat == null || lon == null) return null;
  return `https://www.google.com/maps?q=${lat},${lon}`;
}

export const messageTemplates = {
  [MessageKind.new_request_admin]: (ctx: NewRequestAdminCtx) => ({
    subject: `Cerere nouă de transport${ctx.companyName ? ` — ${ctx.companyName}` : ''}`,
    body:
      `O nouă cerere de transport a fost trimisă prin portal.\n\n` +
      `Solicitant: ${ctx.requesterName} (${ctx.requesterPhone})\n` +
      (ctx.companyName ? `Firmă: ${ctx.companyName}\n` : '') +
      (ctx.cropType ? `Recoltă: ${ctx.cropType}\n` : '') +
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
};

export { fmtCoordsUrl };
