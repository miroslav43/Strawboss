import type { Timestamps, SoftDelete } from "../common.js";

export enum UserRole {
  admin = "admin",
  dispatcher = "dispatcher",
  baler_operator = "baler_operator",
  loader_operator = "loader_operator",
  driver = "driver",
}

export interface User extends Timestamps, SoftDelete {
  id: string;
  email: string;
  username: string | null;
  pin: string | null;
  phone: string | null;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  locale: string;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  assignedMachineId: string | null;
}
