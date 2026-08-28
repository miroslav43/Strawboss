import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { TripRequest, BeneficiaryOrderSettings, Document } from '@strawboss/types';
import type {
  CreateTransporterRequestInput,
  BeneficiaryOrderSettingsInput,
} from '@strawboss/validation';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';
import { fetchAllPages, type LedgerResult } from './paged-ledger.js';

/** URL segment for the saved-record kind. */
export type TransporterRecordKind = 'contacts' | 'trucks' | 'drivers';

/** A beneficiary a transporter may act for — PIN-free (the daily PIN is never exposed). */
export interface AssignedBeneficiary {
  id: string;
  slug: string;
  displayName: string;
  companyName: string;
  companyCui: string | null;
  companyAddress: string | null;
  email: string | null;
}

/** The beneficiaries an admin assigned to this transporter. */
export function useTransporterBeneficiaries(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.transporter.beneficiaries(),
    queryFn: () => client.get<AssignedBeneficiary[]>('/api/v1/transporter/beneficiaries'),
  });
}

/**
 * A beneficiary's saved contacts / trucks / drivers. Generic over the row type so
 * the form can type each list precisely. Disabled until a beneficiary is chosen.
 */
export function useTransporterRecords<T>(
  client: ApiClient,
  beneficiaryId: string | null,
  kind: TransporterRecordKind,
) {
  return useQuery({
    queryKey: queryKeys.transporter.records(beneficiaryId ?? '', kind),
    queryFn: () => client.get<T[]>(`/api/v1/transporter/beneficiaries/${beneficiaryId}/${kind}`),
    enabled: !!beneficiaryId,
  });
}

interface RecordMutationVars {
  beneficiaryId: string;
  kind: TransporterRecordKind;
  data: unknown;
}

export function useCreateTransporterRecord(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ beneficiaryId, kind, data }: RecordMutationVars) =>
      client.post(`/api/v1/transporter/beneficiaries/${beneficiaryId}/${kind}`, data),
    onSuccess: (_r, { beneficiaryId, kind }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.transporter.records(beneficiaryId, kind) });
    },
  });
}

export function useUpdateTransporterRecord(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ beneficiaryId, kind, id, data }: RecordMutationVars & { id: string }) =>
      client.patch(`/api/v1/transporter/beneficiaries/${beneficiaryId}/${kind}/${id}`, data),
    onSuccess: (_r, { beneficiaryId, kind }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.transporter.records(beneficiaryId, kind) });
    },
  });
}

export function useDeleteTransporterRecord(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      beneficiaryId,
      kind,
      id,
    }: {
      beneficiaryId: string;
      kind: TransporterRecordKind;
      id: string;
    }) =>
      client.post(`/api/v1/transporter/beneficiaries/${beneficiaryId}/${kind}/${id}/delete`, {}),
    onSuccess: (_r, { beneficiaryId, kind }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.transporter.records(beneficiaryId, kind) });
    },
  });
}

/** Submit a new transport request (creates a pending trip_request). */
export function useSubmitTransporterRequest(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateTransporterRequestInput) =>
      client.post<{ ok: true }>('/api/v1/transporter/requests', dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.transporter.all });
    },
  });
}

/** The transporter's read-only ledger: the requests they themselves created. */
export function useTransporterRequests(
  client: ApiClient,
  filters?: Record<string, string | undefined>,
) {
  return useQuery({
    queryKey: queryKeys.transporter.requests(filters),
    queryFn: () => {
      // URLSearchParams turns `undefined` into the literal "undefined", which the
      // server would try to parse — only send keys that actually have a value.
      const params = new URLSearchParams();
      if (filters) {
        for (const [k, v] of Object.entries(filters)) {
          if (v !== undefined && v !== '') params.set(k, v);
        }
      }
      const qs = params.toString();
      return client.get<TripRequest[]>(`/api/v1/transporter/requests${qs ? `?${qs}` : ''}`);
    },
  });
}

