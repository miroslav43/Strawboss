export interface DevicePushToken {
  id: string;
  userId: string;
  machineId: string | null;
  token: string;
  platform: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
