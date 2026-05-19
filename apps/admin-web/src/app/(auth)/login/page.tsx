'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiV1Url } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import { resolveOrganizationSlugForSession } from '@/lib/resolve-organization-slug';

/** Resolve a username to an email via the backend. Returns null on failure. */
async function resolveLogin(login: string): Promise<string | null> {
  if (login.includes('@')) return login;
  try {
    const res = await fetch(apiV1Url('/auth/resolve'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Mirror backend's pinToAuthPassword: Supabase Auth requires ≥6 chars but
 * user PINs are 4 digits. We pad before calling signInWithPassword.
 * Must stay in sync with backend/service/src/admin-users/admin-users.service.ts.
 */
function pinToAuthPassword(pin: string): string {
  return `sb_${pin}`;
}

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const appMeta = session.user.app_metadata as {
        role?: string;
        organization_slug?: string;
      };
      if (appMeta.role === 'super_admin') {
        router.replace('/super-admin');
        return;
      }
      const orgSlug =
        appMeta.organization_slug ?? (await resolveOrganizationSlugForSession(session));
      if (orgSlug) router.replace(`/${orgSlug}/`);
    });
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const trimmed = login.trim();
    const isUsername = !trimmed.includes('@');

    // Resolve username → email if the field doesn't contain '@'.
    const email = await resolveLogin(trimmed);
    if (!email) {
      setError(t('login.usernameNotFound'));
      setLoading(false);
      return;
    }

    // Operators/drivers log in with username + 4-digit PIN → pad to satisfy
    // Supabase Auth's min-6-char policy. Admins with email + long password
    // should pass through unchanged.
    const authPassword = isUsername ? pinToAuthPassword(password) : password;

    const { data: signInData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password: authPassword,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    const appMeta = signInData.session?.user.app_metadata as
      | {
          role?: string;
          organization_slug?: string;
        }
      | undefined;

    if (appMeta?.role === 'super_admin') {
      router.push('/super-admin');
      return;
    }

    const orgSlug =
      appMeta?.organization_slug ??
      (signInData.session ? await resolveOrganizationSlugForSession(signInData.session) : null);
    if (!orgSlug) {
      setError(t('login.noOrgAssigned'));
      setLoading(false);
      return;
    }

    router.push(`/${orgSlug}/`);
  }

  return (
    <div className="rounded-lg bg-surface p-8 shadow-md">
      <div className="mb-4 flex justify-center">
        <img
          src="/brand/strawboss-tractor.svg"
          alt=""
          width={88}
          height={88}
          className="h-[88px] w-[88px]"
          aria-hidden
        />
      </div>
      <h1 className="mb-6 text-center text-2xl font-bold text-primary">{t('login.title')}</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login" className="mb-1 block text-sm font-medium text-neutral-700">
            Username sau Email
          </label>
          <input
            id="login"
            type="text"
            required
            autoCapitalize="none"
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            placeholder="mmaletici sau ion@ferma.ro"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-neutral-700">
            PIN sau Parola
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            placeholder="PIN 4 cifre sau parola"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? t('login.signingIn') : t('login.signIn')}
        </button>
      </form>
    </div>
  );
}
