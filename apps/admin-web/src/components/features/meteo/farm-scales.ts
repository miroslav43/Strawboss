import type { MeteoFarmLayer, MeteoRiskLevel } from '@strawboss/types';

/** One colour step of a continuous scale: applies from `min` (inclusive) upward. */
export interface ScaleBin {
  min: number;
  color: string;
  /** Legend text (numbers + unit symbol only, so it needs no translation). */
  label: string;
}

/** Rain over the next 24 h, mm. */
const RAIN: ScaleBin[] = [
  { min: -Infinity, color: '#e5e7eb', label: '0' },
  { min: 0.1, color: '#bfdbfe', label: '0.1–1' },
  { min: 1, color: '#93c5fd', label: '1–5' },
  { min: 5, color: '#3b82f6', label: '5–10' },
  { min: 10, color: '#1d4ed8', label: '10–20' },
  { min: 20, color: '#6d28d9', label: '20–30' },
  { min: 30, color: '#4c1d95', label: '30+' },
];

/** Air temperature now, °C — diverging blue → red. */
const TEMP: ScaleBin[] = [
  { min: -Infinity, color: '#1e40af', label: '≤ 0' },
  { min: 0.01, color: '#3b82f6', label: '0–5' },
  { min: 5, color: '#67e8f9', label: '5–10' },
  { min: 10, color: '#bef264', label: '10–15' },
  { min: 15, color: '#fde047', label: '15–20' },
  { min: 20, color: '#fb923c', label: '20–25' },
  { min: 25, color: '#f97316', label: '25–30' },
  { min: 30, color: '#dc2626', label: '30–35' },
  { min: 35, color: '#7f1d1d', label: '35+' },
];

/** Strongest gust over the next 24 h, m/s. */
const GUST: ScaleBin[] = [
  { min: -Infinity, color: '#d1fae5', label: '0–8' },
  { min: 8, color: '#fde68a', label: '8–12' },
  { min: 12, color: '#fb923c', label: '12–17' },
  { min: 17, color: '#dc2626', label: '17–24' },
  { min: 24, color: '#7f1d1d', label: '24+' },
];

export const SCALES: Record<'rain24h' | 'tempNow' | 'gust24h', ScaleBin[]> = {
  rain24h: RAIN,
  tempNow: TEMP,
  gust24h: GUST,
};

/** Unit shown next to a layer's value. */
export const LAYER_UNIT: Record<'rain24h' | 'tempNow' | 'gust24h', string> = {
  rain24h: 'mm',
  tempNow: '°C',
  gust24h: 'm/s',
};

export const RISK_COLORS: Record<MeteoRiskLevel, string> = {
  none: '#86efac',
  low: '#fde047',
  moderate: '#fb923c',
  high: '#dc2626',
};
export const RISK_ORDER: MeteoRiskLevel[] = ['none', 'low', 'moderate', 'high'];

export const NO_DATA_COLOR = '#9ca3af';

export function scaleColor(layer: keyof typeof SCALES, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA_COLOR;
  const bins = SCALES[layer];
  let color = bins[0].color;
  for (const b of bins) if (value >= b.min) color = b.color;
  return color;
}

export const FARM_LAYERS: MeteoFarmLayer[] = ['rain24h', 'tempNow', 'gust24h', 'frost', 'storm', 'drying'];
