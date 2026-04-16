'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { User, Bell, MonitorCog, Lock, Check, AlertCircle, Loader2 } from 'lucide-react';
import { useProfile, useUpdateProfile, useChangePassword, useUpdateProfileLocale } from '@strawboss/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiClient } from '@/lib/api';
import { useI18n, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const APP_VERSION = '0.0.1';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ENVIRONMENT = process.env.NODE_ENV === 'production' ? 'production' : 'development';

/* ------------------------------------------------------------------ */
/*  Feedback banner                                                    */
/* ------------------------------------------------------------------ */

type FeedbackType = 'success' | 'error' | null;

function FeedbackBanner({ type, message }: { type: FeedbackType; message: string }) {
  if (!type) return null;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-4 py-3 text-sm',
        type === 'success'
          ? 'border border-green-200 bg-green-50 text-green-700'
          : 'border border-red-200 bg-red-50 text-red-700',
      )}
    >
      {type === 'success' ? (
        <Check className="h-4 w-4 flex-shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
      )}
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section wrapper                                                    */
/* ------------------------------------------------------------------ */

function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-100 px-6 py-4">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-neutral-500" />
          <h2 className="text-base font-semibold text-neutral-800">{title}</h2>
        </div>
        <p className="mt-1 text-xs text-neutral-500">{description}</p>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Toggle switch                                                      */
/* ------------------------------------------------------------------ */

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between py-3">
      <div>
        <p className="text-sm font-medium text-neutral-700">{label}</p>
        <p className="text-xs text-neutral-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors',
          checked ? 'bg-green-700' : 'bg-neutral-300',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
            'mt-0.5',
          )}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Auto-dismiss hook                                                  */
/* ------------------------------------------------------------------ */

function useFeedback(timeout = 4000) {
  const [fb, setFb] = useState<{ type: FeedbackType; message: string }>({
    type: null,
    message: '',
  });

  useEffect(() => {
    if (!fb.type) return;
    const id = setTimeout(() => setFb({ type: null, message: '' }), timeout);
    return () => clearTimeout(id);
  }, [fb.type, timeout]);

  const show = useCallback((type: 'success' | 'error', message: string) => {
    setFb({ type, message });
  }, []);

  const clear = useCallback(() => {
    setFb({ type: null, message: '' });
  }, []);

  return { ...fb, show, clear };
}

/* ------------------------------------------------------------------ */
/*  Default notification prefs                                         */
/* ------------------------------------------------------------------ */

interface NotifPrefs {
  email: boolean;
  critical: boolean;
  trips: boolean;
  digest: boolean;
}

