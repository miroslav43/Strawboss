import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as jose from 'jose';
import { sql } from 'drizzle-orm';
import { UserRole, type FeatureKey, type FeatureOverrides } from '@strawboss/types';
import { DrizzleProvider } from '../database/drizzle.provider';
import { FeaturesService } from '../features/features.service';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Known application roles. Excludes Supabase's built-in `anon`/`service_role`. */
const KNOWN_USER_ROLES: ReadonlySet<string> = new Set<string>(Object.values(UserRole));

/** Supabase JWTs are always issued for this audience. */
const EXPECTED_AUDIENCE = 'authenticated';

/** What one `loadUserContext` round-trip yields, and what the TTL cache holds. */
interface UserContext {
  isActive: boolean;
  organizationId: string | null;
  organizationSlug: string | null;
  disabledFeatures: FeatureKey[];
  activeSeasonYear: number | null;
}

export interface RequestUser {
  id: string;
  email: string;
  role: string;
  organizationId: string | null; // null for super_admin users
  organizationSlug: string | null; // null for super_admin users
  /**
   * Feature keys switched off for this user's organization, resolved once per
   * user-context cache miss (never per request). Empty for super_admin, and
   * empty whenever the flag kill-switch is off — the system degrades to
   * "everything enabled", never the reverse.
   */
  disabledFeatures: FeatureKey[];
  /**
   * The organization's current season (calendar year), or null for an org that
   * has never closed one.
   *
   * Carried on the request rather than fetched per endpoint because it rides
   * the users/organizations join AuthGuard already performs, behind the same
   * TTL + generation cache as the feature flags — so season-scoping every
   * report costs zero extra queries. A rollover bumps that generation, which
   * is what makes the new season visible on the other replica.
   *
   * null for super_admin, who reads across organizations and is therefore never
   * season-filtered (see SeasonsService.resolveWindow).
   */
  activeSeasonYear: number | null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  /** Cached JWKS fetcher for the current Supabase project (ECC / RS256 keys). */
  private jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

  /** TTL (ms) for the per-instance user-context cache below. */
  private static readonly USER_CTX_TTL_MS = 60_000;
  /** Hard cap on cached entries; evicted FIFO on overflow. */
  private static readonly USER_CTX_MAX_ENTRIES = 5_000;

