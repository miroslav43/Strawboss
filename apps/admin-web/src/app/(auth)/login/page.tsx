'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Eye,
  EyeOff,
  User,
  Lock,
  AlertCircle,
  Loader2,
  Radar,
  Scale,
  FileSignature,
} from 'lucide-react';
import { apiV1Url } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useI18n, normalizeUiLocale, type Locale } from '@/lib/i18n';
import { clientLogger } from '@/lib/client-logger';
import { resolveOrganizationSlugForSession } from '@/lib/resolve-organization-slug';
import { BrandPanel } from '@/components/brand/BrandPanel';

const TRACTOR = '/brand/strawboss-tractor.svg';

const inputBase =
  'w-full rounded-xl border border-stone-300 bg-white py-2.5 text-[15px] text-bark ' +
  'placeholder:text-stone-400 shadow-sm outline-none transition-colors ' +
  'focus:border-primary focus:ring-4 focus:ring-primary/15';

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

function LangToggle({ locale, onPick }: { locale: Locale; onPick: (l: Locale) => void }) {
  return (
    <div className="inline-flex items-center rounded-full border border-stone-200 bg-white/80 p-0.5 text-xs font-semibold shadow-sm backdrop-blur">
      {(['ro', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onPick(l)}
          aria-pressed={locale === l}
          className={`rounded-full px-3 py-1 uppercase tracking-wide transition-colors ${
            locale === l ? 'bg-primary text-white' : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export default function LoginPage() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // First-visit language: follow the browser when nothing is stored yet.
  // persist:false keeps it a soft default — an explicit toggle still wins.
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && !localStorage.getItem('strawboss-locale')) {
        setLocale(normalizeUiLocale(navigator.language), { persist: false });
      }
    } catch {
      /* ignore storage/SSR access errors */
    }
  }, [setLocale]);

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
      if (!orgSlug) return;
      router.replace(appMeta.role === 'transportator' ? `/${orgSlug}/transport` : `/${orgSlug}/`);
    });
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const trimmed = login.trim();
    const isUsername = !trimmed.includes('@');

    // Resolve username → email when the field doesn't contain '@'. On
    // resolution failure we still call Supabase with a synthetic address so
    // every failure path returns the same generic error (and roughly the same
    // timing), avoiding a username-enumeration oracle.
    const resolved = await resolveLogin(trimmed);
    const email = resolved ?? `__unknown__${Date.now()}@invalid.strawboss.local`;

    // Operators/drivers log in with username + 4-digit PIN → pad to satisfy
    // Supabase Auth's min-6-char policy. Admins with email + long password
    // should pass through unchanged.
    const authPassword = isUsername ? pinToAuthPassword(password) : password;

    const { data: signInData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password: authPassword,
    });

    if (authError) {
      clientLogger.warn('login.signInWithPassword failed', {
        code: authError.code,
        status: authError.status,
        message: authError.message,
      });
      setError(t('login.errors.invalidCredentials'));
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
      setError(t('login.errors.noOrganization'));
      setLoading(false);
      return;
    }

    router.push(appMeta?.role === 'transportator' ? `/${orgSlug}/transport` : `/${orgSlug}/`);
  }

  return (
    <div className="min-h-screen bg-cream text-bark lg:grid lg:grid-cols-[minmax(0,44%)_minmax(0,1fr)]">
      <BrandPanel
        eyebrow={t('login.brandEyebrow')}
        title={t('login.title')}
        headline={t('login.heroHeadline')}
        sub={t('login.heroSub')}
        points={[
          { icon: <Radar className="h-4 w-4" />, label: t('login.cap1') },
          { icon: <Scale className="h-4 w-4" />, label: t('login.cap2') },
          { icon: <FileSignature className="h-4 w-4" />, label: t('login.cap3') },
        ]}
        footer={t('login.poweredBy')}
      />

      <main className="relative flex min-h-screen flex-col">
        <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
          <LangToggle locale={locale} onPick={(l) => setLocale(l)} />
        </div>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 pb-12 pt-20 sm:px-8 lg:pt-16">
          <div className="portal-rise rounded-3xl border border-stone-200 bg-white p-7 shadow-sm sm:p-9">
            <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/15">
              <img src={TRACTOR} alt="" width={28} height={28} className="h-7 w-7" aria-hidden />
            </span>

            <h1 className="text-2xl font-bold tracking-tight text-bark">{t('login.welcome')}</h1>
            <p className="mt-1 text-sm text-stone-500">{t('login.subtitle')}</p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
              <div>
                <label
                  htmlFor="login"
                  className="mb-1.5 block text-[13px] font-medium text-stone-600"
                >
                  {t('login.usernameOrEmail')}
                </label>
                <div className="relative">
                  <User
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
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
                    className={`${inputBase} pl-10 pr-3`}
                    placeholder={t('login.usernamePlaceholder')}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-[13px] font-medium text-stone-600"
                >
                  {t('login.passwordOrPin')}
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
                    aria-hidden
                  />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputBase} pl-10 pr-11`}
                    placeholder={t('login.passwordPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                    aria-pressed={showPassword}
                    tabIndex={0}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                  className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {loading ? t('login.signingIn') : t('login.signIn')}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
