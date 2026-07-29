'use client';

import { useMemo } from 'react';
import { useProfile } from '@strawboss/api';
import { isFeatureEnabled, type FeatureKey } from '@strawboss/types';
import { apiClient } from '@/lib/api';

/**
 * Which features this user's organization has switched off.
 *
 * Reads the same `['profile']` query every page already fetches, so it costs no
 * extra request and stays in step with the rest of the app.
 *
 * ── FAIL-OPEN WHILE LOADING ───────────────────────────────────────────────
 *
 * Before the profile resolves, `isEnabled` returns true for everything. Hiding
 * first and revealing later would make the sidebar visibly reshuffle on every
 * navigation and, worse, would flash "unavailable" at users who have full
 * access. The backend is the real gate; this only decides what to draw.
 *
 * Use `ready` when an action must not be taken on an assumption — e.g. the
 * route guard waits for it before redirecting anyone away from a page.
 */
export function useFeatures() {
  const { data, isLoading } = useProfile(apiClient);

  const disabled = useMemo(() => data?.features?.disabled ?? [], [data]);

  return useMemo(
    () => ({
      ready: !isLoading && !!data,
      disabled,
      isEnabled: (key: FeatureKey) => isFeatureEnabled(disabled, key),
    }),
    [disabled, isLoading, data],
  );
}
