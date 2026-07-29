import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OrgFeatureSettings, UpdateOrgFeaturesDto } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';

/** One audit row per changed key. `oldEnabled: null` = it had no override before. */
export interface OrgFeatureChange {
  featureKey: string;
  oldEnabled: boolean | null;
  newEnabled: boolean;
  actorRole: string | null;
  actorName: string | null;
  reason: string;
  createdAt: string;
}

export type OrgFeaturesResponse = OrgFeatureSettings & { changes: OrgFeatureChange[] };

const orgFeaturesKey = (orgId: string) => ['super-admin', 'org-features', orgId] as const;

/**
 * Super-admin read of one org's toggles.
 *
 * Returns the RAW overrides, not the resolved set: the console renders the
 * registry tree and runs `resolveDisabledFeatures` client-side, so the operator
 * sees the dependency cascade live while clicking, before saving anything.
 */
export function useOrgFeatures(client: ApiClient, orgId: string) {
  return useQuery({
    queryKey: orgFeaturesKey(orgId),
    queryFn: () =>
      client.get<OrgFeaturesResponse>(`/api/v1/super-admin/organizations/${orgId}/features`),
    enabled: !!orgId,
  });
}

export function useUpdateOrgFeatures(client: ApiClient, orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateOrgFeaturesDto) =>
      client.put<OrgFeatureSettings>(
        `/api/v1/super-admin/organizations/${orgId}/features`,
        dto as unknown as Record<string, unknown>,
      ),
    onSuccess: () => {
      // Invalidate rather than setQueryData: the response omits `changes`, and
      // the server also normalises the override map (dropping entries equal to
      // the registry default), so the authoritative shape comes from a refetch.
      void qc.invalidateQueries({ queryKey: orgFeaturesKey(orgId) });
      // A super_admin's own profile carries no flags, but an admin viewing the
      // same browser session would; cheap and keeps the sidebar honest.
      void qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
