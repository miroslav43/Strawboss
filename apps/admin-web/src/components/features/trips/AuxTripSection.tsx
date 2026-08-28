'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Inbox } from 'lucide-react';
import { useTripRequests, useAllTripRequests, useDeleteTrip, queryKeys } from '@strawboss/api';
import type { TripRequest } from '@strawboss/types';
import { AuxStage, ACTIVE_AUX_STAGES, AUX_STAGE_ORDER, RequestStatus } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useIsDispatcher } from '@/hooks/useIsDispatcher';
import { normalizeList } from '@/lib/normalize-api-list';
import { buildAuxRows, type AuxRow } from '@/lib/aux-rows';
import { SectionHeader } from '@/components/shared/SectionHeader';
import { AuxTripTable } from './AuxTripTable';
import { AuxIntakeCard } from '@/components/features/trip-requests/AuxIntakeCard';
import { ConfirmRequestModal } from '@/components/features/trip-requests/ConfirmRequestModal';
import { CancelRequestModal } from '@/components/features/trip-requests/CancelRequestModal';
import { RequestDetailsModal } from '@/components/features/trip-requests/RequestDetailsModal';
import { AvizUploadModal } from '@/components/features/trip-requests/AvizUploadModal';
import { CmrUploadModal } from '@/components/features/trip-requests/CmrUploadModal';
import { EditRequestModal } from '@/components/features/trip-requests/EditRequestModal';

const selectCls =
  'rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/** Sentinel for the "only live work" default view. */
const ACTIVE = '__active__';

/**
 * Stable empty ledger. A fresh `[]` per render is a new reference, which would
 * re-run `buildAuxRows` and every memo downstream of it on every paint.
 */
const NO_REQUESTS: TripRequest[] = [];

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
  const qc = useQueryClient();
  const deleteTrip = useDeleteTrip(apiClient);
  const { isDispatcher } = useIsDispatcher();
  const [stageFilter, setStageFilter] = useState<string>(ACTIVE);

  const [confirmTarget, setConfirmTarget] = useState<TripRequest | null>(null);
  const [cancelTarget, setCancelTarget] = useState<TripRequest | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<TripRequest | null>(null);
  const [avizTarget, setAvizTarget] = useState<TripRequest | null>(null);
  const [cmrTarget, setCmrTarget] = useState<TripRequest | null>(null);
  const [cmrArrivalTarget, setCmrArrivalTarget] = useState<TripRequest | null>(null);
  const [editTarget, setEditTarget] = useState<TripRequest | null>(null);

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
   *   - the ledger query is filtered; a pending request that falls outside the
   *     bar's window would vanish from the only surface that can action it.
   * Both would read as "there is nothing to confirm". Pending is small and
   * bounded by definition, so it is safe to always fetch it whole.
   */
  const pendingQuery = useTripRequests(apiClient, { status: RequestStatus.pending });
  const pending = useMemo(() => normalizeList<TripRequest>(pendingQuery.data), [pendingQuery.data]);

  /*
   * The ledger: everything already confirmed or cancelled, honouring the filters
   * — and WHOLE.
   *
   * This used to call `useTripRequests` with no `limit`, so it took the server
   * default of 200 rows ordered `created_at DESC`. The stage filter below runs
   * CLIENT-side, after that truncation. With the default "Activă" view the
   * window never binds (live rows are recent), which is why sorting looked fine;
   * select "Toate stările" and it does bind — and since created_at order is not
   * needed_date order, the cut is ragged in date space, so a date sort came back
   * with rows missing from the MIDDLE of the sequence.
   */
  const ledger = useAllTripRequests(apiClient, filters);
  const { isLoading, isError } = ledger;
  // NOT normalizeList(): this hook resolves to LedgerResult<TripRequest>
  // ({rows,total,truncated}), and normalizeList takes `unknown` — it would
  // silently return [] and empty the whole ledger with no compile error.
  const requests = ledger.data?.rows ?? NO_REQUESTS;

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
  const handleCmrArrival = useCallback((r: TripRequest) => setCmrArrivalTarget(r), []);
  const handleEdit = useCallback((r: TripRequest) => setEditTarget(r), []);

  /**
   * Un-plan: delete the live trip. The server hands the request back as
   * "Confirmată — neplanificată" (it soft-deletes the truck task and clears
   * trip_requests.trip_id), so the row STAYS in this table and can simply be
   * re-assigned on the truck board. That is the answer to "the truck broke down".
   */
  const handleUnplan = useCallback(
    (row: AuxRow) => {
      const tripId = row.request.tripLiveId;
      if (!tripId || typeof window === 'undefined') return;
      const label = row.request.tripNumber ?? tripId.slice(0, 8);
      const who = row.request.companyName || row.request.requesterName;
      if (!window.confirm(t('tripRequests.unplanConfirm', { label, who }))) return;
      deleteTrip.mutate(tripId, {
        // The trip is gone, but the REQUEST changed too — its stage falls back to
        // `unplanned`. useDeleteTrip only invalidates trips.*, so refresh the aux
        // ledger explicitly or the row would keep showing a dead trip number.
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: queryKeys.tripRequests.all });
          qc.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
        },
      });
    },
    [deleteTrip, qc, t],
  );

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
              // A pending request is never a table row, and this is exactly
              // where a portal typo is freshest — leaving edit only on the
              // ledger would make the newest request the one you cannot fix.
              onEdit={isDispatcher ? handleEdit : undefined}
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

      {/* The page ceiling was hit — say so rather than quietly showing a slice. */}
      {ledger.data?.truncated && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          {t('reports.common.capNotice', { count: String(requests.length) })}
        </p>
      )}

      {/*
        Render as soon as there is ANY data, dimmed while refetching.
        The old `isLoading ? spinner : table` swapped DataTable out on every
        search/date keystroke, and DataTable owns its sort state — so the
        operator's sort silently reset mid-typing, which reads as "it stopped
        sorting".
      */}
      {isLoading && !ledger.data ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      ) : (
        <div className={cn('transition-opacity', ledger.isFetching && 'opacity-60')}>
          <AuxTripTable
            rows={rows}
            onViewDetails={handleDetails}
            onEdit={isDispatcher ? handleEdit : undefined}
            onUploadAviz={handleAviz}
            onUploadCmr={handleCmr}
            onUploadCmrArrival={handleCmrArrival}
            onUnplan={handleUnplan}
            // No trip to un-plan → cancel the request itself. Reuses the same modal
            // the intake cards use, so a reason is still captured.
            onCancelRequest={handleCancel}
            canUnplan={isDispatcher && !deleteTrip.isPending}
            emptyMessage={t('trips.auxEmpty')}
            // Newest obligations on top, and a visible chevron from first paint.
            // Same-day trucks then group by company instead of by an invisible
            // column (the server's created_at).
            defaultSortKey="neededDate"
            defaultSortDir="desc"
            tieBreakKey="requesterName"
          />
        </div>
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
      {cmrArrivalTarget && (
        <CmrUploadModal
          request={cmrArrivalTarget}
          kind="delivery"
          onClose={() => setCmrArrivalTarget(null)}
        />
      )}
      {editTarget && (
        <EditRequestModal request={editTarget} onClose={() => setEditTarget(null)} />
      )}
    </section>
  );
}
