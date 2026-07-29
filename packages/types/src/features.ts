/**
 * Per-organization feature toggles — the SINGLE SOURCE OF TRUTH for what can be
 * switched on or off, and what the answer is when nobody has switched anything.
 *
 * A super_admin turns modules/features off for one tenant. The backend then
 * blocks the corresponding WRITE paths while every READ path (history, reports,
 * documents) stays open — a disabled feature must never make existing data
 * unreachable or make a report lie.
 *
 * ── THE THREE LAYERS ──────────────────────────────────────────────────────
 *
 *   REGISTRY (this file)   what features EXIST, and their defaults.
 *   OVERRIDES (DB, JSONB)  what one org CHANGED — sparse, usually `{}`.
 *   RESOLUTION (below)     defaults <- overrides <- dependency closure.
 *
 * Storage is SPARSE on purpose: `organizations.feature_overrides` holds only
 * deviations, e.g. `{"costs.fuel": false}`. Effective value = `override ??
 * default`. A feature added to this registry six months from now therefore
 * needs NO backfill — every existing org picks up its default automatically.
 *
 * ── THE RULE THAT MAKES DEPLOYS SAFE ──────────────────────────────────────
 *
 * Every entry ships `defaultEnabled: true`. Not "usually" — the field is typed
 * as the literal `true`, so writing `false` is a compile error, and a unit test
 * asserts `resolveDisabledFeatures({}) === []`.
 *
 * The reason is precisely the sparse storage: an org that has never been touched
 * stores `{}`, so its behaviour is 100% determined by these defaults. A single
 * `defaultEnabled: false` would silently switch that feature off for EVERY
 * existing organization the moment the code deploys. "Off for new customers" is
 * expressed by FEATURE_PRESETS.new_org, applied at org-creation time — never by
 * a default.
 *
 * ── FAIL-OPEN IS STRUCTURAL, NOT A CODE PATH ──────────────────────────────
 *
 * The wire format is the DISABLED keys only (`resolveDisabledFeatures`). An
 * empty array means "everything on", so a client that never received the list —
 * a phone booting offline, an APK from three releases ago — behaves exactly like
 * a fully-enabled one. `isFeatureEnabled` likewise returns true for any key it
 * does not recognise, which is what lets an old mobile build survive a registry
 * that has grown since it shipped.
 *
 * ── CORE IS DEFINED BY ABSENCE ────────────────────────────────────────────
 *
 * Auth, the trip state machine and its ten transitions, task assignments,
 * sync push/pull, idempotency, org scoping, soft deletes, uploads, profile and
 * `/fleet/checkin` are NOT in this registry and never will be. A flag is a
 * PRODUCT gate, never a SECURITY gate, and never something that can strand a
 * trip mid-lifecycle or brick an organization.
 *
 * ── KEYS ARE FOREVER ──────────────────────────────────────────────────────
 *
 * `<module>.<leaf>`, lowercase snake. Renaming a key silently RE-ENABLES that
 * feature for every org that had it switched off, because the stored override
 * no longer matches anything. Add and deprecate; never rename.
 */

/** The ten top-level modules. Each is also a FeatureKey in its own right. */
export const FEATURE_MODULES = [
  'bales',
  'geo',
  'depot',
  'costs',
  'documents',
  'aux',
  'portals',
  'messaging',
  'analytics',
  'roles',
] as const;

export type FeatureModuleKey = (typeof FEATURE_MODULES)[number];

/**
 * Where a feature is visible. Informational — the super-admin console renders
 * these as "affects: web / mobile" so the operator knows what a switch touches.
 */
export type FeatureSurface = 'web' | 'mobile' | 'api' | 'jobs';

