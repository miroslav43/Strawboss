import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Document } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export function useDocuments(client: ApiClient, tripId?: string) {
  return useQuery({
    queryKey: tripId ? queryKeys.documents.byTrip(tripId) : queryKeys.documents.all,
    queryFn: () => {
      const path = tripId
        ? `/api/v1/documents?tripId=${tripId}`
        : '/api/v1/documents';
      return client.get<Document[]>(path);
    },
  });
}

export function useDocument(client: ApiClient, id: string) {
  return useQuery({
    queryKey: queryKeys.documents.detail(id),
    queryFn: () => client.get<Document>(`/api/v1/documents/${id}`),
    enabled: !!id,
  });
}

export function useGenerateCmr(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) =>
      client.post<Document>(`/api/v1/trips/${tripId}/generate-cmr`),
    onSuccess: (_data, tripId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents.byTrip(tripId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
    },
  });
}
