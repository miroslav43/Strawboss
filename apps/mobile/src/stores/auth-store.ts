import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

interface AuthProfile {
  role: string;
  userId: string;
  assignedMachineId: string | null;
  signatureSpecimenUrl: string | null;
}

interface AuthStore {
  role: string | null;
  userId: string | null;
  assignedMachineId: string | null;
  signatureSpecimenUrl: string | null;
  setProfile: (profile: AuthProfile) => void;
  setSignatureSpecimenUrl: (url: string | null) => void;
  clear: () => void;
}

/**
 * Zustand StateStorage adapter backed by expo-secure-store.
 *
 * expo-secure-store enforces a 2 048-byte limit per value on some platforms.
 * The persisted payload is a small JSON object (role + two UUIDs), well under
 * that limit. We do NOT store Supabase session tokens here — those are managed
 * by the Supabase SDK's own secure storage.
 */
const secureStoreStorage = createJSONStorage<PersistedAuthState>(() => ({
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => {
    void SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string) => {
    void SecureStore.deleteItemAsync(key);
  },
}));

/** Only these fields are persisted across app restarts. */
interface PersistedAuthState {
  userId: string | null;
  role: string | null;
  assignedMachineId: string | null;
  signatureSpecimenUrl: string | null;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      role: null,
      userId: null,
      assignedMachineId: null,
      signatureSpecimenUrl: null,
      setProfile: (profile) =>
        set({
          role: profile.role,
          userId: profile.userId,
          assignedMachineId: profile.assignedMachineId,
          signatureSpecimenUrl: profile.signatureSpecimenUrl,
        }),
      setSignatureSpecimenUrl: (url) => set({ signatureSpecimenUrl: url }),
      clear: () => {
        set({
          role: null,
          userId: null,
          assignedMachineId: null,
          signatureSpecimenUrl: null,
        });
        // Also wipe the persisted storage entry so the next cold boot does
        // not rehydrate a stale session for a different user.
        useAuthStore.persist.clearStorage();
      },
    }),
    {
      name: 'strawboss-auth',
      storage: secureStoreStorage,
      // Persist only identity fields — never tokens or derived UI state.
      partialize: (state): PersistedAuthState => ({
        userId: state.userId,
        role: state.role,
        assignedMachineId: state.assignedMachineId,
        signatureSpecimenUrl: state.signatureSpecimenUrl,
      }),
      version: 2,
    },
  ),
);
