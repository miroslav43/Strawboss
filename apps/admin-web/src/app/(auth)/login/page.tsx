'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, User, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { apiV1Url } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import { resolveOrganizationSlugForSession } from '@/lib/resolve-organization-slug';

/** Resolve a username to an email via the backend. Returns null on failure. */
async function resolveLogin(login: string): Promise<string | null> {
  if (login.includes('@')) return login;
  try {
    const res = await fetch(apiV1Url('/auth/resolve'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ login }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { email?: string };
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
  const [login,        setLogin]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [loading,      setLoading]      = useState(false);

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
      setError(t('login.errors.unknownUser'));
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

    const appMeta = signInData.session?.user.app_metadata as {
      role?: string;
      organization_slug?: string;
    } | undefined;

    if (appMeta?.role === 'super_admin') {
      router.push('/super-admin');
      return;
    }

    let orgSlug =
      appMeta?.organization_slug ??
      (signInData.session
        ? await resolveOrganizationSlugForSession(signInData.session)
        : null);
    if (!orgSlug) {
      setError(t('login.errors.noOrganization'));
      setLoading(false);
      return;
    }

    router.push(`/${orgSlug}/`);
  }

  return (
    <div className="rounded-2xl bg-white p-8 shadow-2xl ring-1 ring-black/5 sm:p-10">
      <div className="mb-5 flex justify-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/15">
          <img
            src="/brand/strawboss-tractor.svg"
            alt=""
            width={56}
            height={56}
            className="h-14 w-14"
            aria-hidden
          />
        </div>
      </div>

      <h1 className="text-center text-2xl font-bold tracking-tight text-primary">
        {t('login.title')}
      </h1>
      <p className="mt-1 mb-7 text-center text-sm text-neutral-500">
        {t('login.subtitle')}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label
            htmlFor="login"
            className="mb-1.5 block text-sm font-medium text-neutral-700"
          >
            {t('login.usernameOrEmail')}
          </label>
          <div className="relative">
            <User
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
              aria-hidden
            />
            <input
              id="login"
              type="text"
              required
              autoCapitalize="none"
              autoComplete="username"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white py-2.5 pl-10 pr-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder={t('login.usernamePlaceholder')}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1.5 block text-sm font-medium text-neutral-700"
          >
            {t('login.passwordOrPin')}
          </label>
          <div className="relative">
            <Lock
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
              aria-hidden
            />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white py-2.5 pl-10 pr-11 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder={t('login.passwordPlaceholder')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={
                showPassword ? t('login.hidePassword') : t('login.showPassword')
              }
              aria-pressed={showPassword}
              tabIndex={0}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden />
              ) : (
                <Eye className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {loading ? t('login.signingIn') : t('login.signIn')}
        </button>
      </form>
    </div>
  );
}
