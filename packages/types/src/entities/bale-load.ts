import type { Timestamps, SoftDelete } from "../common.js";

export interface BaleLoad extends Timestamps, SoftDelete {
  id: string;
  tripId: string;
  parcelId: string;
  loaderId: string;
  operatorId: string;
  baleCount: number;
  loadedAt: string;
  gpsLat: number | null;
  gpsLon: number | null;
  farmtrackEventId: string | null;
  notes: string | null;
  clientId: string | null;
  syncVersion: number;
}
