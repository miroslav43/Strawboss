import { create } from 'zustand';

interface AuthProfile {
  role: string;
  userId: string;
  assignedMachineId: string | null;
}

interface AuthStore {
  role: string | null;
  userId: string | null;
  assignedMachineId: string | null;
  setProfile: (profile: AuthProfile) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthStore>()((set) => ({
  role: null,
  userId: null,
  assignedMachineId: null,
  setProfile: (profile) =>
    set({
      role: profile.role,
      userId: profile.userId,
      assignedMachineId: profile.assignedMachineId,
    }),
  clear: () => set({ role: null, userId: null, assignedMachineId: null }),
}));
