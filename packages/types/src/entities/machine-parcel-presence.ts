export interface MachineParcelPresence {
  machineId: string;
  parcelId: string | null;
  enteredAt: string | null;
  updatedAt: string;
}