export interface FeatureDef {
  module: FeatureModuleKey;
  /**
   * ALWAYS `true` — typed as the literal so `false` cannot compile. See the
   * header: a `false` here changes behaviour for every existing org on deploy,
   * because storage is sparse.
   */
  defaultEnabled: true;
  /**
   * Closure inputs: if ANY of these resolves disabled, so does this feature.
   * Module membership is modelled as a plain `dependsOn: ['<module>']` rather
   * than special-cased anywhere, so the resolver has exactly one rule.
   */
  dependsOn: readonly FeatureKey[];
  surfaces: readonly FeatureSurface[];
  /**
   * BullMQ queues this feature gates wholesale for a disabled org. Only queues
   * that are PURELY this feature's work appear here. Hygiene queues
   * (sync-cleanup, gps-retention, stale-plan-sweep, presence-deadman,
   * geofence-check, ota-deploy) are never listed — switching those off is
   * strictly more dangerous than leaving them on, and they are not features.
   * Queues that serve several features (trip-autocomplete) are also absent;
   * those are checked per-record inside the processor instead.
   */
  gatesJobs?: readonly string[];
  /**
   * `false` → the row exists purely as a dependency anchor and renders no
   * switch. Writes to a `uiSwitch: false` key are rejected by the API.
   */
  uiSwitch: boolean;
  /**
   * `true` → this key has no server-side gate, and cannot have one: everything
   * behind it is a READ, and the registry's contract is that reads stay open so
   * history and reports never break.
   *
   * Flipping it hides a control, a tab or a step. That is genuinely useful —
   * less noise for a customer who does not use the feature — but it is NOT a
   * commercial boundary: the data stays reachable over the API. The console
   * labels these so nobody switches one off believing they revoked access.
   */
  uiOnly?: boolean;
  /**
   * Does flipping this key actually change anything YET?
   *
   * Required, not optional, so adding a feature forces an explicit answer.
   * The console renders only wired switches and the API rejects writes to the
   * rest — because a toggle that silently does nothing is worse than no toggle
   * at all: the operator switches "Documente" off, nothing happens, and they
   * conclude the whole system is broken.
   *
   * A module row is wired only once EVERY one of its leaves is. Delete these
   * `false`s as each module gets wired end to end.
   */
  wired: boolean;
}

/**
 * Every key, modules first. The array is the source of the `FeatureKey` union,
 * so a typo in `@RequireFeature('costs.feul')` is a compile error, not a
 * silently-always-enabled endpoint.
 */
