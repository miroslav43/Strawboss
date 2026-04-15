'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import enMessages from '../../messages/en.json';
import roMessages from '../../messages/ro.json';
import { clientLogger } from '@/lib/client-logger';

export type Locale = 'en' | 'ro';

const STORAGE_KEY = 'strawboss-locale';

const catalogs: Record<Locale, Record<string, unknown>> = {
  en: enMessages as Record<string, unknown>,
  ro: roMessages as Record<string, unknown>,
};

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Map DB/user locale string to supported UI locale. */
export function normalizeUiLocale(raw: string | null | undefined): Locale {
  if (!raw) return 'en';
  const lower = raw.toLowerCase();
  if (lower.startsWith('ro')) return 'ro';
  return 'en';
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    params[k] != null ? String(params[k]) : '',
  );
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (next: Locale, options?: { persist?: boolean }) => void;
  /** Apply profile locale only when user has not chosen one in this browser (no localStorage). */
  hydrateFromProfile: (profileLocale: string | null | undefined) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  const s = localStorage.getItem(STORAGE_KEY);
  return s === 'en' || s === 'ro' ? s : null;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale() ?? 'en');

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      let raw = getByPath(catalogs[locale] as Record<string, unknown>, key);
      if (typeof raw !== 'string') {
        raw = getByPath(catalogs.en as Record<string, unknown>, key);
      }
      if (typeof raw !== 'string') {
        if (process.env.NODE_ENV === 'development') {
          clientLogger.warn(`[i18n] Missing key: ${key}`, { locale, key });
        }
        return key;
      }
      return interpolate(raw, params);
    },
    [locale],
  );

  const setLocale = useCallback((next: Locale, options?: { persist?: boolean }) => {
    setLocaleState(next);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next;
    }
    const persist = options?.persist !== false;
    if (persist && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const hydrateFromProfile = useCallback((profileLocale: string | null | undefined) => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(STORAGE_KEY)) return;
    const next = normalizeUiLocale(profileLocale ?? undefined);
    setLocaleState(next);
    document.documentElement.lang = next;
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, hydrateFromProfile, t }),
    [locale, setLocale, hydrateFromProfile, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within LocaleProvider');
  }
  return ctx;
}

/** Safe for components that may render outside LocaleProvider (e.g. tests). */
export function useI18nOptional(): I18nContextValue | null {
  return useContext(I18nContext);
}
