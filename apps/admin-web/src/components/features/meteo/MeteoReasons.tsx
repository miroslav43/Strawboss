'use client';

import type { MeteoReason } from '@strawboss/types';
import { useMeteoFormat } from './format';

/** Reasons as a bullet list; `main` renders the first one as the headline sentence. */
export function MeteoReasons({ reasons, main = false }: { reasons: MeteoReason[]; main?: boolean }) {
  const { reasonText } = useMeteoFormat();
  if (reasons.length === 0) return null;
  if (main) {
    return (
      <div>
        <p className="text-base font-medium text-neutral-900">{reasonText(reasons[0])}</p>
        {reasons.length > 1 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-neutral-600">
            {reasons.slice(1).map((r, i) => (
              <li key={`${r.key}-${i}`}>{reasonText(r)}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm text-neutral-600">
      {reasons.map((r, i) => (
        <li key={`${r.key}-${i}`}>{reasonText(r)}</li>
      ))}
    </ul>
  );
}
