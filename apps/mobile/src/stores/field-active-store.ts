import { create } from 'zustand';

/**
 * FM-7: Session-only store for the "Câmp activ" mode on the baler production screen.
 *
 * When `fieldActive` is true:
 *  - The screen is kept awake via expo-keep-awake.
 *  - A minimal layout is shown: numpad + save button + daily counter.
 *  - Decorative / secondary elements are hidden.
 *
 * State is NOT persisted — it resets on cold start, so the operator must
 * consciously re-enable it each session. This prevents the screen from being
 * stuck in minimal mode after a force-close.
 */
interface FieldActiveStore {
  fieldActive: boolean;
  enableFieldActive: () => void;
  disableFieldActive: () => void;
}

export const useFieldActiveStore = create<FieldActiveStore>()((set) => ({
  fieldActive: false,
  enableFieldActive: () => set({ fieldActive: true }),
  disableFieldActive: () => set({ fieldActive: false }),
}));
