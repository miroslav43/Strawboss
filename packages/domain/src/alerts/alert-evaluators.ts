import type { AlertCategory, AlertSeverity } from "@strawboss/types";
import type { OdometerGpsResult } from "../fraud-detection/odometer-gps.js";
import type { FuelAnomalyResult } from "../fraud-detection/fuel-anomaly.js";
import type { TimingAnomalyResult } from "../fraud-detection/timing-anomaly.js";
import type { BaleReconciliationResult } from "../reconciliation/bale-reconciliation.js";

export interface AlertInput {
  odometerGps?: OdometerGpsResult;
  fuelAnomaly?: FuelAnomalyResult;
  timingAnomaly?: TimingAnomalyResult;
  baleReconciliation?: BaleReconciliationResult;
  tripId?: string;
  machineId?: string;
}

export interface AlertDraft {
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  description: string;
  tripId: string | null;
  machineId: string | null;
  data: Record<string, unknown>;
}

function getSeverityFromDiscrepancy(percent: number): AlertSeverity {
  if (percent > 50) return "critical" as AlertSeverity;
  if (percent > 30) return "high" as AlertSeverity;
  if (percent > 15) return "medium" as AlertSeverity;
  return "low" as AlertSeverity;
}

export function evaluateAlerts(input: AlertInput): AlertDraft[] {
  const alerts: AlertDraft[] = [];
  const tripId = input.tripId ?? null;
  const machineId = input.machineId ?? null;

  // Odometer vs GPS discrepancy alert
  if (input.odometerGps?.isSuspicious) {
    const result = input.odometerGps;
    alerts.push({
      category: "fraud" as AlertCategory,
      severity: getSeverityFromDiscrepancy(result.discrepancyPercent),
      title: "Odometer-GPS distance discrepancy",
      description:
        `Odometer distance (${result.odometerDistanceKm.toFixed(1)} km) differs from ` +
        `GPS distance (${result.gpsDistanceKm.toFixed(1)} km) by ` +
        `${result.discrepancyPercent.toFixed(1)}%.`,
      tripId,
      machineId,
      data: {
        odometerDistanceKm: result.odometerDistanceKm,
        gpsDistanceKm: result.gpsDistanceKm,
        discrepancyKm: result.discrepancyKm,
        discrepancyPercent: result.discrepancyPercent,
      },
    });
  }

  // Fuel anomaly alert
  if (input.fuelAnomaly?.isAnomaly) {
    const result = input.fuelAnomaly;
    const severity: AlertSeverity =
      result.zScore > 4
        ? ("critical" as AlertSeverity)
        : result.zScore > 3
          ? ("high" as AlertSeverity)
          : ("medium" as AlertSeverity);

    alerts.push({
      category: "anomaly" as AlertCategory,
      severity,
      title: "Fuel consumption anomaly detected",
      description:
        `Current fuel consumption reading deviates from the mean by ` +
        `${result.zScore.toFixed(2)} standard deviations ` +
        `(mean: ${result.mean.toFixed(2)}, stdDev: ${result.stdDev.toFixed(2)}).`,
      tripId,
      machineId,
      data: {
        mean: result.mean,
        stdDev: result.stdDev,
        zScore: result.zScore,
      },
    });
  }

  // Timing anomaly alert
  if (input.timingAnomaly?.isSuspicious) {
    const result = input.timingAnomaly;
    const category: AlertCategory = result.isTooFast
      ? ("fraud" as AlertCategory)
      : ("anomaly" as AlertCategory);
    const severity: AlertSeverity = result.isTooFast
      ? ("high" as AlertSeverity)
      : ("medium" as AlertSeverity);
    const issue = result.isTooFast ? "impossibly fast" : "suspiciously slow";

    alerts.push({
      category,
      severity,
      title: `Trip timing anomaly: ${issue}`,
      description:
        `Average speed of ${result.avgSpeedKmh.toFixed(1)} km/h is ${issue}.`,
      tripId,
      machineId,
      data: {
        avgSpeedKmh: result.avgSpeedKmh,
        isTooFast: result.isTooFast,
        isTooSlow: result.isTooSlow,
      },
    });
  }

  // Bale reconciliation discrepancy alert
  if (input.baleReconciliation?.hasDiscrepancy) {
    const result = input.baleReconciliation;
    const severity: AlertSeverity =
      Math.abs(result.lossPercentage) > 10
        ? ("high" as AlertSeverity)
        : ("medium" as AlertSeverity);

    alerts.push({
      category: "anomaly" as AlertCategory,
      severity,
      title: "Bale count discrepancy",
      description:
        `Parcel ${result.parcelId}: produced ${result.produced}, ` +
        `loaded ${result.loaded}, delivered ${result.delivered}. ` +
        `Loss: ${result.lossPercentage.toFixed(1)}%.`,
      tripId,
      machineId,
      data: {
        parcelId: result.parcelId,
        produced: result.produced,
        loaded: result.loaded,
        delivered: result.delivered,
        loadedVsProducedDiff: result.loadedVsProducedDiff,
        deliveredVsLoadedDiff: result.deliveredVsLoadedDiff,
        lossPercentage: result.lossPercentage,
      },
    });
  }

  return alerts;
}
