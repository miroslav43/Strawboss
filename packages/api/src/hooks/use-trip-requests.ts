import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TripRequest, OrgRequestSettings, Document } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

/**
 * Admin/dispatcher: list external trip requests.
 *
 * Filters: `status`, `search`, `dateFrom`, `dateTo` (bare `YYYY-MM-DD`), `limit`
 * (default 200 server-side), `offset`. Rows carry the live-trip read model
 * (`tripStatus`, `tripNumber`, `tripBaleCount`, …) joined server-side.
 *
 * Only pass keys you actually want in the query string: `URLSearchParams`
 * stringifies an `undefined` value to the literal text "undefined", which the
 * server would then try to parse.
 */
export function useTripRequests(client: ApiClient, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.tripRequests.list(filters),
    queryFn: () => {
      const params = filters ? `?${new URLSearchParams(filters as Record<string, string>)}` : '';
      return client.get<TripRequest[]>(`/api/v1/trip-requests${params}`);
    },
  });
}

export function useTripRequest(client: ApiClient, id: string) {
  return useQuery({
    queryKey: queryKeys.tripRequests.detail(id),
    queryFn: () => client.get<TripRequest>(`/api/v1/trip-requests/${id}`),
    enabled: !!id,
  });
}

/**
 * Confirm a request → spins up a one-time auxiliary truck (machine). Invalidates
 * trip-requests + machines + task plan so the new truck shows on the board.
 */
export function useConfirmTripRequest(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      internalCode,
      depotId,
      parcelId,
    }: {
      id: string;
      internalCode?: string;
      depotId?: string;
      parcelId?: string;
    }) =>
      client.post<TripRequest>(`/api/v1/trip-requests/${id}/confirm`, {
        internalCode,
        depotId,
        parcelId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tripRequests.all });
      void qc.invalidateQueries({ queryKey: queryKeys.machines.all });
      void qc.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
    },
  });
}

/**
 * Cancel a request. Allowed for a pending one, and for a CONFIRMED one that has no
 * live trip yet — cancelling then also RETIRES the one-time auxiliary truck, hence
 * the machines invalidation. If a trip is already planned the server refuses with
 * `has_live_trip`: delete the trip first (which un-plans it), then cancel.
 */
export function useCancelTripRequest(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      client.post<TripRequest>(`/api/v1/trip-requests/${id}/cancel`, { reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tripRequests.all });
      // The auxiliary truck is soft-deleted on cancel — drop it from the fleet and
      // the task board too, or it lingers as a phantom truck you can still plan.
      void qc.invalidateQueries({ queryKey: queryKeys.machines.all });
      void qc.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
    },
  });
}

/**
 * List the aviz (delivery-note PDF) document(s) attached to a request. With the
 * single-aviz model this returns 0 or 1 document.
 */
/**
 * Which surface the aviz/CMR hooks target. 'admin' hits the admin trip-requests /
 * cmr-scans endpoints; 'transporter' hits the ownership-scoped
 * /transporter/requests/:id/... endpoints (the transporter uploads docs for their
 * OWN requests). Default 'admin' keeps every existing call site unchanged.
 */
export type DocVariant = 'admin' | 'transporter';

/** Which end of the trip a CMR scan belongs to — see `CmrScanKind` in @strawboss/validation. */
export type CmrKind = 'loading' | 'delivery';

const avizPath = (variant: DocVariant, requestId: string) =>
  variant === 'transporter'
    ? `/api/v1/transporter/requests/${requestId}/aviz`
    : `/api/v1/trip-requests/${requestId}/aviz`;
const cmrPath = (variant: DocVariant, requestId: string, kind: CmrKind = 'loading') => {
  const base =
    variant === 'transporter'
      ? `/api/v1/transporter/requests/${requestId}/cmr`
      : `/api/v1/cmr-scans/trip-request/${requestId}`;
  return `${base}?kind=${kind}`;
};

export function useRequestAvize(
  client: ApiClient,
  requestId: string,
  variant: DocVariant = 'admin',
) {
  return useQuery({
    queryKey: queryKeys.tripRequests.avize(requestId),
    queryFn: () => client.get<Document[]>(avizPath(variant, requestId)),
    enabled: !!requestId,
  });
}

/**
 * Upload (or replace) the aviz PDF for a request. Invalidates that request's
 * avize list so the fresh PDF appears immediately, plus the request list (both
 * the admin and transporter ledgers, so `hasAviz` flips wherever it's shown).
 */
export function useUploadAviz(client: ApiClient, variant: DocVariant = 'admin') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, formData }: { requestId: string; formData: FormData }) =>
      client.upload<Document>(avizPath(variant, requestId), formData),
    onSuccess: (_doc, { requestId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.tripRequests.avize(requestId) });
      void qc.invalidateQueries({ queryKey: queryKeys.tripRequests.all });
      void qc.invalidateQueries({ queryKey: queryKeys.transporter.all });
    },
  });
}

/**
 * List the CMR scan of the given `kind` attached to a request — `loading`
 * (departure, the default) or `delivery` (arrival). Like the aviz, only one of
 * each kind is kept active at a time, so this returns 0 or 1 document.
 */
export function useRequestCmrScans(
  client: ApiClient,
  requestId: string,
  variant: DocVariant = 'admin',
  kind: CmrKind = 'loading',
) {
  return useQuery({
    queryKey: queryKeys.tripRequests.cmrScans(requestId, kind),
    queryFn: () => client.get<Document[]>(cmrPath(variant, requestId, kind)),
    enabled: !!requestId,
  });
}

/**
 * Upload (or replace) the CMR of the given `kind` for a request. `loading` is
 * normally posted by the loader from the phone against the trip instead;
 * admins and the transporter can override either kind, and `delivery` is also
 * how they can attach the arrival CMR on the driver's behalf.
 *
 * Invalidating `tripRequests.all` (+ `transporter.all`) is what flips the
 * button green: `hasCmrScan`/`hasCmrArrival` are computed server-side on the
 * *list* row, not on the document, so refetching the scan alone would leave
 * the button grey.
 */
export function useUploadCmrScan(
  client: ApiClient,
  variant: DocVariant = 'admin',
  kind: CmrKind = 'loading',
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, formData }: { requestId: string; formData: FormData }) =>
      client.upload<Document>(cmrPath(variant, requestId, kind), formData),
    onSuccess: (_doc, { requestId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.tripRequests.cmrScans(requestId, kind) });
      void qc.invalidateQueries({ queryKey: queryKeys.tripRequests.all });
      void qc.invalidateQueries({ queryKey: queryKeys.transporter.all });
    },
  });
}

/** Admin: read the caller's own org request-portal settings (code + crop list). */
export function useOrgRequestSettings(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.orgRequestSettings.all,
    queryFn: () => client.get<OrgRequestSettings>('/api/v1/organizations/me/request-settings'),
  });
}

export function useUpdateOrgRequestSettings(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: OrgRequestSettings) =>
      client.patch<OrgRequestSettings>('/api/v1/organizations/me/request-settings', dto),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.orgRequestSettings.all, settings);
    },
  });
}
