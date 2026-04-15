export interface ParcelDailyStatus {
  id: string;
  parcelId: string;
  statusDate: string;
  isDone: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