  /**
   * Per-replica in-memory cache of `loadUserContext` results, keyed by
   * `${userId}:${role}`. Every authenticated request would otherwise run the
   * users/organizations lookup — at ~30 phones that's ~6 queries/s just for
   * auth. Negative results (soft-deleted / missing user → `null`) are cached
   * too, so a phone with a deleted account can't hammer the DB every request.
   *
   * Map iteration order == insertion order, which gives us cheap FIFO
   * eviction once `USER_CTX_MAX_ENTRIES` is exceeded (see `getUserContext`).
   *
   * Constraint this cache introduces (accepted per plan): deactivating a
   * user (`is_active = false`) now takes up to `USER_CTX_TTL_MS` (60s) to
   * propagate per backend replica — the JWT itself still expires hourly
   * regardless, so this doesn't extend the outer bound on access.
   */
  private readonly userCtxCache = new Map<
    string,
    {
      at: number;
      /**
       * Feature-flag generation this entry was built under. A super-admin write
       * bumps it cluster-wide, so a stale entry is dropped within ~2s instead of
       * riding out the full 60s TTL. Without it the two replicas would expire at
       * independent moments and return on/off/on for the better part of a
       * minute after a toggle — worse than a plain delay, because it reads as a
       * broken switch. See FeaturesCacheService.
       */
      gen: number;
      ctx: UserContext | null;
    }
  >();

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly drizzleProvider: DrizzleProvider,
    private readonly featuresService: FeaturesService,
  ) {}

  /**
   * Load the user row and (when applicable) the org metadata in a single
   * round-trip. Used both to hydrate org claims missing from the JWT and to
   * enforce the `is_active = true` check on every protected request.
   *
   * Returns `null` when the user has been soft-deleted (deleted_at IS NOT NULL)
   * or does not exist.
   */
  private async loadUserContext(userId: string, role: string): Promise<UserContext | null> {
    if (!userId) return null;

    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        u.is_active AS "isActive",
        u.organization_id AS "organizationId",
        o.slug AS "organizationSlug",
        o.feature_overrides AS "featureOverrides",
        o.active_season_year AS "activeSeasonYear"
      FROM users u
      LEFT JOIN organizations o ON o.id = u.organization_id AND o.deleted_at IS NULL
      WHERE u.id = ${userId}::uuid AND u.deleted_at IS NULL
      LIMIT 1
    `);
    const rows = result as unknown as {
      isActive: boolean;
      organizationId: string | null;
      organizationSlug: string | null;
      featureOverrides: FeatureOverrides | null;
      activeSeasonYear: number | null;
    }[];
    const row = rows[0];
    if (!row) return null;

    // super_admin lives outside any org — drop the org fields to mirror the
    // previous behaviour. It therefore has no flags of its own either.
    if (role === 'super_admin') {
      return {
        isActive: row.isActive,
        organizationId: null,
        organizationSlug: null,
        disabledFeatures: [],
        activeSeasonYear: null,
      };
    }

    // Resolved HERE, inside the cached path, so the registry walk happens once
    // per cache miss rather than on every request.
    return {
      isActive: row.isActive,
      organizationId: row.organizationId,
      organizationSlug: row.organizationSlug,
      disabledFeatures: this.featuresService.resolve(row.featureOverrides),
      // Numeric in Postgres, but postgres.js hands back some numerics as
      // strings — coerce here so every consumer can trust the type.
      activeSeasonYear: row.activeSeasonYear == null ? null : Number(row.activeSeasonYear),
    };
  }

  /**
   * `loadUserContext`, fronted by the per-replica TTL cache described above.
   * Hit (fresh) → return the cached value as-is (including cached `null`).
   * Miss / expired → query, then store, evicting the oldest entry first (FIFO
   * via Map insertion order) if we're at capacity.
   */
  private async getUserContext(userId: string, role: string): Promise<UserContext | null> {
    const key = `${userId}:${role}`;
    const now = Date.now();
    // Synchronous and non-blocking: returns the last known value and refreshes
    // in the background, so Redis latency never lands on the request path.
    const gen = this.featuresService.cacheGeneration();
    const cached = this.userCtxCache.get(key);
    if (cached && cached.gen === gen && now - cached.at < AuthGuard.USER_CTX_TTL_MS) {
      return cached.ctx;
    }

    const ctx = await this.loadUserContext(userId, role);

    // Refresh-in-place would leave a stale insertion position, so drop
    // before re-inserting to keep FIFO eviction meaningful for hot keys.
    this.userCtxCache.delete(key);
    if (this.userCtxCache.size >= AuthGuard.USER_CTX_MAX_ENTRIES) {
      const oldestKey = this.userCtxCache.keys().next().value;
      if (oldestKey !== undefined) this.userCtxCache.delete(oldestKey);
    }
    this.userCtxCache.set(key, { at: now, gen, ctx });

    return ctx;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined =
      request.headers?.authorization ?? request.headers?.Authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    const token = authHeader.slice(7);

    try {
      // Peek at the header to determine algorithm without full verification.
      const [headerB64] = token.split('.');
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());

      const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
      // Accept both the modern full-URL issuer and the legacy short "supabase"
      // issuer. This project predates the URL format (its anon key still carries
      // iss:"supabase"), and GoTrue may emit either depending on its version —
      // pinning only the URL form would lock out every real login. The anon /
      // service_role keys are still rejected by the sub/role check below
      // regardless of which issuer they carry, so accepting both is safe.
      const acceptedIssuers = [`${supabaseUrl}/auth/v1`, 'supabase'];

      let payload: jose.JWTPayload;

      if (header.alg === 'HS256') {
        // Legacy JWT signed with the shared HS256 secret (service_role / anon keys).
        const secret = this.configService.getOrThrow<string>('SUPABASE_JWT_SECRET');
        const encodedSecret = new TextEncoder().encode(secret);
        ({ payload } = await jose.jwtVerify(token, encodedSecret, {
          algorithms: ['HS256'],
          issuer: acceptedIssuers,
          audience: EXPECTED_AUDIENCE,
        }));
      } else {
        // Modern asymmetric JWT (ECC P-256 / RS256) — verify via Supabase JWKS.
        if (!this.jwks) {
          this.jwks = jose.createRemoteJWKSet(
            new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
          );
        }
        ({ payload } = await jose.jwtVerify(token, this.jwks, {
          algorithms: ['ES256', 'RS256'],
          issuer: acceptedIssuers,
          audience: EXPECTED_AUDIENCE,
        }));
      }

      // Role lives in app_metadata for ECC tokens, or at the root for legacy tokens.
      const appMeta = payload.app_metadata as Record<string, unknown> | undefined;
      const role =
        (appMeta?.role as string | undefined) ??
        (payload.user_role as string | undefined) ??
        (payload.role as string | undefined) ??
        '';

      let organizationId = (appMeta?.organization_id as string | undefined) ?? null;
      let organizationSlug = (appMeta?.organization_slug as string | undefined) ?? null;

      const sub = (payload.sub as string) ?? '';

      // Reject tokens that aren't a real application user: the Supabase anon
      // and service_role keys are signed with the same SUPABASE_JWT_SECRET but
      // carry no `sub` and a `role` of `anon`/`service_role` — neither is a
      // member of the known UserRole enum. Without this check both keys (the
      // anon key is public, shipped in every client bundle) would sail through
      // as an unauthenticated, org-less identity.
      if (!sub || !KNOWN_USER_ROLES.has(role)) {
        throw new UnauthorizedException('Invalid token identity');
      }

      // Block inactive / soft-deleted users from any protected endpoint, and
      // always DB-derive org membership — never trust a bare/missing org
      // claim from the token as "unscoped". super_admin accounts are exempt
      // from the org lookup (they live outside any org) but still pass
      // through the is_active check to prevent a soft-deleted super_admin
      // from retaining access.
      let disabledFeatures: FeatureKey[] = [];
      let activeSeasonYear: number | null = null;
      if (role !== 'super_admin') {
        const ctx = await this.getUserContext(sub, role);
        if (!ctx) {
          throw new UnauthorizedException('Cont inexistent sau șters');
        }
        if (!ctx.isActive) {
          throw new UnauthorizedException('Cont inactiv');
        }
        organizationId = ctx.organizationId;
        organizationSlug = ctx.organizationSlug;
        disabledFeatures = ctx.disabledFeatures;
        activeSeasonYear = ctx.activeSeasonYear;
      }

      request.user = {
        id: sub,
        email: (payload.email as string) ?? '',
        role,
        organizationId,
        organizationSlug,
        disabledFeatures,
        activeSeasonYear,
      } satisfies RequestUser;

      return true;
    } catch (err) {
      // Surface our own auth-rejection reasons untouched so clients can
      // distinguish "inactive" from "bad token".
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
