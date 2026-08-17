'use client';

import { SUPPORTED_LOCALES, type Locale } from '@strawboss/types';

/**
 * Language toggle for the unauthenticated public entry points (login,
 * request portals). Used to exist as three byte-identical copies, each with
 * its own hardcoded two-locale tuple of ro/en — three independent places
 * where a new locale could be forgotten. Driven by SUPPORTED_LOCALES so it
 * never needs touching again.
 */
export function LangToggle({ locale, onPick }: { locale: Locale; onPick: (l: Locale) => void }) {
  return (
    <div className="inline-flex items-center rounded-full border border-stone-200 bg-white/80 p-0.5 text-xs font-semibold shadow-sm backdrop-blur">
      {SUPPORTED_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onPick(l)}
          aria-pressed={locale === l}
          className={`rounded-full px-3 py-1 uppercase tracking-wide transition-colors ${
            locale === l ? 'bg-primary text-white' : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
