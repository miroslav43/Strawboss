/**
 * Limbile de interfață — SURSA UNICĂ DE ADEVĂR.
 *
 * Mulțimea asta era duplicată în 17 locuri (uniuni TS, enum-uri zod, DTO-uri de
 * backend, array-uri de picker), ceea ce însemna că adăugarea unei limbi cerea
 * 17 editări coordonate și că oricare uitată eșua TĂCUT: enum-ul zod respinge
 * cu 400, uniunea TS respinge la compilare, dar un array de picker uitat pur și
 * simplu nu afișează limba și nimic nu se plânge.
 *
 * Modelat după presence.ts / features.ts — aceeași convenție de SSOT.
 *
 * NOTĂ: coloana `users.locale` e TEXT fără CHECK. Gardul de runtime e enum-ul
 * zod construit din `SUPPORTED_LOCALES`, nu baza de date. Asta e deliberat —
 * un CHECK ar eșua cu 23514 → 500 în loc de 400 curat și ar transforma orice
 * limbă viitoare în migrație.
 */

/** Fiecare limbă în care aplicația poate fi afișată. Ordinea e cea din pickere. */
export const SUPPORTED_LOCALES = ['ro', 'en', 'hu'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Limba dată unui cont când nimeni n-a ales alta.
 *
 * `ro`, nu `en`: e limba operațională vie (38 din 44 de conturi de producție)
 * și e deja ce presupune aplicația mobilă. DEFAULT-ul coloanei din baza de date
 * spune 'en', dar niciun cont nu-l atinge vreodată — admin-users.service.ts
 * scria hardcodat 'ro' peste el.
 */
export const DEFAULT_LOCALE: Locale = 'ro';

/** Numele fiecărei limbi ÎN LIMBA EI (endonim) — pentru pickere. */
export const LOCALE_ENDONYMS: Record<Locale, string> = {
  ro: 'Română',
  en: 'English',
  hu: 'Magyar',
};

/**
 * Eticheta BCP-47 folosită pentru formatarea datelor și numerelor.
 * Separată de `Locale` fiindcă Intl vrea o etichetă completă, nu un cod de doi.
 */
export const LOCALE_BCP47: Record<Locale, string> = {
  ro: 'ro-RO',
  en: 'en-GB',
  hu: 'hu-HU',
};

/** Gardă de tip pentru orice string venit din DB, localStorage sau rețea. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Normalizează orice string de limbă la una suportată.
 *
 * Acceptă etichete complete ('hu-HU', 'ro-RO') și e insensibilă la majuscule.
 * Orice necunoscut cade pe DEFAULT_LOCALE.
 *
 * ATENȚIE: extinderea `SUPPORTED_LOCALES` face funcția asta corectă automat.
 * Orice normalizator scris de mână care testează prefixe una câte una NU se
 * actualizează singur — exact așa a fost pierdută maghiara pe telefoane.
 */
export function normalizeLocale(raw: string | null | undefined): Locale {
  if (!raw) return DEFAULT_LOCALE;
  const lower = raw.toLowerCase();
  return SUPPORTED_LOCALES.find((l) => lower.startsWith(l)) ?? DEFAULT_LOCALE;
}
