import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** `area_hectares` from the API may be a number or string (PG numeric JSON). */
export function formatAreaHectares(ha: unknown): string {
  if (ha == null || ha === '') return '?';
  const n = typeof ha === 'number' ? ha : Number(ha);
  return Number.isFinite(n) ? n.toFixed(1) : '?';
}
