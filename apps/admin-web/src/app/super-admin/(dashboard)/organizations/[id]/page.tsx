'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Check, Loader2, Users } from 'lucide-react';
import {
  FEATURE_KEYS,
  FEATURE_MODULES,
  FEATURE_PRESETS,
  FEATURES,
  applicablePreset,
  featureLabelKey,
  resolveDisabledFeatures,
  type FeatureKey,
  type FeatureOverrides,
  type FeaturePresetKey,
} from '@strawboss/types';
import { useOrgFeatures, useUpdateOrgFeatures } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Super-admin console for one organization's feature toggles.
 *
 * ── WHAT IS RENDERED ──────────────────────────────────────────────────────
 *
 * Only switches that are BOTH `uiSwitch` and `wired`. A toggle that silently
 * does nothing is worse than an absent one — the operator flips it, sees no
 * effect, and stops trusting the console. Unwired features are summarised as a
 * greyed note instead, so the roadmap is visible without being clickable.
 *
 * ── LIVE CASCADE PREVIEW ──────────────────────────────────────────────────
 *
 * The page holds RAW overrides and runs the same `resolveDisabledFeatures` the
 * server does, so switching a module off immediately shows every dependent
 * feature going dark before anything is saved. Storage stays sparse: only
 * deviations from the registry defaults are sent.
 */
