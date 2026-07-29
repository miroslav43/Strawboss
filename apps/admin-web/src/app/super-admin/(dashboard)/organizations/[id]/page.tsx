'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Loader2, Undo2 } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/Switch';

/**
 * Super-admin console for one organization's feature toggles.
 *
 * ── WHAT THE PAGE IS FOR ──────────────────────────────────────────────────
 *
 * An operator arrives with two questions: what can this customer use, and if I
 * flip this, whose day do I ruin? So the page leads with the configuration as a
 * summary, groups the switches by module with per-module counts (you can audit
 * a customer without expanding anything), and refuses to let a change be saved
 * before showing exactly what it will do.
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
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    void apiClient
      .get<{ name: string }>(`/api/v1/organizations/${orgId}`)
      .then((org) => setOrgName(org.name))
      .catch(() => setOrgName(''));
  }, [orgId]);

  /*
   * Hydrate from the server ONCE, then leave local state alone.
   *
   * Reacting to every change of `featuresQuery.data` silently destroys work:
   * `refetchOnWindowFocus` is on globally with a 60s staleTime, so switching
   * tabs and coming back overwrote every unsaved toggle AND reset `dirty` to
   * false, so even the "unsaved changes" hint vanished. `hydratedRef` pins it
   * to the first answer; a successful save re-arms it deliberately.
   */
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !featuresQuery.data) return;
    hydratedRef.current = true;
    setOverrides(featuresQuery.data.featureOverrides ?? {});
    setPlanLabel(featuresQuery.data.planLabel ?? null);
  }, [featuresQuery.data]);

  const saved0 = featuresQuery.data?.featureOverrides ?? {};
  const savedPlanLabel = featuresQuery.data?.planLabel ?? null;

  /** Keys whose stored value differs from what is on screen. */
  const changedKeys = useMemo(() => {
    const before = normalize(saved0);
    const after = normalize(overrides);
    const keys = new Set<FeatureKey>([
      ...(Object.keys(before) as FeatureKey[]),
      ...(Object.keys(after) as FeatureKey[]),
    ]);
    return [...keys].filter((k) => before[k] !== after[k]);
  }, [saved0, overrides]);

  // Includes planLabel: applying a preset that produces the same override set
  // (Enterprise on an already-clean org) still changes the plan, and without
  // this the Save button stayed disabled and that change was unreachable.
  const dirty = changedKeys.length > 0 || planLabel !== savedPlanLabel;

  /** Same resolution the backend performs — the cascade preview. */
  const disabled = useMemo(() => new Set(resolveDisabledFeatures(overrides)), [overrides]);

  const switchable = useMemo(
    () => FEATURE_KEYS.filter((k) => FEATURES[k].uiSwitch && FEATURES[k].wired),
    [],
  );
  const unwiredCount = FEATURE_KEYS.filter(
    (k) => FEATURES[k].uiSwitch && !FEATURES[k].wired,
  ).length;

  const offCount = switchable.filter((k) => disabled.has(k)).length;
  const activeUsersByRole = featuresQuery.data?.activeUsersByRole ?? {};

  /** Active accounts that a pending role change would stop anyone adding to. */
  const affectedAccounts = useMemo(
    () =>
      changedKeys
        .filter((k) => k.startsWith('roles.') && overrides[k] === false)
        .map((k) => ({ key: k, count: activeUsersByRole[k.slice('roles.'.length)] ?? 0 }))
        .filter((r) => r.count > 0),
    [changedKeys, overrides, activeUsersByRole],
  );

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
    // Store the stable preset KEY, not its translation: the label is persisted
    // and read back by other admins, whose UI language may differ.
    setPlanLabel(preset);
    // Filtered to what is switchable today; the preset itself stays written
    // against the full registry and completes itself as modules land.
    setOverrides(applicablePreset(preset));
  };

  const discard = () => {
    setOverrides(saved0);
    setPlanLabel(savedPlanLabel);
    setSaved(false);
    setError(null);
  };

  const save = () => {
    setError(null);
    updateFeatures.mutate(
      { featureOverrides: overrides, planLabel, reason: reason.trim() },
      {
        onSuccess: () => {
          setSaved(true);
          setReason('');
          // Deliberate re-arm: the invalidated query refetches and THAT answer
          // becomes the new local baseline.
          hydratedRef.current = false;
        },
        onError: (err: unknown) =>
          setError(err instanceof Error ? err.message : t('superAdmin.features.saveFailed')),
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

  const changes = featuresQuery.data?.changes ?? [];

  return (
    <div className={cn('flex flex-col gap-5', dirty ? 'pb-56' : 'pb-10')}>
      {/* ── Header: the configuration stated as a fact ─────────────────── */}
      <header>
        <a
          href="/super-admin/organizations"
          className="mb-2 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('superAdmin.features.back')}
        </a>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold text-neutral-800">
            {orgName || t('superAdmin.features.title')}
          </h1>
          {planLabel ? (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {renderPlanLabel(planLabel, t)}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          {offCount === 0
            ? t('superAdmin.features.summaryAllOn', { total: switchable.length })
            : t('superAdmin.features.summary', {
                on: switchable.length - offCount,
                total: switchable.length,
                off: offCount,
              })}
        </p>
      </header>

      {/* ── Presets ────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-800">
              {t('superAdmin.features.presets')}
            </h2>
            <p className="text-xs text-neutral-500">{t('superAdmin.features.presetHint')}</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {(Object.keys(FEATURE_PRESETS) as FeaturePresetKey[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyPreset(preset)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  planLabel === preset
                    ? 'border-primary bg-primary/5 font-medium text-primary'
                    : 'border-neutral-200 text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50',
                )}
              >
                {t(`superAdmin.features.preset.${preset}`)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Modules ────────────────────────────────────────────────────── */}
      {FEATURE_MODULES.map((mod) => {
        const rows = switchable.filter((k) => FEATURES[k].module === mod);
        if (rows.length === 0) return null;
        const modOff = rows.filter((k) => disabled.has(k)).length;

        return (
          <section
            key={mod}
            className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"
          >
            <header className="flex items-center gap-3 border-b border-neutral-100 bg-neutral-50 px-5 py-2.5">
              <h2 className="text-sm font-semibold text-neutral-800">{t(featureLabelKey(mod))}</h2>
              {/* Tabular figures so these counts line up down the page and can
                  be compared without reading each one. */}
              <span
                className={cn(
                  'ml-auto rounded-full px-2 py-0.5 text-xs tabular-nums',
                  modOff === 0
                    ? 'bg-primary/10 text-primary'
                    : modOff === rows.length
                      ? 'bg-neutral-200 text-neutral-600'
                      : 'bg-warning/10 text-warning',
                )}
              >
                {modOff === 0
                  ? t('superAdmin.features.moduleAllOn')
                  : t('superAdmin.features.moduleOff', { off: modOff, total: rows.length })}
              </span>
            </header>

            <div className="divide-y divide-neutral-100">
              {rows.map((key) => {
                const def = FEATURES[key];
                const isOff = disabled.has(key);
                // Off because a dependency is off, not by its own override: the
                // switch is not the lever here, so say where the decision lives.
                const byCascade = isOff && overrides[key] !== false;
                const roleCount = key.startsWith('roles.')
                  ? (activeUsersByRole[key.slice('roles.'.length)] ?? 0)
                  : 0;
                const changed = changedKeys.includes(key);

                return (
                  <div
                    key={key}
                    className={cn(
                      'flex items-center gap-4 px-5 py-2.5 transition-colors',
                      // A quiet left rule marks rows this save will change —
                      // findable by eye when scrolling back over a long page.
                      changed && 'border-l-2 border-l-primary bg-primary/[0.03] pl-[18px]',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm', isOff ? 'text-neutral-400' : 'text-neutral-800')}>
                        {t(featureLabelKey(key))}
                      </p>
                      <p className="mt-0.5 text-[11px] text-neutral-400">
                        {byCascade
                          ? t('superAdmin.features.viaModule', {
                              module: t(featureLabelKey(def.module)),
                            })
                          : def.surfaces
                              .map((s) => t(`superAdmin.features.surface.${s}`))
                              .join(' · ')}
                      </p>
                    </div>

                    {roleCount > 0 ? (
                      // Amber means exactly one thing on this page: live
                      // accounts are involved. Always rendered, so nothing
                      // shifts when the switch flips.
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[11px] tabular-nums',
                          isOff ? 'bg-warning/10 text-warning' : 'text-neutral-400',
                        )}
                        title={t('superAdmin.features.roleWarning', { count: roleCount })}
                      >
                        {t('superAdmin.features.accounts', { count: roleCount })}
                      </span>
                    ) : null}

                    <Switch
                      checked={!isOff}
                      disabled={byCascade}
                      onChange={() => toggle(key)}
                      label={t(featureLabelKey(key))}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {unwiredCount > 0 ? (
        <p className="text-xs text-neutral-400">
          {t('superAdmin.features.notWired')} ({unwiredCount}) —{' '}
          {t('superAdmin.features.notWiredHint')}
        </p>
      ) : null}

      {/* ── History, collapsed by default ──────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-5 py-3 text-left hover:bg-neutral-50"
        >
          <h2 className="text-sm font-semibold text-neutral-800">
            {t('superAdmin.features.history')}
          </h2>
          <span className="text-xs tabular-nums text-neutral-400">{changes.length}</span>
          <ChevronDown
            className={cn(
              'ml-auto h-4 w-4 text-neutral-400 transition-transform',
              historyOpen && 'rotate-180',
            )}
          />
        </button>
        {historyOpen ? (
          changes.length === 0 ? (
            <p className="border-t border-neutral-100 px-5 py-4 text-sm text-neutral-400">
              {t('superAdmin.features.historyEmpty')}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
              {changes.map((c, i) => (
                <li key={`${c.featureKey}-${c.createdAt}-${i}`} className="px-5 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="text-neutral-700">{featureLabel(c.featureKey, t)}</span>
                    <span
                      className={cn(
                        'rounded px-1.5 text-xs',
                        c.newEnabled
                          ? 'bg-primary/10 text-primary'
                          : 'bg-neutral-200 text-neutral-600',
                      )}
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
          )
        ) : null}
      </section>

      {/*
        ── The commit bar ───────────────────────────────────────────────────
        Deliberately a DIFF, not a counter. This writes a cross-tenant kill
        switch whose only trace is an audit row, so the operator reads exactly
        what they are about to do — and names why — before the button unlocks.
        Hidden entirely when nothing has changed, so the page is calm at rest.
      */}
      {dirty ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 backdrop-blur">
          <div className="mx-auto max-w-5xl px-6 py-3">
            <div className="mb-2 flex items-start gap-2">
              <p className="shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {t('superAdmin.features.changeSummary')}
              </p>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {changedKeys.length === 0 ? (
                  <span className="text-xs text-neutral-500">
                    {t('superAdmin.features.planOnlyChange')}
                  </span>
                ) : (
                  changedKeys.map((k) => (
                    <span
                      key={k}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs',
                        overrides[k] === false
                          ? 'bg-neutral-200 text-neutral-700'
                          : 'bg-primary/10 text-primary',
                      )}
                      title={k}
                    >
                      {t(featureLabelKey(k))}{' '}
                      {overrides[k] === false
                        ? '→ ' + t('superAdmin.features.off')
                        : '→ ' + t('superAdmin.features.on')}
                    </span>
                  ))
                )}
              </div>
            </div>

            {affectedAccounts.length > 0 ? (
              <p className="mb-2 flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  {affectedAccounts
                    .map((a) => t('superAdmin.features.roleWarning', { count: a.count }))
                    .join(' ')}
                </span>
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('superAdmin.features.reasonPlaceholder')}
                aria-label={t('superAdmin.features.reason')}
                className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={discard}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
              >
                <Undo2 className="h-4 w-4" />
                {t('superAdmin.features.discard')}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={reason.trim().length < 3 || updateFeatures.isPending}
                className="flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {updateFeatures.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {updateFeatures.isPending
                  ? t('superAdmin.features.saving')
                  : t('superAdmin.features.save')}
              </button>
            </div>
            {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
          </div>
        </div>
      ) : saved ? (
        <p className="flex items-center gap-1.5 text-sm text-primary">
          <Check className="h-4 w-4" />
          {t('superAdmin.features.saved')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Preset labels are persisted as the preset KEY so they translate per viewer.
 * Anything written before that change is free text and is shown as-is.
 */
function renderPlanLabel(label: string | null, t: (k: string) => string): string {
  if (!label) return '';
  if (label in FEATURE_PRESETS) return t(`superAdmin.features.preset.${label}`);
  return label;
}

/** History rows store the raw key; show the human label when we still have one. */
function featureLabel(key: string, t: (k: string) => string): string {
  return key in FEATURES ? t(featureLabelKey(key as FeatureKey)) : key;
}

/** Sparse-canonical form, so "no change" compares reliably. */
function normalize(overrides: FeatureOverrides): FeatureOverrides {
  const out: FeatureOverrides = {};
  for (const key of Object.keys(overrides).sort() as FeatureKey[]) {
    if (overrides[key] === false) out[key] = false;
  }
  return out;
}
