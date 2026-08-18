'use client';

import { useMemo } from 'react';
import { LOCALE_BCP47 } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { ROMANIA_TZ } from '@/lib/date';

/**
 * Formatare de dată și număr conștientă de limbă.
 *
 * Înlocuiește șase ternare `locale === 'ro' ? 'ro-RO' : 'en-US'` împrăștiate prin
 * aplicație. Ternarele alea aveau exact două ramuri, deci a treia limbă cădea
 * tăcut pe formatul american — dată MM/DD/YYYY și grupare 1,234.56 într-o
 * interfață altfel maghiară. Un al treilea braț în șase locuri ar fi doar amânat
 * problema; asta o închide.
 *
 * Fusul rămâne Europe/Bucharest: limba interfeței nu mută operațiunea.
 */
export function useLocaleFormat() {
  const { locale } = useI18n();

  return useMemo(() => {
    const tag = LOCALE_BCP47[locale];
    return {
      /** Eticheta BCP-47 brută, pentru apelurile toLocale* care nu pot folosi un Intl gata făcut. */
      tag,
      date: new Intl.DateTimeFormat(tag, {
        timeZone: ROMANIA_TZ,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      dateTime: new Intl.DateTimeFormat(tag, {
        timeZone: ROMANIA_TZ,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      time: new Intl.DateTimeFormat(tag, {
        timeZone: ROMANIA_TZ,
        hour: '2-digit',
        minute: '2-digit',
      }),
      number: new Intl.NumberFormat(tag),
      /** Comparator de sortare — maghiara are digrafe (cs, dz, gy, ly, ny, sz, ty, zs) și ő/ű. */
      compare: new Intl.Collator(tag, { sensitivity: 'base' }).compare,
    };
  }, [locale]);
}
