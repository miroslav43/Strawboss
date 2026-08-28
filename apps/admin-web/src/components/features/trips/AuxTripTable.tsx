'use client';

import Link from 'next/link';
import { Eye, AlertTriangle, Trash2, Pencil } from 'lucide-react';
import type { TripRequest } from '@strawboss/types';
import { AuxStage } from '@strawboss/types';
import { canDeleteAuxStage, canEditAuxStage } from '@strawboss/domain';
import { DataTable, type Column } from '@/components/shared/DataTable';
import type { SortDirection } from '@/lib/table-sort';
import { cn } from '@/lib/utils';
import { useOrgSlug } from '@/hooks/useOrgSlug';
import { useI18n } from '@/lib/i18n';
import { useLocaleFormat } from '@/lib/use-locale-format';
import { fmtDate, EMPTY } from '@/lib/date';
import type { AuxRow } from '@/lib/aux-rows';
import { AuxStageBadge } from '@/components/features/trip-requests/AuxStageBadge';
import { RequestDocChips } from '@/components/features/trip-requests/RequestDocChips';
import { qualityLabelKey, truckLabel } from '@/components/features/trip-requests/labels';

interface AuxTripTableProps {
  rows: AuxRow[];
  onViewDetails?: (r: TripRequest) => void;
  onUploadAviz?: (r: TripRequest) => void;
  onUploadCmr?: (r: TripRequest) => void;
  onUploadCmrArrival?: (r: TripRequest) => void;
  /** Delete the live trip, handing the request back as "confirmed — unplanned". */
  onUnplan?: (row: AuxRow) => void;
  /** No trip to un-plan: cancel the request itself and retire its one-time truck. */
  onCancelRequest?: (r: TripRequest) => void;
  canUnplan?: boolean;
  /**
   * Read-only view (the transporter's ledger): no admin actions, and the doc
   * chips render static. `onUnplan`/`onCancelRequest`/`canUnplan` are ignored.
   * `onDelete` is the one exception — see below. Defaults to the admin's
   * interactive ledger.
   */
  readOnly?: boolean;
  /** Whole-row click (the read-only ledger uses it to open a details modal). */
  onRowClick?: (row: AuxRow) => void;
  /** View/generate the comandă (transport order) — adds a 3rd doc chip. */
  onViewComanda?: (r: TripRequest) => void;
  /**
   * Delete the REQUEST outright (the transporter's own self-service delete,
   * not the admin un-plan/cancel escalation below). Only ever rendered in the
   * `readOnly` ledger, and only for rows whose stage is still
   * `canDeleteAuxStage` — see the actions-column comment.
   */
  onDelete?: (row: AuxRow) => void;
  /**
   * Correct the request's data in place, instead of deleting and re-creating it.
   * Admin ledger only — the transporter ledger and the report tab pass
   * `readOnly` and never wire this, so they stay action-free by construction.
   */
  onEdit?: (r: TripRequest) => void;
  emptyMessage?: string;
  /** Column sorted on mount — see DataTable. Without one the table opens with no chevron. */
  defaultSortKey?: string;
  defaultSortDir?: SortDirection;
  /** Secondary sort key, always ascending. */
  tieBreakKey?: string;
}

/**
 * The auxiliary ledger: one row per external transport, for its whole life.
 *
 * Every column reads from the REQUEST, with the live trip only supplying
 * execution facts (number, bales, actual pickup). That inversion is what fixes
 * the original bug: the fleet table read `driver_name` off the users JOIN, and
 * an aux trip has `driver_id` NULL by construction, so the cell was structurally
 * always blank. The external driver's name has always lived on the request.
 *
 * There is NO admin delete-the-trip action here, deliberately. An aux trip is
 * owned by its request — deleting just the trip leaves the request pointing at
 * a dead row and the loader's phone stuck on "Camionul auxiliar nu are o cursă
 * activă" forever. The admin trash icon therefore un-plans/cancels the REQUEST
 * (see `onUnplan`/`onCancelRequest`), never the bare trip.
 *
 * `onDelete` is a second, narrower trash icon for the transporter's own
 * read-only ledger: it deletes the whole request (and any trip on it) in one
 * step, but ONLY while `canDeleteAuxStage(row.stage)` — i.e. nothing has
 * physically moved yet. The backend re-derives the stage and refuses
 * regardless of what this button shows, so hiding it here is a UX nicety, not
 * the enforcement.
 */
