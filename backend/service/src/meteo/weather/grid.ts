export type GridDeg = 0.02 | 0.05 | 0.25;

export interface GridCell {
  key: string;
  lat: number;
  lon: number;
}

const DECIMALS: Record<GridDeg, number> = { 0.02: 2, 0.05: 2, 0.25: 2 };

/** Snap a coordinate to the grid; the key is the cell's rounded centre. */
export function cellFor(lat: number, lon: number, gridDeg: GridDeg): GridCell {
  const snap = (v: number): number => Math.round(Math.round(v / gridDeg) * gridDeg * 10_000) / 10_000;
  const la = snap(lat);
  const lo = snap(lon);
  const d = DECIMALS[gridDeg];
  return { key: `${la.toFixed(d)},${lo.toFixed(d)}`, lat: la, lon: lo };
}

export const METEO_TZ = 'Europe/Bucharest';

const DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: METEO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const HOUR_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: METEO_TZ,
  hour: '2-digit',
  hourCycle: 'h23',
});

/** Local calendar date 'YYYY-MM-DD' of an instant (Europe/Bucharest). */
export function localDate(ms: number): string {
  return DAY_FMT.format(new Date(ms));
}
/** Alias used as the `localDayOf` callback of the alert evaluator. */
export const localDayOf = localDate;

/** Local hour of day 0..23 (Europe/Bucharest). */
export function localHour(ms: number): number {
  return Number(HOUR_FMT.format(new Date(ms)));
}
