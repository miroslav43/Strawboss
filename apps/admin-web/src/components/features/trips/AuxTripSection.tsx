'use client';

import { useState, useMemo, useCallback } from 'react';
import { Loader2, Inbox } from 'lucide-react';
import { useTripRequests } from '@strawboss/api';
import type { TripRequest } from '@strawboss/types';
import { AuxStage, ACTIVE_AUX_STAGES, AUX_STAGE_ORDER, RequestStatus } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { buildAuxRows } from '@/lib/aux-rows';
import { SectionHeader } from '@/components/shared/SectionHeader';
import { AuxTripTable } from './AuxTripTable';
import { AuxIntakeCard } from '@/components/features/trip-requests/AuxIntakeCard';
import { ConfirmRequestModal } from '@/components/features/trip-requests/ConfirmRequestModal';
import { CancelRequestModal } from '@/components/features/trip-requests/CancelRequestModal';
import { RequestDetailsModal } from '@/components/features/trip-requests/RequestDetailsModal';
import { AvizUploadModal } from '@/components/features/trip-requests/AvizUploadModal';
import { CmrUploadModal } from '@/components/features/trip-requests/CmrUploadModal';

const selectCls =
  'rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/** Sentinel for the "only live work" default view. */
const ACTIVE = '__active__';

/** Stages a TABLE row can actually have — pending lives in the intake strip. */
const STAGE_OPTIONS = AUX_STAGE_ORDER.filter((s) => s !== AuxStage.pending);

interface AuxTripSectionProps {
  /** Shared with the fleet table. Applied server-side. */
  search: string;
  dateFrom: string;
  dateTo: string;
}

/**
 * The auxiliary half of the Curse page: an intake strip of pending requests, and
 * the ledger of everything already confirmed.
 *
 * This component OWNS the `useTripRequests` call, and the page mounts it only for
 * admin/dispatcher. That is deliberate: `GET /trip-requests` is
 * `@Roles(admin, dispatcher)` while `GET /trips` has no role guard at all, and an
 * operator can sign in to the web app (login supports username + PIN accounts).
 * Mounting this unconditionally would fire an admin-only query for a driver and
 * paint a red 403 panel over half their page. Not mounting it means the query is
 * never fired at all — they simply get a Curse page with one table.
 *
 * The backend 403 remains the real security boundary; this is only about not
 * offering what would fail.
 */
