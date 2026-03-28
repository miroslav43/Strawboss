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

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export interface RequestUser {
  id: string;
  email: string;
  role: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  /** Cached JWKS fetcher for the current Supabase project (ECC / RS256 keys). */
  private jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

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

    // Peek at the header to determine algorithm without full verification.
    const [headerB64] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());

    try {
      let payload: jose.JWTPayload;

      if (header.alg === 'HS256') {
        // Legacy JWT signed with the shared HS256 secret (service_role / anon keys).
        const secret = this.configService.getOrThrow<string>('SUPABASE_JWT_SECRET');
        const encodedSecret = new TextEncoder().encode(secret);
        ({ payload } = await jose.jwtVerify(token, encodedSecret, {
          algorithms: ['HS256'],
        }));
      } else {
        // Modern asymmetric JWT (ECC P-256 / RS256) — verify via Supabase JWKS.
        if (!this.jwks) {
          const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
          this.jwks = jose.createRemoteJWKSet(
            new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
          );
        }
        ({ payload } = await jose.jwtVerify(token, this.jwks, {
          algorithms: ['ES256', 'RS256'],
        }));
      }

      // Role lives in app_metadata for ECC tokens, or at the root for legacy tokens.
      const appMeta = payload.app_metadata as Record<string, unknown> | undefined;
      const role =
        (appMeta?.role as string | undefined) ??
        (payload.user_role as string | undefined) ??
        (payload.role as string | undefined) ??
        '';

      request.user = {
        id: (payload.sub as string) ?? '',
        email: (payload.email as string) ?? '',
        role,
      } satisfies RequestUser;

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