export const FEATURE_KEYS = [
  // modules
  'bales',
  'geo',
  'depot',
  'costs',
  'documents',
  'aux',
  'portals',
  'messaging',
  'analytics',
  'roles',
  // bales
  'bales.production',
  'bales.load_register',
  'bales.parcel_daily_status',
  'bales.adjustments',
  'bales.reconciliation',
  // geo
  'geo.parcels',
  'geo.farms',
  'geo.kml_import',
  'geo.draw_mobile',
  'geo.tracks',
  'geo.auto_transitions',
  // depot
  'depot.destinations',
  'depot.manned_confirm',
  'depot.weighing',
  'depot.inventory',
  // costs
  'costs.fuel',
  'costs.consumables',
  'costs.receipt_photos',
  'costs.report',
  // documents
  'documents.library',
  'documents.cmr_generate',
  'documents.cmr_scan',
  'documents.public_sign',
  'documents.aviz',
  'documents.comanda',
  // aux
  'aux.requests',
  'aux.field_pickup',
  // portals
  'portals.beneficiaries',
  'portals.public_request',
  'portals.beneficiary_pin',
  'portals.transporter_role',
  // messaging
  'messaging.email',
  'messaging.sms',
  'messaging.monitor',
  'messaging.broadcast',
  // analytics
  'analytics.reports',
  'analytics.report_operators',
  'analytics.export',
  'analytics.alerts',
  'analytics.fraud',
  // roles — grandfathering: these gate ACCOUNT CREATION only. Never login,
  // never routing, never @Roles. An existing account keeps working forever.
  'roles.driver',
  'roles.loader_operator',
  'roles.baler_operator',
  'roles.geofence_maker',
  'roles.depot_manager',
  'roles.dispatcher',
  'roles.transportator',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Sparse: only deviations from the registry defaults are ever stored. */
export type FeatureOverrides = Partial<Record<FeatureKey, boolean>>;

/**
 * `Record` (not `Partial<Record>`) on purpose — adding a key to FEATURE_KEYS
 * without adding its definition here is a COMPILE ERROR, not a runtime crash on
 * the first org that touches it.
 */
export const FEATURES: Readonly<Record<FeatureKey, FeatureDef>> = {
  // ── Modules ──────────────────────────────────────────────────────────────
  bales: {
    module: 'bales',
    defaultEnabled: true,
    dependsOn: [],
    surfaces: ['web', 'mobile', 'api'],
    wired: true,
    uiSwitch: true,
  },
  geo: {
    module: 'geo',
    defaultEnabled: true,
    dependsOn: [],
    surfaces: ['web', 'mobile', 'api'],
    wired: true,
    uiSwitch: true,
  },
  depot: {
    module: 'depot',
    defaultEnabled: true,
    dependsOn: [],
    surfaces: ['web', 'mobile', 'api'],
    wired: true,
    uiSwitch: true,
  },
  costs: {
    module: 'costs',
    defaultEnabled: true,
    dependsOn: [],
    surfaces: ['web', 'mobile', 'api'],
    wired: true,
    uiSwitch: true,
  },
  documents: {
    module: 'documents',
    defaultEnabled: true,
    dependsOn: [],
    surfaces: ['web', 'mobile', 'api', 'jobs'],
    wired: true,
    uiSwitch: true,
  },
  aux: {
    module: 'aux',
    defaultEnabled: true,
    dependsOn: [],
    surfaces: ['web', 'mobile', 'api'],
    wired: true,
    uiSwitch: true,
  },
  portals: {
    module: 'portals',
    defaultEnabled: true,
    dependsOn: [],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  messaging: {
    module: 'messaging',
    defaultEnabled: true,
    dependsOn: [],
    surfaces: ['web', 'api', 'jobs'],
    gatesJobs: ['message-send'],
    wired: true,
    uiSwitch: true,
  },
  analytics: {
    module: 'analytics',
    defaultEnabled: true,
    dependsOn: [],
    surfaces: ['web', 'api', 'jobs'],
    wired: true,
    uiSwitch: true,
  },
  roles: {
    module: 'roles',
    defaultEnabled: true,
    dependsOn: [],
    surfaces: ['web', 'api'],
    // A master switch here would read as "no new accounts of any kind", which
    // is never what an operator means. Anchor only.
    wired: true,
    uiSwitch: false,
  },

  // ── M1 bales — Baloți și producție ───────────────────────────────────────
  'bales.production': {
    module: 'bales',
    defaultEnabled: true,
    dependsOn: ['bales'],
    surfaces: ['mobile', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'bales.load_register': {
    module: 'bales',
    defaultEnabled: true,
    dependsOn: ['bales'],
    surfaces: ['mobile', 'web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'bales.parcel_daily_status': {
    module: 'bales',
    defaultEnabled: true,
    dependsOn: ['bales'],
    surfaces: ['mobile', 'web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'bales.adjustments': {
    module: 'bales',
    defaultEnabled: true,
    dependsOn: ['bales'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'bales.reconciliation': {
    module: 'bales',
    defaultEnabled: true,
    dependsOn: ['bales'],
    surfaces: ['jobs', 'api'],
    gatesJobs: ['reconciliation'],
    wired: true,
    uiSwitch: true,
  },

  // ── M2 geo — Câmpuri și hărți ────────────────────────────────────────────
  'geo.parcels': {
    module: 'geo',
    defaultEnabled: true,
    dependsOn: ['geo'],
    surfaces: ['web', 'mobile', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'geo.farms': {
    module: 'geo',
    defaultEnabled: true,
    dependsOn: ['geo'],
    surfaces: ['web', 'mobile', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'geo.kml_import': {
    module: 'geo',
    defaultEnabled: true,
    dependsOn: ['geo.parcels'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'geo.draw_mobile': {
    module: 'geo',
    defaultEnabled: true,
    dependsOn: ['geo.parcels'],
    surfaces: ['mobile', 'api'],
    uiOnly: true,
    wired: true,
    uiSwitch: true,
  },
  'geo.tracks': {
    module: 'geo',
    defaultEnabled: true,
    dependsOn: ['geo'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'geo.auto_transitions': {
    module: 'geo',
    defaultEnabled: true,
    dependsOn: ['geo.parcels'],
    surfaces: ['mobile', 'api'],
    wired: true,
    uiSwitch: true,
  },

  // ── M3 depot — Depozite și recepție ──────────────────────────────────────
  'depot.destinations': {
    module: 'depot',
    defaultEnabled: true,
    dependsOn: ['depot'],
    surfaces: ['web', 'mobile', 'api'],
    wired: true,
    uiSwitch: true,
  },
  /**
   * ⚠️ Changes TRIP LIVENESS. The driver's phone caches
   * `destination_has_operator` and hides its own confirm button when it is set,
   * so switching this off while a truck sits at `arrived` would strand the trip
   * with nobody able to confirm. `destination_has_operator` MUST therefore be
   * derived as `EXISTS(depot_manager) AND NOT disabled('depot.manned_confirm')`
   * — see trips.service.ts and sync.service.ts.
   */
  'depot.manned_confirm': {
    module: 'depot',
    defaultEnabled: true,
    dependsOn: ['depot.destinations'],
    surfaces: ['mobile', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'depot.weighing': {
    module: 'depot',
    defaultEnabled: true,
    dependsOn: ['depot'],
    surfaces: ['mobile', 'web', 'api'],
    uiOnly: true,
    wired: true,
    uiSwitch: true,
  },
  'depot.inventory': {
    module: 'depot',
    defaultEnabled: true,
    dependsOn: ['depot'],
    surfaces: ['mobile', 'web', 'api'],
    uiOnly: true,
    wired: true,
    uiSwitch: true,
  },

  // ── M4 costs — Costuri operaționale ──────────────────────────────────────
  'costs.fuel': {
    module: 'costs',
    defaultEnabled: true,
    dependsOn: ['costs'],
    surfaces: ['mobile', 'web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'costs.consumables': {
    module: 'costs',
    defaultEnabled: true,
    dependsOn: ['costs'],
    surfaces: ['mobile', 'web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'costs.receipt_photos': {
    module: 'costs',
    defaultEnabled: true,
    dependsOn: ['costs'],
    surfaces: ['mobile', 'web'],
    uiOnly: true,
    wired: true,
    uiSwitch: true,
  },
  'costs.report': {
    module: 'costs',
    defaultEnabled: true,
    dependsOn: ['costs'],
    surfaces: ['web', 'api'],
    uiOnly: true,
    wired: true,
    uiSwitch: true,
  },

  // ── M5 documents — Documente ─────────────────────────────────────────────
  'documents.library': {
    module: 'documents',
    defaultEnabled: true,
    dependsOn: ['documents'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'documents.cmr_generate': {
    module: 'documents',
    defaultEnabled: true,
    dependsOn: ['documents'],
    surfaces: ['web', 'api', 'jobs'],
    gatesJobs: ['cmr-generation'],
    wired: true,
    uiSwitch: true,
  },
  'documents.cmr_scan': {
    module: 'documents',
    defaultEnabled: true,
    dependsOn: ['documents'],
    surfaces: ['mobile', 'web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'documents.public_sign': {
    module: 'documents',
    defaultEnabled: true,
    dependsOn: ['documents'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'documents.aviz': {
    module: 'documents',
    defaultEnabled: true,
    dependsOn: ['documents'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'documents.comanda': {
    module: 'documents',
    defaultEnabled: true,
    dependsOn: ['documents'],
    surfaces: ['web', 'api', 'jobs'],
    gatesJobs: ['comanda-generation'],
    wired: true,
    uiSwitch: true,
  },

  // ── M6 aux — Transport auxiliar (transportatori externi) ─────────────────
  'aux.requests': {
    module: 'aux',
    defaultEnabled: true,
    dependsOn: ['aux'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  /*
   * `aux.autocomplete` used to live here. It was retired rather than wired:
   * the behaviour it named no longer exists — `trip-autocomplete.processor.ts`
   * is a documented no-op with no producer left, and
   * `TripsService.autoCompleteAuxiliary` was deleted. Its successor,
   * `completeAuxiliaryOnArrivalCmr`, is already gated on `documents.cmr_scan`.
   *
   * Removing a key is normally forbidden (see the header: stored overrides
   * would silently re-enable). It is safe here precisely because the key was
   * never wired, so the API rejected every write to it and no organization can
   * hold an override for it.
   */
  'aux.field_pickup': {
    module: 'aux',
    defaultEnabled: true,
    dependsOn: ['aux.requests'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },

  // ── M7 portals — Portaluri externe ───────────────────────────────────────
  'portals.beneficiaries': {
    module: 'portals',
    defaultEnabled: true,
    dependsOn: ['portals'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'portals.public_request': {
    module: 'portals',
    defaultEnabled: true,
    dependsOn: ['portals'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'portals.beneficiary_pin': {
    module: 'portals',
    defaultEnabled: true,
    dependsOn: ['portals.beneficiaries'],
    surfaces: ['web', 'api', 'jobs'],
    gatesJobs: ['pin-regen'],
    wired: true,
    uiSwitch: true,
  },
  'portals.transporter_role': {
    module: 'portals',
    defaultEnabled: true,
    dependsOn: ['portals'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },

  // ── M8 messaging — Mesagerie ─────────────────────────────────────────────
  'messaging.email': {
    module: 'messaging',
    defaultEnabled: true,
    dependsOn: ['messaging'],
    surfaces: ['api', 'jobs'],
    wired: true,
    uiSwitch: true,
  },
  'messaging.sms': {
    module: 'messaging',
    defaultEnabled: true,
    dependsOn: ['messaging'],
    surfaces: ['api', 'jobs'],
    wired: true,
    uiSwitch: true,
  },
  'messaging.monitor': {
    module: 'messaging',
    defaultEnabled: true,
    dependsOn: ['messaging'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'messaging.broadcast': {
    module: 'messaging',
    defaultEnabled: true,
    dependsOn: ['messaging'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },

  // ── M9 analytics — Rapoarte și alerte ────────────────────────────────────
  'analytics.reports': {
    module: 'analytics',
    defaultEnabled: true,
    dependsOn: ['analytics'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  /** ⚠️ Per-operator tracking — some organizations must contractually not have it. */
  'analytics.report_operators': {
    module: 'analytics',
    defaultEnabled: true,
    dependsOn: ['analytics.reports'],
    surfaces: ['web', 'api'],
    uiOnly: true,
    wired: true,
    uiSwitch: true,
  },
  'analytics.export': {
    module: 'analytics',
    defaultEnabled: true,
    dependsOn: ['analytics'],
    surfaces: ['web', 'api'],
    uiOnly: true,
    wired: true,
    uiSwitch: true,
  },
  'analytics.alerts': {
    module: 'analytics',
    defaultEnabled: true,
    dependsOn: ['analytics'],
    surfaces: ['web', 'mobile', 'api', 'jobs'],
    gatesJobs: ['alert-evaluation', 'truck-idle-check'],
    wired: true,
    uiSwitch: true,
  },
  'analytics.fraud': {
    module: 'analytics',
    defaultEnabled: true,
    dependsOn: ['analytics.alerts'],
    surfaces: ['api', 'jobs'],
    wired: true,
    uiSwitch: true,
  },

  // ── M10 roles — Tipuri de cont ───────────────────────────────────────────
  'roles.driver': {
    module: 'roles',
    defaultEnabled: true,
    dependsOn: ['roles'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'roles.loader_operator': {
    module: 'roles',
    defaultEnabled: true,
    dependsOn: ['roles'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'roles.baler_operator': {
    module: 'roles',
    defaultEnabled: true,
    dependsOn: ['roles'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'roles.geofence_maker': {
    module: 'roles',
    defaultEnabled: true,
    dependsOn: ['roles'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'roles.depot_manager': {
    module: 'roles',
    defaultEnabled: true,
    dependsOn: ['roles'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'roles.dispatcher': {
    module: 'roles',
    defaultEnabled: true,
    dependsOn: ['roles'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
  'roles.transportator': {
    module: 'roles',
    defaultEnabled: true,
    dependsOn: ['roles', 'portals.transporter_role'],
    surfaces: ['web', 'api'],
    wired: true,
    uiSwitch: true,
  },
};

/** True for the ten module rows, false for leaves. */
export function isFeatureModuleKey(key: FeatureKey): key is FeatureModuleKey {
  return (FEATURE_MODULES as readonly string[]).includes(key);
}

/**
 * i18n key for a feature's label, DERIVED rather than stored so it can never
 * drift from the feature key.
 *
 * Modules and leaves live in separate namespaces because catalogs are nested
 * objects resolved by dot-path: `features.bales` cannot be both a string (the
 * module's own label) and an object (holding `production`, `load_register`, …).
 */
export function featureLabelKey(key: FeatureKey): string {
  return isFeatureModuleKey(key) ? `features.module.${key}` : `features.item.${key}`;
}

/**
 * Registry defaults <- org overrides <- dependency closure.
 *
 * Returns ONLY the disabled keys: tiny on the wire, and an empty array
 * trivially means "everything on", which is what makes fail-open structural
 * rather than a branch someone can forget.
 *
 * Unknown keys in `overrides` (an org toggled something a later release
 * removed, or this build predates it) are ignored rather than throwing — the
 * resolver iterates the registry, not the stored object.
 *
 * The fixed-point loop is bounded by the key count so a bad `dependsOn` cycle
 * terminates instead of hanging a request. A cycle is impossible today and a
 * unit test asserts convergence, but a guard beats a hung API worker.
 */
export function resolveDisabledFeatures(overrides: FeatureOverrides = {}): FeatureKey[] {
  const effective = {} as Record<FeatureKey, boolean>;
  for (const key of FEATURE_KEYS) {
    effective[key] = overrides[key] ?? FEATURES[key].defaultEnabled;
  }

  for (let pass = 0; pass < FEATURE_KEYS.length; pass++) {
    let changed = false;
    for (const key of FEATURE_KEYS) {
      if (!effective[key]) continue;
      if (FEATURES[key].dependsOn.some((dep) => !effective[dep])) {
        effective[key] = false;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return FEATURE_KEYS.filter((key) => !effective[key]);
}

/**
 * Fail-open by design: a key this build has never heard of is ENABLED.
 *
 * Takes `readonly string[]` (not `FeatureKey[]`) deliberately — the caller is
 * often an old mobile build reading a list the server generated from a newer
 * registry, and narrowing the parameter would make that a type error at exactly
 * the boundary where tolerance is the point.
 */
export function isFeatureEnabled(disabled: readonly string[], key: string): boolean {
  return !disabled.includes(key);
}

/**
 * Commercial presets — BUTTONS in the super-admin console, not a runtime
 * entity. There is no `plans` table and no `plan_id`; applying a preset simply
 * writes this override set. `organizations.plan_label` records which button was
 * pressed for display only, and NO code branches on it.
 *
 * `new_org` is what the org-creation flow writes. It is deliberately NOT the
 * registry default — see the header for why a `false` default is unsafe.
 */
export const FEATURE_PRESETS: Readonly<
  Record<'new_org' | 'basic' | 'pro' | 'enterprise', FeatureOverrides>
> = {
  new_org: {
    aux: false,
    portals: false,
    messaging: false,
    'bales.adjustments': false,
    'geo.kml_import': false,
    'depot.manned_confirm': false,
    'documents.cmr_scan': false,
    'documents.public_sign': false,
    'documents.aviz': false,
    'documents.comanda': false,
    'analytics.report_operators': false,
    'roles.depot_manager': false,
    'roles.transportator': false,
  },
  basic: {
    documents: false,
    aux: false,
    portals: false,
    messaging: false,
    analytics: false,
    'geo.draw_mobile': false,
    'depot.inventory': false,
    'roles.dispatcher': false,
    'roles.geofence_maker': false,
    'roles.transportator': false,
  },
  pro: {
    'messaging.sms': false,
    'analytics.fraud': false,
    'portals.transporter_role': false,
  },
  /** Everything on = pure registry defaults. Stored as `{}`, not a full map. */
  enterprise: {},
};

export type FeaturePresetKey = keyof typeof FEATURE_PRESETS;

/**
 * A preset translated into keys that are actually switchable right now.
 *
 * The presets are written against the FULL registry — that is their long-term
 * shape, and they are not edited as modules get wired. But the API rejects
 * writes to unwired or anchor-only keys, so a raw preset cannot be applied
 * as-is during the rollout.
 *
 * ── WHY THIS EXPANDS INSTEAD OF FILTERING ─────────────────────────────────
 *
 * An earlier version simply dropped unwired keys. Because the presets switch
 * whole MODULES off (`documents: false`) and module rows are wired only once
 * every leaf is, that quietly discarded most of what a preset meant: applying
 * "Basic" left Documents, Auxiliary transport, Messaging and Analytics fully
 * enabled — four of ten modules — so a customer on Basic had effectively
 * Enterprise access. A commercial plan that does not restrict anything is worse
 * than no plan, because it is invisible.
 *
 * So an unwired module row is now expanded into whichever of its leaves ARE
 * wired. The preset's intent survives, the API still only ever receives keys it
 * accepts, and each expansion narrows toward the module row itself as the last
 * leaves land. `uiSwitch: false` anchors (the `roles` row) are still dropped —
 * they are not switches at all.
 */
export function applicablePreset(preset: FeaturePresetKey): FeatureOverrides {
  const source = FEATURE_PRESETS[preset];
  const applicable: FeatureOverrides = {};

  const put = (key: FeatureKey, value: boolean) => {
    const def = FEATURES[key];
    if (!def || !def.uiSwitch) return;
    if (def.wired) {
      applicable[key] = value;
      return;
    }
    // Not wired yet: fall through to whatever the preset actually meant.
    if (isFeatureModuleKey(key)) {
      for (const leaf of FEATURE_KEYS) {
        if (leaf === key) continue;
        if (FEATURES[leaf].module !== key) continue;
        if (!FEATURES[leaf].wired || !FEATURES[leaf].uiSwitch) continue;
        applicable[leaf] = value;
      }
    }
  };

  for (const [key, value] of Object.entries(source) as [FeatureKey, boolean][]) {
    put(key, value);
  }
  return applicable;
}