export function AuxTripSection({ search, dateFrom, dateTo }: AuxTripSectionProps) {
  const { t } = useI18n();
  const [stageFilter, setStageFilter] = useState<string>(ACTIVE);

  const [confirmTarget, setConfirmTarget] = useState<TripRequest | null>(null);
  const [cancelTarget, setCancelTarget] = useState<TripRequest | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<TripRequest | null>(null);
  const [avizTarget, setAvizTarget] = useState<TripRequest | null>(null);
  const [cmrTarget, setCmrTarget] = useState<TripRequest | null>(null);

  // Only send keys that have a value: URLSearchParams turns `undefined` into the
  // literal string "undefined", which the server would then try to parse.
  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (search) f.search = search;
    if (dateFrom) f.dateFrom = dateFrom;
    if (dateTo) f.dateTo = dateTo;
    return Object.keys(f).length ? f : undefined;
  }, [search, dateFrom, dateTo]);

  /*
   * The intake strip gets its OWN query, and it is deliberately NOT filtered.
   *
   * Pending requests are unactioned work, and this strip is now the only place in
   * the app you can confirm or cancel one. If it inherited the page's filters it
   * would inherit two ways to lose them silently:
   *   - the date bounds apply to trip_requests.created_at (when the REQUEST
   *     arrived). Set the bar to "today" and a request submitted at 22:00 last
   *     night vanishes — no card, no count, no trace.
   *   - the ledger query is capped at 200 rows by recency, so once an org has
   *     200+ lifetime requests an old un-actioned one falls out of the window.
   * Both would read as "there is nothing to confirm". Pending is small and
   * bounded by definition, so it is safe to always fetch it whole.
   */
  const pendingQuery = useTripRequests(apiClient, { status: RequestStatus.pending });
  const pending = useMemo(() => normalizeList<TripRequest>(pendingQuery.data), [pendingQuery.data]);

  // The ledger: everything already confirmed or cancelled, honouring the filters.
  const { data, isLoading, isError } = useTripRequests(apiClient, filters);
  const requests = useMemo(() => normalizeList<TripRequest>(data), [data]);

  const allRows = useMemo(
    () => buildAuxRows(requests.filter((r) => r.status !== RequestStatus.pending)),
    [requests],
  );

  // Default hides cancelled + completed: the table is a working surface, and a
  // request-anchored row lives forever, so a season's worth of finished
  // transports would otherwise bury the live ones.
  const rows = useMemo(() => {
    if (stageFilter === ACTIVE) return allRows.filter((r) => ACTIVE_AUX_STAGES.includes(r.stage));
    if (!stageFilter) return allRows;
    return allRows.filter((r) => r.stage === stageFilter);
  }, [allRows, stageFilter]);

  const handleConfirm = useCallback((r: TripRequest) => setConfirmTarget(r), []);
  const handleCancel = useCallback((r: TripRequest) => setCancelTarget(r), []);
  const handleDetails = useCallback((r: TripRequest) => setDetailsTarget(r), []);
  const handleAviz = useCallback((r: TripRequest) => setAvizTarget(r), []);
  const handleCmr = useCallback((r: TripRequest) => setCmrTarget(r), []);

  // A failure here must never take down the fleet table below.
  if (isError) {
    return (
      <section id="aux">
        <SectionHeader title={t('trips.sectionAux')} hint={t('trips.sectionAuxHint')} />
        <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-400">
          {t('tripRequests.loadError')}
        </p>
      </section>
    );
  }

  return (
    <section id="aux" className="space-y-3">
      {/* Intake: pending requests awaiting a confirm/cancel decision. */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <SectionHeader
            title={t('trips.sectionIntake')}
            hint={t('trips.sectionIntakeHint')}
            count={pending.length}
            tone="amber"
            icon={Inbox}
          />
          {pending.map((r) => (
            <AuxIntakeCard
              key={r.id}
              request={r}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
              onViewDetails={handleDetails}
            />
          ))}
        </div>
      )}

      <SectionHeader
        title={t('trips.sectionAux')}
        hint={t('trips.sectionAuxHint')}
        count={rows.length}
        actions={
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className={selectCls}
            aria-label={t('tripRequests.colStatus')}
          >
            <option value={ACTIVE}>{t('trips.stageActive')}</option>
            <option value="">{t('trips.stageAll')}</option>
            {/* `pending` is excluded on purpose: a pending request is a card in
                the intake strip above, never a row here, so offering the option
                would only ever produce an empty table with N cards visible
                directly above it — which reads as a data-loss bug. */}
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`tripRequests.stage.${s}`)}
              </option>
            ))}
          </select>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      ) : (
        <AuxTripTable
          rows={rows}
          onViewDetails={handleDetails}
          onUploadAviz={handleAviz}
          onUploadCmr={handleCmr}
          emptyMessage={t('trips.auxEmpty')}
        />
      )}

      {confirmTarget && (
        <ConfirmRequestModal request={confirmTarget} onClose={() => setConfirmTarget(null)} />
      )}
      {cancelTarget && (
        <CancelRequestModal request={cancelTarget} onClose={() => setCancelTarget(null)} />
      )}
      {detailsTarget && (
        <RequestDetailsModal request={detailsTarget} onClose={() => setDetailsTarget(null)} />
      )}
      {avizTarget && <AvizUploadModal request={avizTarget} onClose={() => setAvizTarget(null)} />}
      {cmrTarget && <CmrUploadModal request={cmrTarget} onClose={() => setCmrTarget(null)} />}
    </section>
  );
}
