import { useMeteoStatus } from '@strawboss/api';
import { mobileApiClient } from '@/lib/api-client';
import { useIsFeatureEnabled } from '@/stores/features-store';

/**
 * Whether the parcel weather card should fetch/show. Fail-closed, mirroring
 * `useMeteoAvailable`: needs `meteo.forecast` ON and a `/meteo/status` answer
 * that says the module is configured, opted in and forecasts are enabled. No
 * answer (offline cold start, request failed) means "not available" — the card
 * then falls back to its cached copy only.
 */
export function useMeteoWeatherAvailable(): boolean {
  const featureOn = useIsFeatureEnabled('meteo.forecast');
  const { data } = useMeteoStatus(mobileApiClient, { enabled: featureOn });
  return featureOn && !!data && data.configured && data.enabled && data.forecastEnabled === true;
}
