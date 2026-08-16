import { sql, type SQL } from 'drizzle-orm';
import { tsWindowClause, type DateWindow } from './season-range';

/**
 * THE depot stock expression. One definition, previously three.
 *
 *     stock = opening(season) + inbound(window) - outbound(window)
 *
 * Before this file the same idea was copy-pasted into
 * `deposit-inventory.service.ts`, `delivery-destinations.service.ts` and
 * `reports.service.ts`, and the three copies disagreed on TWO axes:
 *
 *   join key   FK `destination_id` (deposit-inventory) vs the free-text
 *              `trips.destination_name = d.name` (the other two)
 *   status set `= 'completed'` vs `IN ('delivered','completed')`
 *
 * So the same depot could report three different stock figures on three
 * screens. This unifies on the FK and on the wider status set:
 *
 *   * THE FK IS THE RULE. It is the only key that agrees with what
 *     `confirmDepotDelivery` authorizes against — matching on the denormalized
 *     name puts the stock figure on a different definition of "this depot"
 *     than the permission check. A depot rename re-points a name join at
 *     nothing, silently zeroing the stock. The 50 m spatial term survives only
 *     as a fallback for the pre-00085 history whose `destination_id` the
 *     backfill deliberately skipped.
 *   * `delivered` COUNTS. A trip sits in `delivered` until autocomplete runs;
 *     excluding it made bales that are physically in the depot invisible to
 *     the operator standing next to them.
 *
 * ── WHICH DATE PUTS A MOVEMENT IN A SEASON ──────────────────────────────────
 *
 * Stock moves when the truck is unloaded, not when the trip was planned, so the
 * inbound term is windowed on `COALESCE(delivered_at, completed_at, created_at)`
 * rather than on `created_at` like the trip *ledger* is. A trip dispatched on 31
 * December and unloaded on 2 January is a 2026 trip that added 2027 stock, and
 * both statements are true.
 */

/** `trips` timestamp that decides which season a depot movement belongs to. */
export const TRIP_DELIVERY_INSTANT = sql`COALESCE(t.delivered_at, t.completed_at, t.created_at)`;

/** Statuses whose bales are physically at the destination. */
export const DELIVERED_STATUSES = sql`('delivered'::trip_status, 'completed'::trip_status)`;

export interface DepotStockOptions {
  /** SQL resolving to the depot's id (a bind param, or a correlated column). */
  depotIdExpr: SQL;
  /** SQL resolving to the depot's coords, for the pre-00085 spatial fallback. */
  depotCoordsExpr: SQL;
  orgId: string | null;
  /** Absent = all time. Present = only movements inside this window. */
  window?: DateWindow;
  /** Absent = no opening term (first season, or seasons not in play). */
  seasonYear?: number;
}

function orgClause(orgId: string | null, col: SQL): SQL {
  return orgId === null ? sql`` : sql` AND ${col} = ${orgId}::uuid`;
}

/**
 * Bales delivered INTO the depot within the window.
 *
 * Correlated scalar subquery rather than a JOIN so callers can drop it into a
 * SELECT list next to a depot row without restructuring their query.
 */
export function depotInboundBales(o: DepotStockOptions): SQL {
  return sql`(
    SELECT COALESCE(SUM(t.bale_count), 0)::int
      FROM trips t
     WHERE t.deleted_at IS NULL
       AND t.status IN ${DELIVERED_STATUSES}
       AND (
         t.destination_id = ${o.depotIdExpr}
         OR (t.destination_id IS NULL
             AND t.destination_coords IS NOT NULL
             AND ST_DWithin(t.destination_coords::geography, ${o.depotCoordsExpr}::geography, 50))
       )
       ${orgClause(o.orgId, sql`t.organization_id`)}
       ${tsWindowClause(TRIP_DELIVERY_INSTANT, o.window)}
  )`;
}