/**
 * The transporter's ledger, WHOLE — every page of it.
 *
 * `useTransporterRequests` sends no `limit`, so it takes the server's default of
 * 200 rows ordered `created_at DESC`, while the page filters by `AuxStage`
 * CLIENT-side afterwards. That is the same truncation the admin ledger had: with
 * no stage filter the window rarely binds, but widen it and rows go missing from
 * the middle of a date-sorted list, because created_at order is not needed_date
 * order.
 *
 * `GET /transporter/requests` is `TripRequestsService.list()` with
 * `createdByUserId` pinned to the caller, so it takes the same `limit`/`offset`
 * and carries the same unique ORDER BY tiebreaker that makes OFFSET paging safe.
 */
export function useAllTransporterRequests(
  client: ApiClient,
  filters?: Record<string, string | undefined>,
  options?: { enabled?: boolean },
) {
  return useQuery<LedgerResult<TripRequest>>({
    queryKey: queryKeys.transporter.requestsAll(filters),
    enabled: options?.enabled ?? true,
    // Keeps the table (and therefore DataTable's sort state) alive across a
    // filter change — see the same note on `useAllTripRequests`.
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchAllPages<TripRequest>(client, '/api/v1/transporter/requests', (offset, pageSize) => {
        // URLSearchParams stringifies `undefined` to the literal "undefined",
        // which the server would then try to parse — only send real values.
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(filters ?? {})) {
          if (v !== undefined && v !== '') params.set(k, v);
        }
        params.set('limit', String(pageSize));
        params.set('offset', String(offset));
        return `?${params.toString()}`;
      }),
  });
}

/**
 * Delete one of the transporter's own requests. The backend refuses once the
 * transport has moved (loading/awaitingArrivalCmr/completed) with a
 * machine-readable `stage_not_deletable` error — match on that, not the
 * message text, same convention as `ApiError` handling elsewhere.
 */
export function useDeleteTransporterRequest(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      client.post<{ ok: true }>(`/api/v1/transporter/requests/${id}/delete`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.transporter.all });
    },
  });
}

// ── Per-beneficiary comandă (order) settings ─────────────────────────────────

/** The order settings for a beneficiary (null until configured). */
export function useBeneficiaryOrderSettings(client: ApiClient, beneficiaryId: string | null) {
  return useQuery({
    queryKey: queryKeys.transporter.orderSettings(beneficiaryId ?? ''),
    queryFn: () =>
      client.get<BeneficiaryOrderSettings | null>(
        `/api/v1/transporter/beneficiaries/${beneficiaryId}/order-settings`,
      ),
    enabled: !!beneficiaryId,
  });
}

/** Upsert (set-replace) a beneficiary's order settings. */
export function useSaveBeneficiaryOrderSettings(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      beneficiaryId,
      data,
    }: {
      beneficiaryId: string;
      data: BeneficiaryOrderSettingsInput;
    }) =>
      client.put<BeneficiaryOrderSettings>(
        `/api/v1/transporter/beneficiaries/${beneficiaryId}/order-settings`,
        data,
      ),
    onSuccess: (_r, { beneficiaryId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.transporter.orderSettings(beneficiaryId) });
    },
  });
}

// ── Comandă (generated transport order) ──────────────────────────────────────

/** The generated comandă document(s) for a request (0 or 1). */
export function useTransporterComanda(client: ApiClient, requestId: string) {
  return useQuery({
    queryKey: queryKeys.transporter.comanda(requestId),
    queryFn: () => client.get<Document[]>(`/api/v1/transporter/requests/${requestId}/comanda`),
    enabled: !!requestId,
  });
}

/** Manually (re)generate the comandă for a request. */
export function useGenerateTransporterComanda(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) =>
      client.post(`/api/v1/transporter/requests/${requestId}/comanda`, {}),
    onSuccess: (_r, requestId) => {
      void qc.invalidateQueries({ queryKey: queryKeys.transporter.comanda(requestId) });
      void qc.invalidateQueries({ queryKey: queryKeys.transporter.all });
    },
  });
}