export default function OrganizationFeaturesPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const orgId = params?.id ?? '';

  const featuresQuery = useOrgFeatures(apiClient, orgId);
  const updateFeatures = useUpdateOrgFeatures(apiClient, orgId);

  const [orgName, setOrgName] = useState<string>('');
  const [overrides, setOverrides] = useState<FeatureOverrides>({});
  const [planLabel, setPlanLabel] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    void apiClient
      .get<{ name: string }>(`/api/v1/organizations/${orgId}`)
      .then((org) => setOrgName(org.name))
      .catch(() => setOrgName(''));
  }, [orgId]);

  // Hydrate local state once the server answers, matching the existing
  // OrgRequestPortalSection pattern.
  useEffect(() => {
    if (featuresQuery.data) {
      setOverrides(featuresQuery.data.featureOverrides ?? {});
      setPlanLabel(featuresQuery.data.planLabel ?? null);
    }
  }, [featuresQuery.data]);

  const saved0 = featuresQuery.data?.featureOverrides ?? {};
  const dirty = useMemo(
    () => JSON.stringify(normalize(saved0)) !== JSON.stringify(normalize(overrides)),
    [saved0, overrides],
  );

  /** Same resolution the backend performs — the cascade preview. */
  const disabled = useMemo(() => new Set(resolveDisabledFeatures(overrides)), [overrides]);

  const switchable = useMemo(
    () => FEATURE_KEYS.filter((k) => FEATURES[k].uiSwitch && FEATURES[k].wired),
    [],
  );
  const unwiredCount = FEATURE_KEYS.filter(
    (k) => FEATURES[k].uiSwitch && !FEATURES[k].wired,
  ).length;

  const toggle = (key: FeatureKey) => {
    setSaved(false);
    setOverrides((prev) => {
      const next = { ...prev };
      // Enabling means REMOVING the override, not storing `true`: the registry
      // default is the truth, and storage must stay sparse so "org has no
      // overrides" keeps meaning "pure defaults".
      if (next[key] === false) delete next[key];
      else next[key] = false;
      return next;
    });
  };

  const applyPreset = (preset: FeaturePresetKey) => {
    setSaved(false);
    setPlanLabel(t(`superAdmin.features.preset.${preset}`));
    // Filtered to what is switchable today; the preset itself stays written
    // against the full registry and completes itself as modules land.
    setOverrides(applicablePreset(preset));
  };

  const save = () => {
    setError(null);
    updateFeatures.mutate(
      { featureOverrides: overrides, planLabel, reason: reason.trim() },
      {
        onSuccess: () => {
          setSaved(true);
          setReason('');
        },
        onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Save failed'),
      },
    );
  };

  if (featuresQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-400">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
        {t('superAdmin.features.loading')}
      </div>
    );
  }

  const activeUsersByRole = featuresQuery.data?.activeUsersByRole ?? {};

  return (
    <div className="flex flex-col gap-6 pb-24">
      <div>
        <a
          href="/super-admin/organizations"
          className="mb-2 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('superAdmin.features.back')}
        </a>
        <h1 className="text-xl font-bold text-neutral-800">
          {t('superAdmin.features.title')}
          {orgName ? <span className="text-neutral-400"> — {orgName}</span> : null}
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">{t('superAdmin.features.subtitle')}</p>
      </div>

      {/* Presets */}
      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-1 flex items-baseline gap-3">
          <h2 className="text-sm font-semibold text-neutral-800">
            {t('superAdmin.features.presets')}
          </h2>
          {planLabel ? (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
              {t('superAdmin.features.planLabel')}: {planLabel}
            </span>
          ) : null}
        </div>
        <p className="mb-3 text-xs text-neutral-500">{t('superAdmin.features.presetHint')}</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(FEATURE_PRESETS) as FeaturePresetKey[]).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset)}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50"
            >
              {t(`superAdmin.features.preset.${preset}`)}
            </button>
          ))}
        </div>
      </section>

      {/* Modules */}
      <p className="-mb-2 text-xs text-neutral-500">{t('superAdmin.features.cascadeNote')}</p>
      {FEATURE_MODULES.map((mod) => {
        const rows = switchable.filter((k) => FEATURES[k].module === mod);
        if (rows.length === 0) return null;
        return (
          <section
            key={mod}
            className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"
          >
            <header className="border-b border-neutral-100 bg-neutral-50 px-5 py-3">
              <h2 className="text-sm font-semibold text-neutral-800">{t(featureLabelKey(mod))}</h2>
            </header>
            <div className="divide-y divide-neutral-100">
              {rows.map((key) => {
                const def = FEATURES[key];
                const isOff = disabled.has(key);
                // Off because a dependency is off, not by its own override:
                // show it dark but make clear the switch is not the lever.
                const byCascade = isOff && overrides[key] !== false;
                const roleCount = key.startsWith('roles.')
                  ? (activeUsersByRole[key.slice('roles.'.length)] ?? 0)
                  : 0;
                return (
                  <div key={key} className="flex items-start gap-4 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            isOff ? 'text-sm text-neutral-400' : 'text-sm text-neutral-800'
                          }
                        >
                          {t(featureLabelKey(key))}
                        </span>
                        {byCascade ? (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                            {t(featureLabelKey(def.module))}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
                        <span>
                          {t('superAdmin.features.affects')}:{' '}
                          {def.surfaces
                            .map((s) => t(`superAdmin.features.surface.${s}`))
                            .join(', ')}
                        </span>
                        <span className="font-mono">{key}</span>
                      </div>
                      {roleCount > 0 && overrides[key] === false ? (
                        <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                          {t('superAdmin.features.roleWarning', { count: roleCount })}
                        </p>
                      ) : roleCount > 0 ? (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-neutral-400">
                          <Users className="h-3 w-3" />
                          {roleCount}
                        </p>
                      ) : null}
                    </div>
                    <Switch
                      on={!isOff}
                      disabled={byCascade}
                      onToggle={() => toggle(key)}
                      labelOn={t('superAdmin.features.on')}
                      labelOff={t('superAdmin.features.off')}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {unwiredCount > 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-5 py-4">
          <p className="text-sm font-medium text-neutral-500">
            {t('superAdmin.features.notWired')} ({unwiredCount})
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">{t('superAdmin.features.notWiredHint')}</p>
        </div>
      ) : null}

      {/* History */}
      <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <header className="border-b border-neutral-100 bg-neutral-50 px-5 py-3">
          <h2 className="text-sm font-semibold text-neutral-800">
            {t('superAdmin.features.history')}
          </h2>
        </header>
        {(featuresQuery.data?.changes ?? []).length === 0 ? (
          <p className="px-5 py-4 text-sm text-neutral-400">
            {t('superAdmin.features.historyEmpty')}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {(featuresQuery.data?.changes ?? []).map((c, i) => (
              <li key={`${c.featureKey}-${c.createdAt}-${i}`} className="px-5 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-neutral-600">{c.featureKey}</span>
                  <span
                    className={
                      c.newEnabled
                        ? 'rounded bg-green-50 px-1.5 text-xs text-green-700'
                        : 'rounded bg-red-50 px-1.5 text-xs text-red-700'
                    }
                  >
                    {c.newEnabled ? t('superAdmin.features.on') : t('superAdmin.features.off')}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {new Date(c.createdAt).toLocaleString()} {t('superAdmin.features.historyBy')}{' '}
                    {c.actorName ?? c.actorRole ?? '—'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-neutral-500">{c.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sticky save bar — a reason is mandatory, since `organizations` carries
          no audit trigger and this is a cross-tenant switch. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('superAdmin.features.reasonPlaceholder')}
            aria-label={t('superAdmin.features.reason')}
            className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none"
          />
          <span className="shrink-0 text-xs text-neutral-500">
            {dirty
              ? t('superAdmin.features.pendingCount', { count: disabled.size })
              : saved
                ? t('superAdmin.features.saved')
                : t('superAdmin.features.noChanges')}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || reason.trim().length < 3 || updateFeatures.isPending}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {updateFeatures.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <Check className="h-4 w-4" />
            ) : null}
            {updateFeatures.isPending
              ? t('superAdmin.features.saving')
              : t('superAdmin.features.save')}
          </button>
        </div>
        {error ? <p className="mx-auto mt-2 max-w-5xl text-xs text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}

/** Sparse-canonical form, so "no change" compares reliably. */
function normalize(overrides: FeatureOverrides): FeatureOverrides {
  const out: FeatureOverrides = {};
  for (const key of Object.keys(overrides).sort() as FeatureKey[]) {
    if (overrides[key] === false) out[key] = false;
  }
  return out;
}

function Switch({
  on,
  disabled,
  onToggle,
  labelOn,
  labelOff,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? labelOn : labelOff}
      disabled={disabled}
      onClick={onToggle}
      className={[
        'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors',
        on ? 'bg-green-600' : 'bg-neutral-300',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-[22px]' : 'translate-x-0.5',
        ].join(' ')}
      />
    </button>
  );
}
