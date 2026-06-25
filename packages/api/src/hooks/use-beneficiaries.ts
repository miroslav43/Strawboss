import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Beneficiary, CreateBeneficiaryDto, UpdateBeneficiaryDto } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

/** Admin/dispatcher: list all beneficiaries for the caller's org. */
export function useBeneficiaries(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.beneficiaries.list(),
    queryFn: () => client.get<Beneficiary[]>('/api/v1/beneficiaries'),
  });
}

/** Admin: create a new beneficiary. */
export function useCreateBeneficiary(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateBeneficiaryDto) =>
      client.post<Beneficiary>('/api/v1/beneficiaries', dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.beneficiaries.all });
    },
  });
}

/** Admin: update an existing beneficiary. */
export function useUpdateBeneficiary(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBeneficiaryDto }) =>
      client.patch<Beneficiary>(`/api/v1/beneficiaries/${id}`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.beneficiaries.all });
    },
  });
}

/** Admin: soft-delete a beneficiary. */
export function useDeleteBeneficiary(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.delete<void>(`/api/v1/beneficiaries/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.beneficiaries.all });
    },
  });
}

/** Admin: manually regenerate a beneficiary's daily PIN. */
export function useRegenBeneficiaryPin(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      client.post<Beneficiary>(`/api/v1/beneficiaries/${id}/regen-pin`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.beneficiaries.all });
    },
  });
}
