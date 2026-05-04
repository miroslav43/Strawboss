import { create } from 'zustand';

/**
 * Session-only flags for "debug" UI that is hidden by default but can be
 * revealed by a gesture in the profile screen. State is deliberately NOT
 * persisted — it resets on cold start, warm start, and logout.
 *
 * Today this only gates the "Sincronizare" card on the profile screen:
 * regular users don't need to fiddle with sync controls, but operators still
 * want the escape hatch when debugging, so we unlock it with 5 quick taps on
 * the role badge (see `useTapSequence` + `ProfileScreen`).
 */
interface DevModeStore {
  /** When true, the Sincronizare card on ProfileScreen is rendered. */
  devSyncVisible: boolean;
  revealSync: () => void;
  hideSync: () => void;
}

export const useDevModeStore = create<DevModeStore>()((set) => ({
  devSyncVisible: false,
  revealSync: () => set({ devSyncVisible: true }),
  hideSync: () => set({ devSyncVisible: false }),
}));
