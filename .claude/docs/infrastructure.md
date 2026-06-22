---
type: doc
title: "Infrastructure"
created: 2026-04-16
updated: 2026-06-22
tags: [doc, devops, infra, docker, nginx, redis]
status: mature
related:
  - "[[architecture]]"
  - "[[scripts]]"
  - "[[backend]]"
---

# Infrastructure

Production deployment uses Docker Compose with nginx reverse proxy, Let's Encrypt SSL, and Redis for BullMQ. Logs are written via Winston (backend/admin) and NDJSON (mobile uploads).

## Docker Services (`docker-compose.yml`)

Five services, three named volumes:

| Service | Image | Ports | Purpose |
|---|---|---|---|
| `backend` | `Dockerfile.backend` | 3001 (internal) | NestJS API server |
| `admin` | `Dockerfile.admin` | 3000 (internal) | Next.js admin dashboard |
| `nginx` | `nginx:alpine` | 80, 443 (public) | TLS termination + reverse proxy |
| `certbot` | `certbot/certbot` | -- | Auto-renews cert every 12h |
| `redis` | `redis:7-alpine` | 6379 (internal) | BullMQ job queues |

### Volumes

- `redis-data` -- Redis persistence
- `letsencrypt` -- SSL certificates (shared between nginx and certbot)
- `certbot-webroot` -- ACME HTTP-01 challenge files
- `./logs:/app/logs` -- Bind mount for Winston log files (backend + admin)

### Service Dependencies

```
nginx -> backend -> redis
      -> admin   -> backend
certbot (standalone, shares volumes with nginx)
```

## Backend Dockerfile (`Dockerfile.backend`)

Multi-stage build (node:22-alpine):

1. **deps**: Copy package.json files for types, validation, domain, backend. `pnpm install --frozen-lockfile` with cache mount.
2. **builder**: Copy source, build packages in order: `types -> validation -> domain -> backend`.
3. **runner**: Production image. Copies `.pnpm` virtual store + package dist/node_modules. Creates non-root `appuser`. Runs `node dist/main.js`.

Health check: `wget --spider -q http://localhost:3001/api/v1/health` (interval 10s, 5 retries, 20s start period).

## Admin Dockerfile (`Dockerfile.admin`)

Multi-stage build (node:22-alpine):

1. **deps**: Copy package.json files for types, validation, api, ui-tokens, admin-web. `pnpm install --frozen-lockfile`.
2. **builder**: Build packages in order: `types -> validation -> ui-tokens -> api -> admin-web`. `NEXT_PUBLIC_*` vars passed as build args (baked into client bundle).
3. **runner**: Uses Next.js standalone output. Copies `.next/standalone`, `.next/static`, `public`. Runs `node apps/admin-web/server.js`.

### Build Args

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_API_URL` (defaults to `https://nortiauno.com`)

## Nginx Configuration (`nginx/conf.d/`)

nginx config is split into per-virtual-host files under `nginx/conf.d/`:

| File | Purpose |
|---|---|
| `10-nortiauno.com.conf` | Primary site: admin-web + backend proxy, HTTPS |
| `20-video.tedde-auto.ro.conf` | Secondary virtual host |
| (other `NN-*.conf` files) | Additional virtual hosts |

The old monolithic `nginx/nginx.conf` has been replaced by this split layout. `nginx/nginx.conf.legacy` is kept as a backup reference.

The `nginx` Docker service mounts `./nginx/conf.d:/etc/nginx/conf.d:ro`.

### HTTP Server (port 80)

- Serves Let's Encrypt ACME challenge at `/.well-known/acme-challenge/` from `/var/www/certbot`.
- Redirects all other traffic to HTTPS with 301.

### HTTPS Server (port 443)

TLS configuration:
- Protocols: TLSv1.2, TLSv1.3
- Ciphers: HIGH:!aNULL:!MD5
- Session cache: shared:SSL:10m, timeout 10m
- HSTS: 31536000s with includeSubDomains

Security headers: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

Routing:
- `/api/*` -> `http://backend:3001` (NestJS). 60s read timeout. Sets `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`.
- `/*` -> `http://admin:3000` (Next.js). Supports WebSocket upgrade (`Upgrade: $http_upgrade`).

Uses Docker embedded DNS resolver (`127.0.0.11 valid=10s`) to handle container IP changes after recreations.

### Nginx Entrypoint (`nginx/docker-entrypoint.sh`)

If no Let's Encrypt cert exists at `/etc/letsencrypt/live/nortiauno.com/fullchain.pem`, generates a self-signed placeholder cert so nginx can start. The placeholder allows the ACME challenge to be served on port 80 before real certs are obtained.

## SSL / Let's Encrypt

First-time setup:
```bash
./strawboss.sh docker:up nginx    # Start nginx on port 80
./strawboss.sh ssl:init           # Issue cert via HTTP-01 challenge
./strawboss.sh docker:up          # Restart all services with HTTPS
```

The `ssl:init` command:
1. Starts nginx for the ACME challenge.
2. Runs certbot with `--webroot -w /var/www/certbot -d nortiauno.com -d www.nortiauno.com`.
3. Reloads nginx with the new certificate.

