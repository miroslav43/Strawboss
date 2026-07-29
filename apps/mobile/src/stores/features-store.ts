import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import { isFeatureEnabled, type FeatureKey } from '@strawboss/types';

/**
 * Which features this device's organization has switched off.
 *
 * ── WHY A SEPARATE STORE FROM auth-store ──────────────────────────────────
 *
 * Its own SecureStore key, so it gets its own 2 048-byte budget rather than
 * eating into the auth payload's, and so a flag write can never corrupt the
 * persisted session — losing that would log an operator out in the field.
 *
 * ── WHY IT MUST BE PERSISTED AT ALL ───────────────────────────────────────
 *
 * On a cold boot with no network, `AuthGate` reads the persisted role and marks
 * the app ready WITHOUT any request. If flags lived only in memory the phone
 * would start every offline shift knowing nothing, and (fail-open) show every
 * feature — including ones the org switched off weeks ago.
 *
 * ── FAIL-OPEN, ALWAYS ─────────────────────────────────────────────────────
 *
 * An empty list means "everything on". That is the state before the first
 * check-in, after a wipe, and whenever storage misbehaves. A field app must
 * never lock someone out of their job because a flag lookup failed — the
 * backend is the real gate.
 */
interface FeaturesStore {
  disabled: string[];
  /** Set from a `/fleet/checkin` or `/profile` response. */
  setDisabled: (keys: string[]) => void;
  clear: () => void;
}

/**
 * Guard against the SecureStore value limit.
 *
 * expo-secure-store warns (it does not throw) past ~2 KB on some platforms, and
 * the write is fire-and-forget, so an oversized payload would fail silently and
 * leave stale flags on disk forever. ~50 keys of ~25 chars is well under this,
 * but the org that eventually trips it must fail OPEN rather than persist a
 * truncated list that reads as "these specific things are off".
 */
const MAX_PERSISTED_BYTES = 1800;

const secureStoreStorage = createJSONStorage<PersistedFeaturesState>(() => ({
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => {
    if (value.length > MAX_PERSISTED_BYTES) {
      // Persist "nothing disabled" rather than a truncated set.
      void SecureStore.setItemAsync(key, JSON.stringify({ state: { disabled: [] }, version: 1 }));
      return;
    }
    void SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string) => {
    void SecureStore.deleteItemAsync(key);
  },
}));

interface PersistedFeaturesState {
  disabled: string[];
}

export const useFeaturesStore = create<FeaturesStore>()(
  persist(
    (set) => ({
      disabled: [],
      setDisabled: (keys) => set({ disabled: Array.isArray(keys) ? keys : [] }),
      clear: () => set({ disabled: [] }),
    }),
    {
      name: 'strawboss-features',
      storage: secureStoreStorage,
      version: 1,
      partialize: (state) => ({ disabled: state.disabled }),
    },
  ),
);

/**
 * Reactive check for use inside components.
 *
 * Takes the key as a `FeatureKey` so a typo is a compile error, while the
 * stored list stays `string[]` — an older build must be able to hold keys from
 * a newer server registry without the types fighting it.
 */
export function useIsFeatureEnabled(key: FeatureKey): boolean {
  return useFeaturesStore((s) => isFeatureEnabled(s.disabled, key));
}

/** Non-reactive read, for background tasks and sync code outside React. */
export function isFeatureEnabledNow(key: FeatureKey): boolean {
  return isFeatureEnabled(useFeaturesStore.getState().disabled, key);
}

/**
 * Tab options that hide a `<Tabs.Screen>` when its feature is off.
 *
 * `href: null` is the idiom this app already uses to keep a route deep-linkable
 * while dropping it from the bar (see `parcel/[parcelId]`, `confirm-delivery`).
 *
 * ── THE LAST-TAB GUARD ────────────────────────────────────────────────────
 *
 * `keepIfLast` is the count of tabs that would remain. A preset that switched
 * off everything a role does would otherwise ship an app whose only tab is
 * Profile — technically correct and completely useless. Below the floor the tab
 * stays visible; the backend still refuses the writes, so nothing leaks.
 */
export function featureTabOptions(enabled: boolean, remainingTabs = 99) {
  if (enabled) return {};
  if (remainingTabs < 2) return {};
  return { href: null } as const;
}
