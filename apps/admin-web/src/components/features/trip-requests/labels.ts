import type { TripRequest } from '@strawboss/types';

/** i18n key for a beneficiary quality grade ('quality_1' | 'quality_2'). */
export function qualityLabelKey(quality: string): string {
  return quality === 'quality_1' ? 'tripRequests.quality1' : 'tripRequests.quality2';
}

/**
 * The external truck, as "Make Model · PLATE".
 *
 * Read from the REQUEST, never from the `machines` row. The one-time auxiliary
 * machine minted at confirm() is only a copy of these fields, and it is
 * soft-deleted the moment the load is registered (applyAuxiliaryLoadedSideEffects) —
 * so any link to /machines/:id 404s for exactly the requests you most want to
 * look at. The request is the durable record.
 */
export function truckLabel(r: TripRequest): string {
  const name = [r.truckMake, r.truckModel].filter(Boolean).join(' ').trim();
  const plate = r.truckRegistrationPlate?.trim();
  if (name && plate) return `${name} · ${plate}`;
  return plate || name || '';
}