The certbot service auto-renews every 12 hours in a background loop.

## Redis

`redis:7-alpine` with password authentication (`--requirepass ${REDIS_PASSWORD}`). Internal only (no port binding). Used by BullMQ for background job queues:

| Queue | Schedule |
|---|---|
| `alert-evaluation` | Every 15 minutes |
| `reconciliation` | Hourly |
| `cmr-generation` | On-demand |
| `farmtrack-sync` | Every 5 minutes |
| `sync-cleanup` | Daily at 02:00 |

## Environment Variables (`.env.example`)

### Required for Production

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL (server-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin operations |
| `SUPABASE_JWT_SECRET` | JWT verification secret |
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL (client-side, baked into build) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (client-side) |
| `NEXT_PUBLIC_API_URL` | API origin browsers use (e.g., `https://nortiauno.com`) |
| `REDIS_PASSWORD` | Redis auth password (default: `changeme`) |
| `CERTBOT_EMAIL` | Email for Let's Encrypt notifications |

### Optional

| Variable | Description |
|---|---|
| `ANDROID_HOME` | Android SDK path for mobile builds |
| `NEXT_DEV_API_PROXY_URL` | Dev proxy target (default: `http://localhost:3001`) |
| `LOG_ROOT` | Root directory for log files (Docker sets `/app/logs`) |
| `FIREBASE_SERVICE_ACCOUNT` | JSON service-account key for `firebase-admin`. If absent, the OTA acceleration FCM push is silently disabled; phones still receive updates via the poll-based check-in. Required only if you want FCM to nudge phones to check in sooner after a deployment is activated. |

## Logging

### Winston (Backend + Admin Web)

File tree under `LOG_ROOT` (or `./logs` locally):
```
logs/
  web/
    all/YYYY-MM-DD.log        # All levels
    error/YYYY-MM-DD.log      # Error only
    warn/YYYY-MM-DD.log       # Warnings
    info/YYYY-MM-DD.log       # Info
    debug/YYYY-MM-DD.log      # Debug
    flow/YYYY-MM-DD.log       # Business events (trips, assignments, geofence)
    http/YYYY-MM-DD.log       # HTTP request/response (with X-Request-Id)
  mobile/
    all/YYYY-MM-DD.log        # Uploaded from devices
```

Daily rotation, 7-day retention (`maxFiles: '7d'`).

### Mobile Log Upload

After successful sync, the mobile app uploads today's NDJSON logs to `POST /api/v1/logs/mobile`. Local files are deleted on success. See [sync-protocol.md](sync-protocol.md) for details.

## OTA Signing Keystore Guard

The ~30 Device-Owner phones self-install APKs via Android's PackageInstaller. Android enforces that every new APK is signed by **the same key** as the installed app. Changing `apps/mobile/android/app/debug.keystore` breaks OTA self-update for every fielded phone — each one would need a manual re-sideload of the first APK signed under the new key.

Three layers enforce the pin:

### 1. `scripts/verify-keystore.sh`

Computes the SHA-256 of `apps/mobile/android/app/debug.keystore` and compares it to a hardcoded expected value (`221e0a3106aa4c3ccc154e0a418b55020b3f9ea6e84f92e8749cd9e2f39f5e58`). Exits non-zero with an explanatory message if the digest differs. See [[scripts]] for full details.

### 2. `.githooks/pre-commit`

Two checks run on every commit:

1. **Hard block** — if `git diff --cached --name-only` includes `apps/mobile/android/app/debug.keystore`, the commit is rejected immediately before any hash check.
2. **Belt-and-suspenders fingerprint check** — calls `sh scripts/verify-keystore.sh` to confirm the on-disk file still matches the pinned digest (guards against unstaged modifications).

The hook is activated automatically for every developer by the root `prepare` npm script (`git config core.hooksPath .githooks`), which runs on `pnpm install`.

### 3. `.github/workflows/keystore-guard.yml`

CI check that runs `sh scripts/verify-keystore.sh` on every push and pull request (all branches). This is the real safety net: it cannot be bypassed by `git commit --no-verify` (which only skips the local hook).

```yaml
on:
  push:
    branches: ['**']
  pull_request:
```

### APK Storage

Uploaded APKs are stored under `UPLOADS_ROOT/apks/<uuid>.apk` (the `apk_key` column in `app_releases`). The backend serves them via the existing signed-URL mechanism (`signUploadUrl` / `UPLOADS_URL_PREFIX`). The subdirectory is created automatically on first APK upload (`fsp.mkdir(dir, { recursive: true })`).

The maximum APK upload size is 250 MB (enforced per-request in `FleetAdminController`, overriding the global 3 MB multipart limit). The sha256 is computed server-side during streaming write and stored in `app_releases.sha256`; the mobile client verifies this digest before invoking PackageInstaller.

### Admin Web Client Logs

Browser logs are batched to `POST /api/client-log` (rate-limited). The `onApiError` hook on `ApiClient` records failed API calls.
