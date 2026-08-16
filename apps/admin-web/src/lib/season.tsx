'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSeasonContext } from '@strawboss/api';
import { currentSeasonYear, seasonBounds } from '@strawboss/types';
import { apiClient } from '@/lib/api';

/**
 * How long GPS positions survive.
 *
 * `gps-retention.processor.ts` hard-deletes `machine_location_events` older
 * than this. It is the one place where "seasons delete nothing" is not true,
 * and the UI has to say so: a km report for a closed season does not read
 * "incomplete", it reads a confident, wrong ZERO.
 */
export const GPS_RETENTION_DAYS = 90;

interface SeasonState {
  /** False until the season context has loaded; render defaults meanwhile. */
  ready: boolean;
  /** The organization's current season. */
  activeYear: number;
  /** The season the user is looking at — `activeYear` unless they picked another. */
  selectedYear: number;
  /** Every year offered in the picker, newest first. */
  availableYears: number[];
  /** Years that are frozen against writes. */
  closedYears: number[];
  isActiveSeason: boolean;
  /** The selected season as the `dateFrom`/`dateTo` pair every report speaks. */
  window: { dateFrom: string; dateTo: string };
  /** Whether GPS-derived figures can exist for the selected season at all. */
  gpsAvailable: boolean;
  setSelectedYear: (year: number) => void;
}

const SeasonCtx = createContext<SeasonState | null>(null);

/**
 * Season context for the whole dashboard.
 *
 * The selected year lives in the URL (`?season=2026`) rather than in state, so
 * a link someone pastes into a message is unambiguous about which year its
 * numbers came from. That matters more here than anywhere else in the product:
 * two seasons render identically apart from the figures.
 */
export function SeasonProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, isLoading } = useSeasonContext(apiClient);

  const activeYear = data?.activeSeasonYear ?? currentSeasonYear();
  const availableYears = data?.availableYears ?? [activeYear];
  const closedYears = useMemo(() => data?.closedYears ?? [], [data]);

  const requested = Number(searchParams.get('season'));
  const selectedYear =
    Number.isInteger(requested) && availableYears.includes(requested) ? requested : activeYear;

  const setSelectedYear = useCallback(
    (year: number) => {
      const next = new URLSearchParams(searchParams.toString());
      // The active season is the default, so it carries no parameter — that
      // keeps the everyday URL clean and makes "am I on a past season?" a
      // question you can answer by looking at the address bar.
      if (year === activeYear) next.delete('season');
      else next.set('season', String(year));
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [activeYear, pathname, router, searchParams],
  );

  const value = useMemo<SeasonState>(() => {
    const { startDate } = seasonBounds(selectedYear);
    const seasonEnd = new Date(`${selectedYear}-12-31T00:00:00Z`).getTime();
    const retentionFloor = Date.now() - GPS_RETENTION_DAYS * 86_400_000;
    return {
      ready: !isLoading && !!data,
      activeYear,
      selectedYear,
      availableYears,
      closedYears,
      isActiveSeason: selectedYear === activeYear,
      window: { dateFrom: startDate, dateTo: `${selectedYear}-12-31` },
      gpsAvailable: seasonEnd >= retentionFloor,
      setSelectedYear,
    };
  }, [activeYear, availableYears, closedYears, data, isLoading, selectedYear, setSelectedYear]);

  return <SeasonCtx.Provider value={value}>{children}</SeasonCtx.Provider>;
}

/**
 * The selected season.
 *
 * Falls back to a sane all-defaults object outside the provider rather than
 * throwing, so a component rendered in isolation (a test, a super-admin page
 * that has no organization) still works instead of crashing the tree.
 */
export function useSeason(): SeasonState {
  const ctx = useContext(SeasonCtx);
  if (ctx) return ctx;
  const year = currentSeasonYear();
  return {
    ready: false,
    activeYear: year,
    selectedYear: year,
    availableYears: [year],
    closedYears: [],
    isActiveSeason: true,
    window: { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` },
    gpsAvailable: true,
    setSelectedYear: () => {},
  };
}

/**
 * The `season` query parameter to send with a request, or nothing.
 *
 * Returns `{}` for the active season on purpose. Omitting the parameter lets
 * the backend resolve it — including the case where the organization has never
 * closed a season and must not be filtered at all. Sending the current year
 * explicitly would filter an org that should not be, which is exactly the
 * failure the backend's resolveYear was written to avoid.
 */
export function useSeasonParam(): { season?: string } {
  const { selectedYear, isActiveSeason } = useSeason();
  return isActiveSeason ? {} : { season: String(selectedYear) };
}
