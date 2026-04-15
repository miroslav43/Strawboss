'use client';

import { useEffect } from 'react';
import { useProfile } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** When the user has not set a browser locale, apply `users.locale` from GET /profile. */
export function ProfileLocaleHydration() {
  const { data: profile } = useProfile(apiClient);
  const { hydrateFromProfile } = useI18n();

  useEffect(() => {
    if (!profile) return;
    hydrateFromProfile(profile.locale);
  }, [profile, hydrateFromProfile]);

  return null;
}
