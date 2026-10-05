/** Wet basis (what a moisture meter shows) ↔ dry basis (what the model uses). */
export function wbToDb(wb: number): number {
  if (!(wb >= 0 && wb < 1)) throw new RangeError(`wet-basis moisture out of range: ${wb}`);
  return wb / (1 - wb);
}

export function dbToWb(db: number): number {
  if (!(db >= 0)) throw new RangeError(`dry-basis moisture out of range: ${db}`);
  return db / (1 + db);
}

export const HOUR_MS = 3_600_000;

/** Floor a timestamp (ms) to the start of its UTC hour. */
export function floorHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

export function isoHour(ms: number): string {
  return new Date(ms).toISOString();
}

/** Linear-interpolation quantile (R type 7) of a non-empty numeric array. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new RangeError('quantile of an empty array');
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
