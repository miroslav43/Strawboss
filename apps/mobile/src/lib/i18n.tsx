import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { normalizeLocale as normalizeSupported, LOCALE_BCP47, type Locale } from '@strawboss/types';
import { ro } from '@/i18n/ro';
import { en } from '@/i18n/en';
import { hu } from '@/i18n/hu';
import { useAuthStore } from '@/stores/auth-store';

export { ro, en, hu };
export type { Locale };

// Record<Locale, …>: adding a language to the SSOT breaks this compilation
// until its catalog actually exists.
const catalogs: Record<Locale, Record<string, unknown>> = {
  ro: ro as unknown as Record<string, unknown>,
  en: en as unknown as Record<string, unknown>,
  hu: hu as unknown as Record<string, unknown>,
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

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  // The catalogs use two placeholder conventions. Support both:
  //  1. Double-brace {{param}} — replaced with the value, or '' when missing
  //     (legacy behaviour, kept for the strings already written this way).
  //  2. Single-brace {param}   — replaced with the value; left untouched when
  //     there is no matching param, so a genuine mismatch stays visible and
  //     stray literal braces are never clobbered.
  // Double-brace runs first so {{param}} is fully consumed before the single
  // pass sees it.
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (params[k] != null ? String(params[k]) : ''))
    .replace(/\{(\w+)\}/g, (match, k) => (params[k] != null ? String(params[k]) : match));
}

/**
 * Maps the locale stored on the account to a supported locale.
 *
 * Delegates to the SSOT in @strawboss/types. The old version tested a single
 * prefix and sent everything else to Romanian — any locale added to the DB
 * was silently collapsed, with no crash, no warning, no type error.
 */
export function normalizeLocale(raw: string | null | undefined): Locale {
  return normalizeSupported(raw);
}

/**
 * Eticheta BCP-47 pentru apelurile toLocale*.
 *
 * Mobile-ul n-avea NICIO ramificare pe limbă — toate cele cinci formatoare erau
 * necondiționat 'ro-RO', deci și utilizatorii englezi primeau date românești.
 * Cine caută tiparul de ternar din admin-web va concluziona că mobile-ul e curat
 * și va rata toate cele cinci locuri.
 */
export function dateLocaleFor(locale: Locale): string {
  return LOCALE_BCP47[locale];
}

type I18nContextValue = {
  locale: Locale;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const storeLocale = useAuthStore((s) => s.locale);
  const locale = normalizeLocale(storeLocale);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      let raw = getByPath(catalogs[locale], key);
      // Fall back to ENGLISH, not Romanian: a missing key must surface in an
      // international language, not the local one. Matters for push
      // notifications too, which go through tStatic from the headless task.
      if (typeof raw !== 'string' && locale !== 'en') {
        raw = getByPath(catalogs.en, key);
      }
      if (typeof raw !== 'string') {
        raw = getByPath(catalogs.ro, key);
      }
      if (typeof raw !== 'string') {
        if (__DEV__) console.warn('[i18n] Missing key:', key);
        return key;
      }
      return interpolate(raw, params);
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, t }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within LocaleProvider');
  return ctx;
}

export function useI18nOptional(): I18nContextValue | null {
  return useContext(I18nContext);
}

/**
 * Translate outside of React context (background tasks, pre-provider screens).
 * Reads locale directly from the Zustand auth store.
 */
export function tStatic(key: string, params?: Record<string, string | number>): string {
  const storeLocale = useAuthStore.getState().locale;
  const locale = normalizeLocale(storeLocale);
  let raw = getByPath(catalogs[locale], key);
  // Same cascade as t(): ENGLISH first, Romanian last. This feeds background
  // push notifications from the headless sync task, so getting it wrong puts
  // Romanian text in a Hungarian user's notification shade.
  if (typeof raw !== 'string' && locale !== 'en') raw = getByPath(catalogs.en, key);
  if (typeof raw !== 'string') raw = getByPath(catalogs.ro, key);
  if (typeof raw !== 'string') {
    if (__DEV__) console.warn('[i18n] Missing key (static):', key);
    return key;
  }
  return interpolate(raw, params);
}