const defaultNotifPrefs: NotifPrefs = {
  email: true,
  critical: true,
  trips: false,
  digest: true,
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
  const { t, locale, setLocale } = useI18n();

  // API hooks
  const profileQuery = useProfile(apiClient);
  const updateProfile = useUpdateProfile(apiClient);
  const updateLocale = useUpdateProfileLocale(apiClient);
  const changePassword = useChangePassword(apiClient);

  const profile = profileQuery.data;

  // Profile form state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedLocale, setSelectedLocale] = useState<Locale>(locale);
  const profileFb = useFeedback();

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordValidation, setPasswordValidation] = useState('');
  const passwordFb = useFeedback();

  // Notification prefs state
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>(defaultNotifPrefs);
  const notifFb = useFeedback();

  // Hydrate form state from profile data
  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName ?? '');
      setPhone(profile.phone ?? '');
      setSelectedLocale((profile.locale as Locale) === 'ro' ? 'ro' : 'en');

      const prefs = (profile as unknown as Record<string, unknown>).notificationPrefs as
        | Record<string, boolean>
        | undefined;
      if (prefs && typeof prefs === 'object') {
        setNotifPrefs({
          email: prefs.email ?? defaultNotifPrefs.email,
          critical: prefs.critical ?? defaultNotifPrefs.critical,
          trips: prefs.trips ?? defaultNotifPrefs.trips,
          digest: prefs.digest ?? defaultNotifPrefs.digest,
        });
      }
    }
  }, [profile]);

  /* ---- Profile save ---- */
  const handleSaveProfile = () => {
    profileFb.clear();
    updateProfile.mutate(
      { fullName, phone: phone || null, locale: selectedLocale },
      {
        onSuccess: () => {
          profileFb.show('success', t('settings.feedback.profileSaved'));
        },
        onError: () => {
          profileFb.show('error', t('settings.feedback.profileError'));
        },
      },
    );
  };

  /* ---- Language change (immediate) ---- */
  const handleLanguageChange = (next: Locale) => {
    setSelectedLocale(next);
    setLocale(next);
    updateLocale.mutate(next);
  };

  /* ---- Password change ---- */
  const handleChangePassword = () => {
    setPasswordValidation('');
    passwordFb.clear();

    if (newPassword.length < 8) {
      setPasswordValidation(t('settings.password.tooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordValidation(t('settings.password.mismatch'));
      return;
    }

    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          passwordFb.show('success', t('settings.password.success'));
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
        },
        onError: () => {
          passwordFb.show('error', t('settings.password.error'));
        },
      },
    );
  };

  /* ---- Notification prefs save ---- */
  const handleToggleNotif = (key: keyof NotifPrefs) => {
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(next);
  };

  const handleSaveNotifs = () => {
    notifFb.clear();
    updateProfile.mutate(
      { notificationPrefs: notifPrefs as unknown as Record<string, boolean> },
      {
        onSuccess: () => {
          notifFb.show('success', t('settings.feedback.notifSaved'));
        },
        onError: () => {
          notifFb.show('error', t('settings.feedback.notifError'));
        },
      },
    );
  };

  /* ---- Loading state ---- */
  if (profileQuery.isLoading) {
    return (
      <div>
        <PageHeader title={t('settings.title')} />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
          <span className="ml-2 text-sm text-neutral-500">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  if (profileQuery.isError) {
    return (
      <div>
        <PageHeader title={t('settings.title')} />
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center text-sm text-red-600">
          Failed to load profile. The backend may not be running.
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t('settings.title')} />

      <div className="space-y-6">
        {/* ── Profile ── */}
        <SettingsSection
          title={t('settings.profile.title')}
          description={t('settings.profile.description')}
          icon={User}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Full name */}
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.profile.fullName')}
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t('settings.profile.placeholderName')}
                className={cn(
                  'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700',
                  'focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700',
                )}
              />
            </div>

            {/* Email (read-only) */}
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.profile.email')}
              </label>
              <input
                type="email"
                value={profile?.email ?? ''}
                disabled
                className={cn(
                  'w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-400',
                  'cursor-not-allowed',
                )}
              />
            </div>

            {/* Phone */}
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.profile.phone')}
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('settings.profile.placeholderPhone')}
                className={cn(
                  'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700',
                  'focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700',
                )}
              />
            </div>

            {/* Language */}
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.profile.interfaceLanguage')}
              </label>
              <p className="mb-2 text-xs text-neutral-500">
                {t('settings.profile.interfaceLanguageHint')}
              </p>
              <select
                value={selectedLocale}
                onChange={(e) => handleLanguageChange(e.target.value as Locale)}
                disabled={updateLocale.isPending}
                className={cn(
                  'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700',
                  'focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                <option value="en">{t('settings.lang.en')}</option>
                <option value="ro">{t('settings.lang.ro')}</option>
              </select>
            </div>
          </div>

          {profileFb.type && (
            <div className="mt-4">
              <FeedbackBanner type={profileFb.type} message={profileFb.message} />
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={updateProfile.isPending}
              onClick={handleSaveProfile}
              className={cn(
                'flex items-center gap-2 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white',
                'hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {updateProfile.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {updateProfile.isPending
                ? t('settings.feedback.saving')
                : t('settings.profile.saveProfile')}
            </button>
          </div>
        </SettingsSection>

        {/* ── Password ── */}
        <SettingsSection
          title={t('settings.password.title')}
          description={t('settings.password.description')}
          icon={Lock}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.password.currentPassword')}
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className={cn(
                  'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700',
                  'focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700',
                )}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.password.newPassword')}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className={cn(
                  'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700',
                  'focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700',
                )}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.password.confirmPassword')}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className={cn(
                  'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700',
                  confirmPassword && newPassword !== confirmPassword
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                    : 'focus:border-green-700 focus:ring-green-700',
                )}
              />
            </div>
          </div>

          {passwordValidation && (
            <div className="mt-3">
              <p className="text-sm text-red-600">{passwordValidation}</p>
            </div>
          )}

          {passwordFb.type && (
            <div className="mt-4">
              <FeedbackBanner type={passwordFb.type} message={passwordFb.message} />
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={
                changePassword.isPending ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword
              }
              onClick={handleChangePassword}
              className={cn(
                'flex items-center gap-2 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white',
                'hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {changePassword.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {changePassword.isPending
                ? t('settings.password.changing')
                : t('settings.password.changePassword')}
            </button>
          </div>
        </SettingsSection>

        {/* ── Notifications ── */}
        <SettingsSection
          title={t('settings.notifications.title')}
          description={t('settings.notifications.description')}
          icon={Bell}
        >
          <div className="divide-y divide-neutral-100">
            <ToggleRow
              label={t('settings.notifications.email')}
              description={t('settings.notifications.emailDesc')}
              checked={notifPrefs.email}
              onChange={() => handleToggleNotif('email')}
            />
            <ToggleRow
              label={t('settings.notifications.critical')}
              description={t('settings.notifications.criticalDesc')}
              checked={notifPrefs.critical}
              onChange={() => handleToggleNotif('critical')}
            />
            <ToggleRow
              label={t('settings.notifications.trips')}
              description={t('settings.notifications.tripsDesc')}
              checked={notifPrefs.trips}
              onChange={() => handleToggleNotif('trips')}
            />
            <ToggleRow
              label={t('settings.notifications.digest')}
              description={t('settings.notifications.digestDesc')}
              checked={notifPrefs.digest}
              onChange={() => handleToggleNotif('digest')}
            />
          </div>

          {notifFb.type && (
            <div className="mt-4">
              <FeedbackBanner type={notifFb.type} message={notifFb.message} />
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={updateProfile.isPending}
              onClick={handleSaveNotifs}
              className={cn(
                'flex items-center gap-2 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white',
                'hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {updateProfile.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {updateProfile.isPending
                ? t('settings.feedback.saving')
                : t('common.save')}
            </button>
          </div>
        </SettingsSection>

        {/* ── System (read-only) ── */}
        <SettingsSection
          title={t('settings.system.title')}
          description={t('settings.system.description')}
          icon={MonitorCog}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.system.apiUrl')}
              </label>
              <input
                type="text"
                value={API_URL}
                disabled
                className={cn(
                  'w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-400',
                  'cursor-not-allowed',
                )}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.system.timezone')}
              </label>
              <input
                type="text"
                value="Europe/Bucharest"
                disabled
                className={cn(
                  'w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-400',
                  'cursor-not-allowed',
                )}
              />
            </div>
          </div>
          <p className="mt-4 text-xs text-neutral-400">
            {t('settings.system.version', { version: APP_VERSION, env: ENVIRONMENT })}
          </p>
        </SettingsSection>
      </div>
    </div>
  );
}
