import type { Alert } from "../entities/alert.js";

export interface DashboardOverview {
  activeTrips: number;
  balesToday: number;
  activeMachines: number;
  pendingAlerts: number;
  tripsToday: number;
  tripsCompleted: number;
}

export interface ProductionReport {
  parcelId: string;
  parcelName: string;
  produced: number;
  loaded: number;
  delivered: number;
  lossPercentage: number;
}

export interface CostReport {
  entityId: string;
  entityName: string;
  entityType: "parcel" | "machine";
  fuelCost: number;
  consumableCost: number;
  totalCost: number;
}

export interface AntiFraudReport {
  flaggedTrips: number;
  odometerAnomalies: number;
  fuelAnomalies: number;
  timingAnomalies: number;
  recentAlerts: Alert[];
}
