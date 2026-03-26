'use client';

import { User, Bell, MonitorCog } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
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
  return (
    <div>
      <PageHeader title="Settings" />

      <div className="space-y-6">
        {/* Profile */}
        <SettingsSection
          title="Profile"
          description="Manage your account information"
          icon={User}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Full Name"
              placeholder="Your name"
              value="Admin User"
            />
            <FormField
              label="Email"
              type="email"
              placeholder="email@example.com"
              value="admin@strawboss.com"
              disabled
            />
            <FormField label="Phone" type="tel" placeholder="+1 234 567 890" />
            <FormField
              label="Locale"
              placeholder="en-US"
              value="en-US"
            />
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              Save Profile
            </button>
          </div>
        </SettingsSection>

        {/* Notifications */}
        <SettingsSection
          title="Notifications"
          description="Configure how you receive alerts and updates"
          icon={Bell}
        >
          <div className="divide-y divide-neutral-100">
            <ToggleRow
              label="Email notifications"
              description="Receive alert summaries via email"
              defaultChecked
            />
            <ToggleRow
              label="Critical alerts"
              description="Get notified immediately for critical severity alerts"
              defaultChecked
            />
            <ToggleRow
              label="Trip updates"
              description="Receive notifications when trip statuses change"
            />
            <ToggleRow
              label="Daily digest"
              description="Get a daily summary of all operations"
              defaultChecked
            />
          </div>
        </SettingsSection>

        {/* System */}
        <SettingsSection
          title="System"
          description="Application-wide settings"
          icon={MonitorCog}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="API URL"
              placeholder="http://localhost:3001"
              value="http://localhost:3001"
              disabled
            />
            <FormField
              label="Timezone"
              placeholder="UTC"
              value="Europe/Madrid"
            />
          </div>
          <p className="mt-4 text-xs text-neutral-400">
            Version: 0.0.1 | Environment: development
          </p>
        </SettingsSection>
      </div>
    </div>
  );
}
