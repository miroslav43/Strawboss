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
import { UserRole } from '@strawboss/types';
import { DrizzleProvider } from '../database/drizzle.provider';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Known application roles. Excludes Supabase's built-in `anon`/`service_role`. */
const KNOWN_USER_ROLES: ReadonlySet<string> = new Set<string>(Object.values(UserRole));

/** Supabase JWTs are always issued for this audience. */
const EXPECTED_AUDIENCE = 'authenticated';

export interface RequestUser {
  id: string;
  email: string;
  role: string;
  organizationId: string | null; // null for super_admin users
  organizationSlug: string | null; // null for super_admin users
}

@Injectable()
export class AuthGuard implements CanActivate {
  /** Cached JWKS fetcher for the current Supabase project (ECC / RS256 keys). */
  private jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly drizzleProvider: DrizzleProvider,
  ) {}

  /**
   * Load the user row and (when applicable) the org metadata in a single
   * round-trip. Used both to hydrate org claims missing from the JWT and to
   * enforce the `is_active = true` check on every protected request.
   *
   * Returns `null` when the user has been soft-deleted (deleted_at IS NOT NULL)
   * or does not exist.
   */
  private async loadUserContext(
    userId: string,
    role: string,
  ): Promise<{
    isActive: boolean;
    organizationId: string | null;
    organizationSlug: string | null;
  } | null> {
    if (!userId) return null;

    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        u.is_active AS "isActive",
        u.organization_id AS "organizationId",
        o.slug AS "organizationSlug"
      FROM users u
      LEFT JOIN organizations o ON o.id = u.organization_id AND o.deleted_at IS NULL
      WHERE u.id = ${userId}::uuid AND u.deleted_at IS NULL
      LIMIT 1
    `);
    const rows = result as unknown as {
      isActive: boolean;
      organizationId: string | null;
      organizationSlug: string | null;
    }[];
    const row = rows[0];
    if (!row) return null;

    // super_admin lives outside any org — drop the org fields to mirror the
    // previous behaviour.
    if (role === 'super_admin') {
      return { isActive: row.isActive, organizationId: null, organizationSlug: null };
    }
    return row;
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
      const expectedIssuer = `${supabaseUrl}/auth/v1`;

      let payload: jose.JWTPayload;

      if (header.alg === 'HS256') {
        // Legacy JWT signed with the shared HS256 secret (service_role / anon keys).
        const secret = this.configService.getOrThrow<string>('SUPABASE_JWT_SECRET');
        const encodedSecret = new TextEncoder().encode(secret);
        ({ payload } = await jose.jwtVerify(token, encodedSecret, {
          algorithms: ['HS256'],
          issuer: expectedIssuer,
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
          issuer: expectedIssuer,
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
      if (role !== 'super_admin') {
        const ctx = await this.loadUserContext(sub, role);
        if (!ctx) {
          throw new UnauthorizedException('Cont inexistent sau șters');
        }
        if (!ctx.isActive) {
          throw new UnauthorizedException('Cont inactiv');
        }
        organizationId = ctx.organizationId;
        organizationSlug = ctx.organizationSlug;
      }

      request.user = {
        id: sub,
        email: (payload.email as string) ?? '',
        role,
        organizationId,
        organizationSlug,
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
