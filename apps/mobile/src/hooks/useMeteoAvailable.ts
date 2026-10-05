import { useMeteoStatus } from '@strawboss/api';
import { mobileApiClient } from '@/lib/api-client';
import { useIsFeatureEnabled } from '@/stores/features-store';

/**
 * Whether the "measure moisture" entry points should show. Fail-closed: needs the
 * `meteo.moisture` feature ON and a `/meteo/status` answer that says the module
 * is configured and the organization opted in. No answer (offline cold start,
 * request failed) means hidden. The status query is only fired when the feature
 * is on, so orgs without Meteo make no extra request.
 */
export function useMeteoAvailable(): boolean {
  const featureOn = useIsFeatureEnabled('meteo.moisture');
  const { data } = useMeteoStatus(mobileApiClient, { enabled: featureOn });
  return featureOn && !!data && data.configured && data.enabled;
}
