'use client';
export const dynamic = 'force-dynamic';

import { User, Bell, MonitorCog } from 'lucide-react';
import { useUpdateProfileLocale } from '@strawboss/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiClient } from '@/lib/api';
import { useI18n, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

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
    <div className="rounded-lg border border-neutral-200 bg-white">
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

function FormField({
  label,
  type = 'text',
  placeholder,
  value,
  disabled,
}: {
  label: string;
  type?: string;
  placeholder?: string;
  value?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-neutral-700">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        defaultValue={value}
        disabled={disabled}
        className={cn(
          'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700',
          'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary',
          'disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400',
        )}
      />
    </div>
  );
}

function ToggleRow({
  label,
  description,
  defaultChecked,
}: {
  label: string;
  description: string;
  defaultChecked?: boolean;
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
        aria-checked={defaultChecked}
        className={cn(
          'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors',
          defaultChecked ? 'bg-primary' : 'bg-neutral-300',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
            defaultChecked ? 'translate-x-4' : 'translate-x-0.5',
            'mt-0.5',
          )}
        />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const updateLocale = useUpdateProfileLocale(apiClient);

  const handleLanguageChange = (next: Locale) => {
    setLocale(next);
    updateLocale.mutate(next);
  };

  return (
    <div>
      <PageHeader title={t('settings.title')} />

      <div className="space-y-6">
        <SettingsSection
          title={t('settings.profile.title')}
          description={t('settings.profile.description')}
          icon={User}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('settings.profile.fullName')}
              placeholder={t('settings.profile.placeholderName')}
              value="Admin User"
            />
            <FormField
              label={t('settings.profile.email')}
              type="email"
              placeholder={t('settings.profile.placeholderEmail')}
              value="admin@strawboss.com"
              disabled
            />
            <FormField
              label={t('settings.profile.phone')}
              type="tel"
              placeholder={t('settings.profile.placeholderPhone')}
            />
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.profile.interfaceLanguage')}
              </label>
              <p className="mb-2 text-xs text-neutral-500">
                {t('settings.profile.interfaceLanguageHint')}
              </p>
              <select
                value={locale}
                onChange={(e) => handleLanguageChange(e.target.value as Locale)}
                disabled={updateLocale.isPending}
                className={cn(
                  'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700',
                  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                <option value="en">{t('settings.lang.en')}</option>
                <option value="ro">{t('settings.lang.ro')}</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              {t('settings.profile.saveProfile')}
            </button>
          </div>
        </SettingsSection>

        <SettingsSection
          title={t('settings.notifications.title')}
          description={t('settings.notifications.description')}
          icon={Bell}
        >
          <div className="divide-y divide-neutral-100">
            <ToggleRow
              label={t('settings.notifications.email')}
              description={t('settings.notifications.emailDesc')}
              defaultChecked
            />
            <ToggleRow
              label={t('settings.notifications.critical')}
              description={t('settings.notifications.criticalDesc')}
              defaultChecked
            />
            <ToggleRow
              label={t('settings.notifications.trips')}
              description={t('settings.notifications.tripsDesc')}
            />
            <ToggleRow
              label={t('settings.notifications.digest')}
              description={t('settings.notifications.digestDesc')}
              defaultChecked
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title={t('settings.system.title')}
          description={t('settings.system.description')}
          icon={MonitorCog}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('settings.system.apiUrl')}
              placeholder="http://localhost:3001"
              value="http://localhost:3001"
              disabled
            />
            <FormField
              label={t('settings.system.timezone')}
              placeholder="UTC"
              value="Europe/Madrid"
            />
          </div>
          <p className="mt-4 text-xs text-neutral-400">
            {t('settings.system.version', { version: '0.0.1', env: 'development' })}
          </p>
        </SettingsSection>
      </div>
    </div>
  );
}
