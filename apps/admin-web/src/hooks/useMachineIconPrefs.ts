'use client';

import { useState, useEffect, useCallback } from 'react';
import type { IconVariant } from '@/components/map/machine-icons';

/** Per-machine icon variant map: machineId → variant (0 | 1 | 2). */
export type IconPrefs = Record<string, IconVariant>;

const LS_KEY = 'strawboss:machineIconPrefs';
const VALID_VARIANTS: IconVariant[] = [0, 1, 2];

function readFromStorage(): IconPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    // Strip invalid values so the shape stays clean
    const clean: IconPrefs = {};
    for (const [id, v] of Object.entries(parsed)) {
      if (VALID_VARIANTS.includes(v as IconVariant)) {
        clean[id] = v as IconVariant;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

/**
 * Persists per-individual-machine icon variant selection in localStorage.
 * Uses useState({}) + useEffect to avoid SSR hydration mismatch.
 */
export function useMachineIconPrefs() {
  const [prefs, setPrefs] = useState<IconPrefs>({});

  useEffect(() => {
    setPrefs(readFromStorage());
  }, []);

  /** Set the icon variant for a specific machine by its ID. */
  const setVariant = useCallback((machineId: string, variant: IconVariant) => {
    setPrefs((prev) => {
      const next = { ...prev, [machineId]: variant };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        // Ignore quota errors — preference is ephemeral in that case
      }
      return next;
    });
  }, []);

  /** Get the currently selected variant for a machine (defaults to 0). */
  const getVariant = useCallback(
    (machineId: string): IconVariant => prefs[machineId] ?? 0,
    [prefs],
  );

  return { prefs, setVariant, getVariant };
}
