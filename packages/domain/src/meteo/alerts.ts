import type { MeteoAlertSeverity, MeteoAlertType } from '@strawboss/types';
import type { AgroHour } from './agro.js';
import { STORM } from './agro.js';
import { HOUR_MS, round } from './units.js';

/** Org-configurable thresholds (meteo_org_settings.alert_*). */
export interface AlertThresholds {
  frostC: number;
  heatC: number;
  gustMs: number;
  /** Daily rain total (local day) that triggers heavy_rain. */
  rainMm: number;
  capeJkg: number;
  lookaheadH: number;
}

export const ALERT_DEFAULTS: AlertThresholds = {
  frostC: 0,
  heatC: 32,
  gustMs: 17,
  rainMm: 25,
  capeJkg: 1000,
  lookaheadH: 36,
};

/** How far past the threshold an episode must go to be "severe". */
export const ALERT_SEVERE = {
  frostDeltaC: 3,
  heatDeltaC: 3,
  gustDeltaMs: 7,
  rainFactor: 2,
  capeFactor: 2,
} as const;

/** Exceedance hours closer than this belong to one episode. */
export const ALERT_EPISODE_GAP_H = 3;

export interface AlertCandidateCore {
  alertType: MeteoAlertType;
  severity: MeteoAlertSeverity;
  localDay: string;
  startMs: number;
  endMs: number;
  peakMs: number;
  peakValue: number;
  threshold: number;
}

const SEVERITY_RANK: Record<MeteoAlertSeverity, number> = { warning: 0, severe: 1 };

interface Rule {
  type: Exclude<MeteoAlertType, 'heavy_rain'>;
  value: (h: AgroHour) => number | null;
  exceeds: (v: number, h: AgroHour) => boolean;
  /** true when a LOWER value is worse (frost). */
  lowIsWorse: boolean;
  threshold: number;
  severe: (peak: number) => boolean;
}

/**
 * Turn the next `lookaheadH` hours into alert candidates: exceedance hours are
 * clustered into episodes (gaps ≤ ALERT_EPISODE_GAP_H), each episode belongs
 * to the LOCAL day of its peak, and one candidate is kept per (type, day) —
 * the most severe. A frost night across midnight is one alert, not two.
 * Heavy rain is a daily total per local day.
 */
export function evaluateMeteoAlerts(
  hours: readonly AgroHour[],
  nowMs: number,
  th: AlertThresholds,
  localDayOf: (ms: number) => string,
): AlertCandidateCore[] {
  const end = nowMs + th.lookaheadH * HOUR_MS;
  const win = hours.filter((h) => h.timeMs > nowMs && h.timeMs <= end).sort((a, b) => a.timeMs - b.timeMs);
  const best = new Map<string, AlertCandidateCore>();
  const keep = (c: AlertCandidateCore, lowIsWorse: boolean): void => {
    const key = `${c.alertType}|${c.localDay}`;
    const prev = best.get(key);
    const worse =
      !prev ||
      SEVERITY_RANK[c.severity] > SEVERITY_RANK[prev.severity] ||
      (SEVERITY_RANK[c.severity] === SEVERITY_RANK[prev.severity] &&
        (lowIsWorse ? c.peakValue < prev.peakValue : c.peakValue > prev.peakValue));
    if (worse) best.set(key, c);
  };

  const rules: Rule[] = [
    {
      type: 'frost',
      value: (h) => h.tempC,
      exceeds: (v) => v <= th.frostC,
      lowIsWorse: true,
      threshold: th.frostC,
      severe: (p) => p <= th.frostC - ALERT_SEVERE.frostDeltaC,
    },
    {
      type: 'heat',
      value: (h) => h.tempC,
      exceeds: (v) => v >= th.heatC,
      lowIsWorse: false,
      threshold: th.heatC,
      severe: (p) => p >= th.heatC + ALERT_SEVERE.heatDeltaC,
    },
    {
      type: 'wind',
      value: (h) => h.gustMs,
      exceeds: (v) => v >= th.gustMs,
      lowIsWorse: false,
      threshold: th.gustMs,
      severe: (p) => p >= th.gustMs + ALERT_SEVERE.gustDeltaMs,
    },
    {
      type: 'storm',
      value: (h) => h.capeJkg,
      exceeds: (v, h) => v >= th.capeJkg && h.precipProb !== null && h.precipProb >= STORM.probMin,
      lowIsWorse: false,
      threshold: th.capeJkg,
      severe: (p) => p >= th.capeJkg * ALERT_SEVERE.capeFactor,
    },
  ];

  for (const r of rules) {
    let episode: AgroHour[] = [];
    const flush = (): void => {
      if (episode.length === 0) return;
      let peak = episode[0];
      for (const h of episode) {
        const v = r.value(h) as number;
        const pv = r.value(peak) as number;
        if (r.lowIsWorse ? v < pv : v > pv) peak = h;
      }
      const peakValue = round(r.value(peak) as number, 2);
      keep(
        {
          alertType: r.type,
          severity: r.severe(peakValue) ? 'severe' : 'warning',
          localDay: localDayOf(peak.timeMs),
          startMs: episode[0].timeMs,
          endMs: episode[episode.length - 1].timeMs,
          peakMs: peak.timeMs,
          peakValue,
          threshold: r.threshold,
        },
        r.lowIsWorse,
      );
      episode = [];
    };
    for (const h of win) {
      const v = r.value(h);
      if (v === null || !r.exceeds(v, h)) continue;
      const last = episode[episode.length - 1];
      if (last && h.timeMs - last.timeMs > ALERT_EPISODE_GAP_H * HOUR_MS) flush();
      episode.push(h);
    }
    flush();
  }

  // Heavy rain: total per local day within the window.
  const byDay = new Map<string, AgroHour[]>();
  for (const h of win) {
    if (h.precipMm === null) continue;
    const d = localDayOf(h.timeMs);
    byDay.set(d, [...(byDay.get(d) ?? []), h]);
  }
  for (const [day, hs] of byDay) {
    const total = round(hs.reduce((s, h) => s + (h.precipMm as number), 0), 1);
    if (total < th.rainMm) continue;
    const wet = hs.filter((h) => (h.precipMm as number) > 0);
    const peak = wet.reduce((a, b) => ((b.precipMm as number) > (a.precipMm as number) ? b : a), wet[0]);
    keep(
      {
        alertType: 'heavy_rain',
        severity: total >= th.rainMm * ALERT_SEVERE.rainFactor ? 'severe' : 'warning',
        localDay: day,
        startMs: wet[0].timeMs,
        endMs: wet[wet.length - 1].timeMs,
        peakMs: peak.timeMs,
        peakValue: total,
        threshold: th.rainMm,
      },
      false,
    );
  }

  return [...best.values()].sort((a, b) => a.peakMs - b.peakMs);
}
