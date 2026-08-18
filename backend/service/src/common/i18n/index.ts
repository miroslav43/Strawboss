import { DEFAULT_LOCALE, normalizeLocale, type Locale } from '@strawboss/types';
import { en } from './catalogs/en';
import { ro } from './catalogs/ro';
import { hu } from './catalogs/hu';

// `ro`/`hu` are typed `CatalogShape<typeof en>` (see catalogs/ro.ts's
// comment) — every leaf widened to plain `string` so a translated value
// isn't rejected by `en`'s `as const` literal narrowing. That means `typeof
// en` itself is the WRONG type for this record: `en`'s literal leaves (e.g.
// `"field"`) are narrower than `ro`/`hu`'s widened `string` leaves, so typing
// this map as `Record<Locale, typeof en>` rejects `ro`/`hu` on assignment
// (every leaf: "Type 'string' is not assignable to type '\"field\"'").
// `typeof ro` is the widened shape already, and `en`'s narrower literals are
// themselves valid `string`s, so it accepts all three.
export type ServerCatalog = typeof ro;

const catalogs: Record<Locale, ServerCatalog> = { en, ro, hu };

/**
 * Translate a server-generated string (push, email, SMS, PDF label).
 *
 * The backend had no i18n at all — every string was a literal at its emit
 * site, so the recipient's language had nowhere to enter. This is the only
 * rendering point.
 *
 * Falls back `locale → DEFAULT_LOCALE → en`, and returns the raw `key` if
 * nothing resolves — a missing key is visible in the push/log, never blank.
 */
export function tServer(
  locale: string | null | undefined,
  key: string,
  params?: Record<string, string | number>,
): string {
  const loc = normalizeLocale(locale);
  const raw =
    getByPath(catalogs[loc], key) ??
    getByPath(catalogs[DEFAULT_LOCALE], key) ??
    getByPath(catalogs.en, key);
  if (typeof raw !== 'string') return key;
  return params
    ? raw.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m))
    : raw;
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, p) => {
    if (cur == null || typeof cur !== 'object') return undefined;
    return (cur as Record<string, unknown>)[p];
  }, obj);
}