/** Net weight delivered INTO the depot within the window. */
export function depotInboundNetWeight(o: DepotStockOptions): SQL {
  return sql`(
    SELECT COALESCE(SUM(GREATEST(COALESCE(t.gross_weight_kg, 0) - COALESCE(t.tare_weight_kg, 0), 0)), 0)::numeric
      FROM trips t
     WHERE t.deleted_at IS NULL
       AND t.status IN ${DELIVERED_STATUSES}
       AND (
         t.destination_id = ${o.depotIdExpr}
         OR (t.destination_id IS NULL
             AND t.destination_coords IS NOT NULL
             AND ST_DWithin(t.destination_coords::geography, ${o.depotCoordsExpr}::geography, 50))
       )
       ${orgClause(o.orgId, sql`t.organization_id`)}
       ${tsWindowClause(TRIP_DELIVERY_INSTANT, o.window)}
  )`;
}

/**
 * Bales loaded back OUT of the depot within the window.
 *
 * Keyed on the FK alone — a load knows exactly which depot it came from, so
 * there is nothing to infer and no spatial fallback is warranted.
 */
export function depotOutboundBales(o: DepotStockOptions): SQL {
  return sql`(
    SELECT COALESCE(SUM(bl.bale_count), 0)::int
      FROM bale_loads bl
     WHERE bl.deleted_at IS NULL
       AND bl.source_depot_id = ${o.depotIdExpr}
       ${orgClause(o.orgId, sql`bl.organization_id`)}
       ${tsWindowClause(sql`bl.loaded_at`, o.window)}
  )`;
}

/**
 * The carried-forward opening balance for this depot and season.
 *
 * Zero when no row exists, which is the correct answer in two distinct
 * situations that must behave identically: the organization's first season, and
 * a season whose predecessor has not been closed yet.
 */
export function depotOpeningBales(o: DepotStockOptions): SQL {
  if (o.seasonYear === undefined) return sql`0`;
  return sql`(
    SELECT COALESCE(SUM(sob.bale_count), 0)::int
      FROM season_opening_balances sob
     WHERE sob.depot_id = ${o.depotIdExpr}
       AND sob.season_year = ${o.seasonYear}
       ${orgClause(o.orgId, sql`sob.organization_id`)}
  )`;
}

/** The carried-forward opening net weight for this depot and season. */
export function depotOpeningNetWeight(o: DepotStockOptions): SQL {
  if (o.seasonYear === undefined) return sql`0::numeric`;
  return sql`(
    SELECT COALESCE(SUM(sob.net_weight_kg), 0)::numeric
      FROM season_opening_balances sob
     WHERE sob.depot_id = ${o.depotIdExpr}
       AND sob.season_year = ${o.seasonYear}
       ${orgClause(o.orgId, sql`sob.organization_id`)}
  )`;
}

/**
 * Current stock in bales: opening + inbound - outbound, clamped at zero.
 *
 * The clamp is a display guard, not a correctness one. Negative stock means the
 * inbound and outbound terms disagree about reality (a load recorded out of a
 * depot that has no matching delivery in), and showing a negative count to a
 * depot operator helps nobody — but the underlying inconsistency is real and
 * the closing transaction refuses to persist it, because
 * `season_opening_balances` CHECKs `bale_count >= 0`.
 */
export function depotStockBales(o: DepotStockOptions): SQL {
  return sql`GREATEST(
    ${depotOpeningBales(o)} + ${depotInboundBales(o)} - ${depotOutboundBales(o)},
    0
  )::int`;
}

/**
 * Current stock in kilograms.
 *
 * Outbound has no weight term: `bale_loads` records a bale count and never a
 * weight, so there is nothing to subtract. The figure is therefore "weight
 * received", not "weight on hand", and is presented as such.
 */
export function depotStockNetWeight(o: DepotStockOptions): SQL {
  return sql`GREATEST(
    ${depotOpeningNetWeight(o)} + ${depotInboundNetWeight(o)},
    0
  )::numeric`;
}
