'use client';

import { AuxStage } from '@strawboss/types';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

/**
 * Colour carries meaning here, so it is not decorative:
 *   amber   = the dispatcher owes an action (confirm it, schedule it)
 *   blue    = in motion, nothing to do
 *   violet  = waiting on the EXTERNAL driver's arrival CMR — chasing it is a real job
 *   emerald = done
 *   neutral = cancelled
 */
const stageStyles: Record<AuxStage, string> = {
  [AuxStage.pending]: 'bg-amber-100 text-amber-800',
  [AuxStage.unplanned]: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  [AuxStage.planned]: 'bg-neutral-100 text-neutral-700',
  [AuxStage.loading]: 'bg-blue-100 text-blue-800',
  [AuxStage.awaitingArrivalCmr]: 'bg-violet-100 text-violet-800',
  [AuxStage.completed]: 'bg-emerald-100 text-emerald-800',
  [AuxStage.cancelled]: 'bg-neutral-100 text-neutral-500',
};

export function AuxStageBadge({ stage, className }: { stage: AuxStage; className?: string }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        stageStyles[stage],
        className,
      )}
    >
      {t(`tripRequests.stage.${stage}`)}
    </span>
  );
}
