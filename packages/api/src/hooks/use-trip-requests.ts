import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { TripRequest, OrgRequestSettings, Document } from '@strawboss/types';
import type { UpdateTripRequestInput } from '@strawboss/validation';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';
import { fetchAllPages, type LedgerResult } from './paged-ledger.js';

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

/**
 * Every trip request matching `filters`, across as many server pages as it takes.
 *
 * `GET /trip-requests` already paginates (`limit`/`offset`, default 200,
 * `MAX_LIST_LIMIT` 1000) — the UI simply never used it, so the aux ledger
 * silently stopped at the 200 most recent requests until the working table on
 * `/trips` was moved onto this hook too. The Curse Aux report
 * covers a whole season and filters by `AuxStage` client-side (the stage is
 * composed from two axes and is not a server-side column), so it needs the full
 * set or its stage counts would be wrong.
 *
 * No `status` filter is applied here on purpose: `trip_requests.status` freezes
 * at `confirmed` while the transport is out, so filtering on it would drop live
 * work. Filter on the composed `AuxStage` after `buildAuxRows()` instead.
 */
export function useAllTripRequests(
  client: ApiClient,
  filters?: Record<string, unknown>,
  options?: { enabled?: boolean },
) {
  return useQuery<LedgerResult<TripRequest>>({
    queryKey: queryKeys.tripRequests.listAll(filters),
    enabled: options?.enabled ?? true,
    /*
     * A filter change is a NEW query key, so without this `data` goes undefined
     * for the duration of the refetch. The consumer then swaps the table for a
     * spinner, and `DataTable` — which owns its sort state locally — remounts
     * with the sort RESET. Typing one character in the search box silently threw
     * away the column the operator had just sorted by.
     *
     * Also removes the report tab's empty-flash between date ranges.
     */
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchAllPages<TripRequest>(
        client,
        '/api/v1/trip-requests',
        (offset, pageSize) =>
          `?${new URLSearchParams({
            ...((filters ?? {}) as Record<string, string>),
            limit: String(pageSize),
            offset: String(offset),
          })}`,
        // This endpoint reports no total; the accumulated length stands in.
      ),
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
 * Correct an aux transport in place (admin/dispatcher) — the alternative to
 * deleting it and re-creating it.
 *
 * PATCH semantics: only the keys sent are written; `null` clears a nullable
 * column, an absent key leaves it alone.
 *
 * Invalidates far more than trip-requests because ONE PATCH writes THREE tables:
 * the request, the one-time auxiliary `machines` row (plate + owner company —
 * the fleet list, the truck board and the CMR read the truck THERE) and the
 * planned `trips` row (external driver + destination the loader's phone shows).
 * `transporter.all` because the same request is a row in the transporter's own
 * ledger. `tripRequests.all` already prefixes list, listAll AND detail.
 *
 * Refused with `error: 'stage_not_editable'` (plus the composed `stage`) once
 * the transport is loading, awaiting the arrival CMR, completed or cancelled.
 */
export function useUpdateTripRequest(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTripRequestInput }) =>
      client.patch<TripRequest>(`/api/v1/trip-requests/${id}`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tripRequests.all });
      void qc.invalidateQueries({ queryKey: queryKeys.machines.all });
      void qc.invalidateQueries({ queryKey: queryKeys.trips.all });
      void qc.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
      void qc.invalidateQueries({ queryKey: queryKeys.transporter.all });
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
