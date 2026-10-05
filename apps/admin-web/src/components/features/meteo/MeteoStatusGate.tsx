'use client';

import { Loader2, CloudOff, FlaskConical, ShieldAlert } from 'lucide-react';
import { useMeteoStatus, useUpdateMeteoSettings } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useIsDispatcher } from '@/hooks/useIsDispatcher';
import { useIsAdmin } from './useIsAdmin';

function InfoCard({ icon, title, body, children }: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
        {icon}
      </div>
      <h2 className="text-lg font-semibold text-neutral-800">{title}</h2>
      <p className="mt-2 text-sm text-neutral-500">{body}</p>
      {children}
    </div>
  );
}

/**
 * Renders `children` only when the module is configured AND the organization
 * opted in. Otherwise: info card (not configured) or the "beta module" card
 * (admin sees the opt-in button). Also enforces the admin/dispatcher role.
 */
export function MeteoStatusGate({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { isDispatcher, isLoading: roleLoading } = useIsDispatcher();
  const { isAdmin } = useIsAdmin();
  const status = useMeteoStatus(apiClient, { enabled: isDispatcher });
  const update = useUpdateMeteoSettings(apiClient);

  if (roleLoading || (isDispatcher && status.isLoading)) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  if (!isDispatcher) {
    return (
      <InfoCard
        icon={<ShieldAlert className="h-6 w-6" />}
        title={t('meteo.noAccess.title')}
        body={t('meteo.noAccess.body')}
      />
    );
  }

  if (status.isError || !status.data) {
    return (
      <InfoCard
        icon={<CloudOff className="h-6 w-6" />}
        title={t('meteo.loadError')}
        body={status.error instanceof Error ? status.error.message : t('common.error')}
      />
    );
  }

  if (!status.data.configured) {
    return (
      <InfoCard
        icon={<CloudOff className="h-6 w-6" />}
        title={t('meteo.notConfigured.title')}
        body={t('meteo.notConfigured.body')}
      />
    );
  }

  if (!status.data.enabled) {
    return (
      <InfoCard
        icon={<FlaskConical className="h-6 w-6" />}
        title={t('meteo.beta.title')}
        body={t('meteo.beta.body')}
      >
        {isAdmin ? (
          <>
            <button
              type="button"
              onClick={() => update.mutate({ enabled: true })}
              disabled={update.isPending}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('meteo.beta.activate')}
            </button>
            {update.isError && (
              <p className="mt-2 text-sm text-red-600">{t('meteo.beta.activateError')}</p>
            )}
          </>
        ) : (
          <p className="mt-4 text-xs text-neutral-400">{t('meteo.beta.adminOnly')}</p>
        )}
      </InfoCard>
    );
  }

  return <>{children}</>;
}
