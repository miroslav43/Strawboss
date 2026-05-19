import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

interface ThemeStore {
  /** When true, the high-contrast (bright sunlight) palette is active. */
  highContrast: boolean;
  setHighContrast: (value: boolean) => void;
  toggleHighContrast: () => void;
}

/**
 * Zustand StateStorage adapter backed by expo-secure-store.
 * Stores only a single boolean, well within the 2 048-byte SecureStore limit.
 */
const secureStoreStorage = createJSONStorage<{ highContrast: boolean }>(() => ({
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => {
    void SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string) => {
    void SecureStore.deleteItemAsync(key);
  },
}));

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      highContrast: false,
      setHighContrast: (value) => set({ highContrast: value }),
      toggleHighContrast: () => set((s) => ({ highContrast: !s.highContrast })),
    }),
    {
      name: 'strawboss-theme',
      storage: secureStoreStorage,
      partialize: (state) => ({ highContrast: state.highContrast }),
      version: 1,
    },
  ),
);
