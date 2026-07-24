import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { MACHINE_ONLINE_WINDOW_MS, type MachineLastLocation } from '@strawboss/types';
import { DrizzleProvider } from '../database/drizzle.provider';

/**
 * Reverse-geocode cache: (rounded coordinate) -> nearest locality name.
 *
 * The tasks-page machine cards want a "where is it right now — nearest
 * locality" label. Turning lat/lon into a place name needs reverse geocoding
 * via the PUBLIC Nominatim endpoint, which is rate-limited (~1 req/s). The
 * machine location feed is polled every 30 s across the whole fleet, so we:
 *  - cache by coordinate rounded to 3 decimals (~110 m) in `geocode_cache`
 *    (migration 00089), so a parked machine geocodes once;
 *  - fill cache misses ASYNCHRONOUSLY, capped and rate-limited, OFF the request
 *    path, so the location endpoint never blocks on Nominatim. A miss surfaces
 *    as `locality: null` and fills in for the next poll.
 */
@Injectable()
export class GeocodeService {
  private readonly logger = new Logger(GeocodeService.name);

  /** Keys currently being reverse-geocoded (this process) — dedupes concurrent fills. */
  private readonly inFlight = new Set<string>();

  /** Max cache misses to reverse-geocode per feed call (rate-limit guard). */
  private static readonly FILL_CAP = 3;
  /** Spacing between Nominatim calls to respect its ~1 req/s usage policy. */
  private static readonly NOMINATIM_SPACING_MS = 1_100;
  /** How long a cached locality (incl. a cached NULL) is considered valid. */
  private static readonly CACHE_TTL_DAYS = 90;

  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  private coordKey(lat: number, lon: number): string {
    return `${lat.toFixed(3)},${lon.toFixed(3)}`;
  }

  /**
   * Attach `locality` to each FRESH machine position from the cache, and kick
   * off a capped, rate-limited async fill for cache misses. Mutates `rows` in
   * place. Never blocks on the network — misses stay `null` until a later poll.
   * "Fresh" = reported within MACHINE_ONLINE_WINDOW_MS (GPS is currently on).
   */
  async attachLocalities(rows: MachineLastLocation[]): Promise<void> {
    const now = Date.now();
    const coordByKey = new Map<string, { lat: number; lon: number }>();
    const fresh: MachineLastLocation[] = [];

    for (const r of rows) {
      if (r.lat == null || r.lon == null || !r.recordedAt) continue;
      if (now - new Date(r.recordedAt).getTime() >= MACHINE_ONLINE_WINDOW_MS) continue;
      fresh.push(r);
      const key = this.coordKey(r.lat, r.lon);
      if (!coordByKey.has(key)) coordByKey.set(key, { lat: r.lat, lon: r.lon });
    }
    if (fresh.length === 0) return;

    // Best-effort only: locality is a nice-to-have label. A DB error here (e.g.
    // the geocode_cache table not yet migrated, so the backend can deploy before
    // the migration) must never break the /location/machines feed — swallow it
    // and just leave `locality` unset.
    try {
      const keys = [...coordByKey.keys()];
      const cached = await this.lookupCache(keys);
      for (const r of fresh) {
        const key = this.coordKey(r.lat, r.lon);
        if (cached.has(key)) r.locality = cached.get(key) ?? null;
      }

      const misses = keys
        .filter((k) => !cached.has(k) && !this.inFlight.has(k))
        .slice(0, GeocodeService.FILL_CAP);
      if (misses.length > 0) {
        // Fire and forget — the fill populates the cache for the NEXT poll.
        void this.fillCache(misses, coordByKey);
      }
    } catch (err) {
      this.logger.warn(
        `attachLocalities skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async lookupCache(keys: string[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    if (keys.length === 0) return map;
    const rows = (await this.drizzleProvider.db.execute(sql`
      SELECT coord_key AS "coordKey", locality
      FROM geocode_cache
      WHERE coord_key = ANY(${keys}::text[])
        AND geocoded_at > now() - ${sql.raw(`interval '${GeocodeService.CACHE_TTL_DAYS} days'`)}
    `)) as unknown as { coordKey: string; locality: string | null }[];
    for (const r of rows) map.set(r.coordKey, r.locality);
    return map;
  }

  private async fillCache(
    keys: string[],
    coordByKey: Map<string, { lat: number; lon: number }>,
  ): Promise<void> {
    for (const key of keys) {
      const coord = coordByKey.get(key);
      if (!coord) continue;
      this.inFlight.add(key);
      try {
        const locality = await this.nominatimReverse(coord.lat, coord.lon);
        await this.drizzleProvider.db.execute(sql`
          INSERT INTO geocode_cache (coord_key, locality, lat, lon, geocoded_at)
          VALUES (${key}, ${locality}, ${coord.lat}, ${coord.lon}, now())
          ON CONFLICT (coord_key) DO UPDATE SET
            locality    = EXCLUDED.locality,
            lat         = EXCLUDED.lat,
            lon         = EXCLUDED.lon,
            geocoded_at = now()
        `);
      } catch (err) {
        this.logger.warn(
          `geocode fill failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        this.inFlight.delete(key);
      }
      // Respect Nominatim's ~1 req/s usage policy.
      await new Promise((resolve) => setTimeout(resolve, GeocodeService.NOMINATIM_SPACING_MS));
    }
  }

  /**
   * Resolve the nearest locality via Nominatim reverse geocoding. Returns null
   * on failure/timeout. zoom=14 targets town/village level. Mirrors the pattern
   * in parcels.service.ts (reverseLookupMunicipality).
   */
  private async nominatimReverse(lat: number, lon: number): Promise<string | null> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=14`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'StrawBoss/1.0 (contact@strawboss.app)' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        address?: {
          village?: string;
          town?: string;
          city?: string;
          municipality?: string;
          suburb?: string;
          hamlet?: string;
          county?: string;
        };
      };
      const a = data.address ?? {};
      // Prefer the smallest named place ("nearest locality").
      return (
        a.village ?? a.town ?? a.city ?? a.municipality ?? a.suburb ?? a.hamlet ?? a.county ?? null
      );
    } catch {
      return null;
    }
  }
}
