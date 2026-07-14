'use client';

import Link from 'next/link';
import { Eye, AlertTriangle, Trash2 } from 'lucide-react';
import type { TripRequest } from '@strawboss/types';
import { AuxStage } from '@strawboss/types';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { useOrgSlug } from '@/hooks/useOrgSlug';
import { useI18n } from '@/lib/i18n';
import { fmtDate, EMPTY } from '@/lib/date';
import type { AuxRow } from '@/lib/aux-rows';
import { AuxStageBadge } from '@/components/features/trip-requests/AuxStageBadge';
import { RequestDocChips } from '@/components/features/trip-requests/RequestDocChips';
import { qualityLabelKey, truckLabel } from '@/components/features/trip-requests/labels';

interface AuxTripTableProps {
  rows: AuxRow[];
  onViewDetails: (r: TripRequest) => void;
  onUploadAviz: (r: TripRequest) => void;
  onUploadCmr: (r: TripRequest) => void;
  /** Delete the live trip, handing the request back as "confirmed — unplanned". */
  onUnplan: (row: AuxRow) => void;
  /** No trip to un-plan: cancel the request itself and retire its one-time truck. */
  onCancelRequest: (r: TripRequest) => void;
  canUnplan?: boolean;
  emptyMessage?: string;
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
 * There is deliberately NO delete action here. An aux trip is owned by its
 * request — deleting the trip leaves the request pointing at a dead row and the
 * loader's phone stuck on "Camionul auxiliar nu are o cursă activă" forever. You
 * cancel the request, not the trip. Because the fleet table is filtered to
 * `isAuxiliary=false`, an aux trip has no delete button anywhere in the UI, which
 * makes that hazard structurally unreachable rather than merely discouraged.
 */
export function AuxTripTable({
  rows,
  onViewDetails,
  onUploadAviz,
  onUploadCmr,
  onUnplan,
  onCancelRequest,
  canUnplan = false,
  emptyMessage,
}: AuxTripTableProps) {
  const { t } = useI18n();
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
      key: 'cropType',
      header: t('tripRequests.colCrop'),
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
      key: 'pickup',
      header: t('tripRequests.colPickup'),
      render: (row) => {
        // What actually happened beats what was planned; show both when both exist.
        const parcel = row.request.tripSourceParcelName;
        const depot = row.request.tripSourceDepotName ?? row.request.sourceDepotName;
        const label = [parcel, depot].filter(Boolean).join(' · ');
        return <span className="text-xs text-neutral-700">{label || EMPTY}</span>;
      },
    },
    {
      key: 'destinationLocality',
      header: t('tripRequests.colDestination'),
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
          {fmtDate(row.request.neededDate)}
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
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails(row.request);
            }}
            className="rounded p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
            aria-label={t('tripRequests.viewDetails')}
            title={t('tripRequests.viewDetails')}
          >
            <Eye className="h-4 w-4" />
          </button>
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
                if (row.request.tripLiveId) onUnplan(row);
                else onCancelRequest(row.request);
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

  return (
    <DataTable<AuxRow>
      columns={columns}
      data={rows}
      keyExtractor={(row) => row.id}
      emptyMessage={emptyMessage}
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
