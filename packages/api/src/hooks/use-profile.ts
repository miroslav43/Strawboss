import { useQuery } from '@tanstack/react-query';
import type { User } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';

/** Fetch the current authenticated user's profile (including assignedMachineId). */
export function useProfile(client: ApiClient) {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => client.get<User>('/api/v1/profile'),
  });
}