export function AuxTripTable({
  rows,
  onViewDetails,
  onUploadAviz,
  onUploadCmr,
  onUploadCmrArrival,
  onUnplan,
  onCancelRequest,
  canUnplan = false,
  readOnly = false,
  onRowClick,
  onViewComanda,
  onDelete,
  onEdit,
  emptyMessage,
  defaultSortKey,
  defaultSortDir,
  tieBreakKey,
}: AuxTripTableProps) {
  const { t } = useI18n();
  const fmt = useLocaleFormat();
  const slug = useOrgSlug();

  const columns: Column<AuxRow>[] = [
    {
      key: 'stageOrder', // numeric ordinal → sorts by lifecycle, not alphabetically
      header: t('tripRequests.colStatus'),
      sortable: true,
      render: (row) => <AuxStageBadge stage={row.stage} />,
    },
    {
      key: 'requesterName',
      header: t('tripRequests.colRequester'),
      sortable: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-neutral-800">
            {row.request.companyName || row.request.requesterName}
          </p>
          {row.request.companyName && (
            <p className="truncate text-[11px] text-neutral-400">{row.request.requesterName}</p>
          )}
        </div>
      ),
    },
    {
      key: 'truckPlate',
      header: t('tripRequests.colTruck'),
      sortable: true,
      render: (row) => (
        <div className="min-w-0">
          {/* From the request — the aux machine row is a copy and is soft-deleted at load time. */}
          <p className="truncate font-mono text-xs font-medium text-neutral-800">
            {row.request.truckRegistrationPlate}
            {row.request.trailerRegistrationPlate && (
              <span className="text-neutral-400"> + {row.request.trailerRegistrationPlate}</span>
            )}
          </p>
          {truckLabel(row.request) !== row.request.truckRegistrationPlate && (
            <p className="truncate text-[11px] text-neutral-400">
              {[row.request.truckMake, row.request.truckModel].filter(Boolean).join(' ')}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'driverName',
      header: t('tripRequests.colDriver'),
      sortable: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs text-neutral-700">{row.request.driverName || EMPTY}</p>
          {row.request.driverPhone && (
            <a
              href={`tel:${row.request.driverPhone}`}
              onClick={(e) => e.stopPropagation()}
              className="truncate text-[11px] text-primary hover:underline"
            >
              {row.request.driverPhone}
            </a>
          )}
        </div>
      ),
    },
    {
      // Sorts on what the cell SHOWS. `cropSort` mirrors the raw enum, so in
      // ro/hu the visible order was alphabetical in a language nobody sees. The
      // mirror stays in `buildAuxRow` — the report's CSV path still uses it.
      key: 'cropSort',
      header: t('tripRequests.colCrop'),
      sortable: true,
      sortValue: (row) =>
        [row.request.cropType, row.request.quality ? t(qualityLabelKey(row.request.quality)) : null]
          .filter(Boolean)
          .join(' · ') || null,
      render: (row) => {
        const crop = row.request.cropType;
        const quality = row.request.quality ? t(qualityLabelKey(row.request.quality)) : null;
        const label = [crop, quality].filter(Boolean).join(' · ');
        return <span className="text-xs text-neutral-700">{label || EMPTY}</span>;
      },
    },
    // No tonnage column: the beneficiary portal dropped `tonsRequested` from its
    // form, so it is structurally empty for those requests — a column that is
    // blank for most rows is worse than no column. The value still shows on the
    // intake card and in the details modal when a request actually carries one.
    {
      key: 'pickupSort',
      header: t('tripRequests.colPickup'),
      sortable: true,
      render: (row) => {
        // What actually happened beats what was planned; show both when both exist.
        const parcel = row.request.tripSourceParcelName ?? row.request.sourceParcelName;
        const depot = row.request.tripSourceDepotName ?? row.request.sourceDepotName;
        const label = [parcel, depot].filter(Boolean).join(' · ');
        return <span className="text-xs text-neutral-700">{label || EMPTY}</span>;
      },
    },
    {
      key: 'destinationSort',
      header: t('tripRequests.colDestination'),
      sortable: true,
      render: (row) => (
        <div className="min-w-0">
          {/* The request's own destination — NOT trips.destination_name, which is a
              heuristic that can literally render the words "Adresă solicitant". */}
          <p className="truncate text-xs text-neutral-700">
            {row.request.destinationLocality || EMPTY}
          </p>
          {row.request.destinationAddress && (
            <p className="truncate text-[11px] text-neutral-400">
              {row.request.destinationAddress}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'neededDate',
      header: t('tripRequests.colNeededDate'),
      sortable: true,
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-neutral-600">
          {fmtDate(row.request.neededDate, fmt.tag)}
        </span>
      ),
    },
    {
      key: 'tripNumber',
      header: t('tripRequests.colTrip'),
      sortable: true,
      render: (row) => {
        const { tripLiveId, tripNumber, tripBaleCount, tripLoadingCompletedAt, tripCount } =
          row.request;
        if (!tripLiveId) {
          // Correct, not missing: stages pending/unplanned have no trip yet.
          return <span className="text-xs text-neutral-300">{EMPTY}</span>;
        }
        return (
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0">
              <Link
                href={`/${slug}/trips/${tripLiveId}`}
                onClick={(e) => e.stopPropagation()}
                className="truncate text-xs font-medium text-primary hover:underline"
              >
                {tripNumber ?? tripLiveId.slice(0, 8)}
              </Link>
              {/* A planned trip is INSERTed with bale_count = 0 — showing "0" would
                  read as "carried nothing" rather than "not loaded yet". */}
              {tripLoadingCompletedAt && (
                <p className="text-[11px] text-neutral-400">
                  {Number(tripBaleCount ?? 0)} {t('tripRequests.bales')}
                </p>
              )}
            </div>
            {typeof tripCount === 'number' && tripCount > 1 && (
              <span
                title={t('tripRequests.multipleTrips')}
                className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1 py-0.5 text-[10px] font-semibold text-red-700"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                {tripCount}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'documents',
      header: t('tripRequests.colDocuments'),
      render: (row) => (
        <RequestDocChips
          request={row.request}
          onUploadAviz={onUploadAviz}
          onUploadCmr={onUploadCmr}
          onUploadCmrArrival={onUploadCmrArrival}
          onViewComanda={onViewComanda}
          // Static only when nobody can act on them. In the read-only ledger the
          // transporter still gets clickable chips if upload handlers are wired.
          readOnly={readOnly && !onUploadAviz && !onUploadCmr && !onUploadCmrArrival}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        readOnly ? (
          // Transporter ledger: the only action is deleting their own request,
          // and only while nothing has moved yet (canDeleteAuxStage). No eye
          // icon here — the whole row is already clickable (see onRowClick).
          <div className="flex items-center justify-end gap-1">
            {onDelete && canDeleteAuxStage(row.stage) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(row);
                }}
                className="rounded p-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
                aria-label={t('transporter.deleteTripAria')}
                title={t('transporter.deleteTripAria')}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onViewDetails?.(row.request);
              }}
              className="rounded p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
              aria-label={t('tripRequests.viewDetails')}
              title={t('tripRequests.viewDetails')}
            >
              <Eye className="h-4 w-4" />
            </button>
            {/*
              Correct the transport instead of deleting and re-creating it.

              DISABLED, not hidden: a button that vanishes teaches nothing, a
              greyed one with a reason teaches the rule. Same contract as the
              delete icon below — the backend re-derives the stage from
              `composeAuxStage` and refuses regardless of what this shows, so
              this gate is a UX nicety, never the enforcement.
            */}
            {onEdit &&
              (() => {
                const editable = canEditAuxStage(row.stage);
                const label = editable
                  ? t('tripRequests.editAria')
                  : t('tripRequests.editLocked');
                return (
                  <button
                    type="button"
                    disabled={!editable}
                    aria-disabled={!editable}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (editable) onEdit(row.request);
                    }}
                    className={cn(
                      'rounded p-1 transition',
                      editable
                        ? 'text-neutral-400 hover:bg-primary/10 hover:text-primary'
                        : 'cursor-not-allowed text-neutral-200',
                    )}
                    aria-label={label}
                    title={label}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                );
              })()}
            {/*
              One trash icon, two meanings — an escalation, not an ambiguity:
                has a trip  -> UN-PLAN it. The request returns to "Confirmată —
                               neplanificată" and can be re-assigned to another truck.
                               (The truck broke down.)
                no trip yet -> CANCEL the request outright and retire its one-time
                               auxiliary truck. (The transport is off.)
              So deleting a planned transport twice walks it all the way out, and you
              can never wipe a commitment out from under a loader already working on it.
              Nothing to delete on an already-cancelled row.
            */}
            {canUnplan && row.stage !== AuxStage.cancelled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (row.request.tripLiveId) onUnplan?.(row);
                  else onCancelRequest?.(row.request);
                }}
                className="rounded p-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
                aria-label={
                  row.request.tripLiveId
                    ? t('tripRequests.unplanAria')
                    : t('tripRequests.cancelRequestAria')
                }
                title={
                  row.request.tripLiveId
                    ? t('tripRequests.unplanAria')
                    : t('tripRequests.cancelRequestAria')
                }
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ),
    },
  ];

  // Read-only ledger (transporter): actions column only when there is
  // something to act on (a delete handler). The admin ledger always keeps it.
  const showActionsColumn = !readOnly || !!onDelete;
  const visibleColumns = showActionsColumn ? columns : columns.filter((c) => c.key !== 'actions');

  return (
    <DataTable<AuxRow>
      columns={visibleColumns}
      data={rows}
      keyExtractor={(row) => row.id}
      onRowClick={onRowClick}
      emptyMessage={emptyMessage}
      defaultSortKey={defaultSortKey}
      defaultSortDir={defaultSortDir}
      tieBreakKey={tieBreakKey}
      rowClassName={(row) =>
        row.stage === AuxStage.cancelled
          ? 'bg-neutral-50 text-neutral-400'
          : row.stage === AuxStage.unplanned
            ? 'bg-amber-50/60'
            : undefined
      }
    />
  );
}
