---
type: doc
title: "Infrastructure"
created: 2026-04-16
updated: 2026-07-27
tags: [doc, devops, infra, docker, nginx, redis, fleet, tailscale]
status: mature
related:
  - "[[architecture]]"
  - "[[scripts]]"
  - "[[backend]]"
---

# Infrastructure

Production deployment splits into two tiers: the **app tier** (backend ×2, admin ×1, Redis) runs as a Docker Swarm stack (`docker-stack.yml`, stack name `strawboss-app`) on the attachable overlay network `strawboss-net`; the **edge tier** (nginx, certbot) stays on Docker Compose (`docker-compose.yml`). nginx is the shared reverse proxy for all ~7 domains on the VM. Logs are written via Winston (backend/admin) and NDJSON (mobile uploads).

## App Tier — Docker Swarm (`docker-stack.yml`, stack `strawboss-app`)

Three services on external attachable overlay network `strawboss-net`. Deployed via:

```bash
IMAGE_TAG=<git-sha> docker stack deploy -c docker-stack.yml --resolve-image never strawboss-app
```

`./strawboss.sh prod` handles this automatically (see [[scripts]]). Images tagged with git short-sha; no registry — `--resolve-image never` uses locally built images.

| Service | Image | Replicas | Purpose |
|---|---|---|---|
| `strawboss-backend` | `strawboss-backend:${IMAGE_TAG}` | 2 | NestJS API (port 3001 internal) |
| `strawboss-admin` | `strawboss-admin:${IMAGE_TAG}` | 1 | Next.js admin (port 3000 internal) |
| `redis` | `redis:7-alpine` | 1 | BullMQ job queues (port 6379 internal) |

Service names are deliberately prefixed `strawboss-` to prevent the nginx alias-collision problem with foreign-app containers on the shared bridge (see [[architecture]]).

### Swarm Volumes

- `redis-data` (named Docker volume) — Redis persistence
- `/srv/apps/Strawboss/logs:/app/logs` (absolute host bind mount) — Winston log files; both backend replicas write here
- `/srv/apps/Strawboss/uploads:/app/uploads` (absolute host bind mount) — uploaded files (backend only)

**Single-node constraint**: `logs` and `uploads` are host-local bind mounts, so both backend replicas stay on the single Swarm node. Multi-node scale requires shared/object storage for uploads first.

### Rolling Deploy (health-gated)

All services use `update_config: order: start-first, parallelism: 1, monitor: 30s, failure_action: rollback`. The new task must pass its healthcheck within the `monitor` window before the old task stops; on failure the stack auto-rolls back. Verified: 260/260 HTTP 200 during a forced rolling redeploy; 130/130 during a killed-task failover.

### Swarm Init (one-time)

```bash
docker swarm init --advertise-addr 127.0.0.1
docker network create --driver overlay --attachable strawboss-net
```

## Edge Tier — Docker Compose (`docker-compose.yml`)

Two services only — nginx and certbot. Do NOT add backend/admin/redis back here.

| Service | Image | Ports | Purpose |
|---|---|---|---|
| `nginx` | `nginx:alpine` | 80, 443 (public) | TLS termination + reverse proxy for all VM domains |
| `certbot` | `certbot/certbot` | — | Auto-renews certs every 12h |

nginx is attached to **both** `strawboss_default` (bridge — reaches foreign-app containers by name) **and** `strawboss-net` (overlay — reaches Swarm service VIPs). Recreating the nginx container (`docker compose up -d nginx`) causes a brief blip across all domains — do this intentionally.

### Edge Volumes

- `letsencrypt` — SSL certificates (shared between nginx and certbot)
- `certbot-webroot` — ACME HTTP-01 challenge files

## Backend Dockerfile (`Dockerfile.backend`)

Multi-stage build (node:22-alpine):

1. **deps**: Copy package.json files for types, validation, domain, backend. `pnpm install --frozen-lockfile` with cache mount.
2. **builder**: Copy source, build packages in order: `types -> validation -> domain -> backend`.
3. **runner**: Production image. Copies `.pnpm` virtual store + package dist/node_modules. Creates non-root `appuser`. Runs `node dist/main.js`.

Health check: `wget --spider -q http://127.0.0.1:3001/api/v1/health` (interval 10s, 5 retries, 40s start period). Uses `127.0.0.1` not `localhost` — busybox wget may resolve `localhost` to `::1` (IPv6) first while NestJS binds IPv4 only.

## Admin Dockerfile (`Dockerfile.admin`)

Multi-stage build (node:22-alpine):

1. **deps**: Copy package.json files for types, validation, ui-tokens, **domain**, api, admin-web. `pnpm install --frozen-lockfile`.
2. **builder**: Build packages in order: `types -> validation -> ui-tokens -> domain -> api -> admin-web`. `NEXT_PUBLIC_*` vars passed as build args (baked into client bundle).
3. **runner**: Uses Next.js standalone output. Copies `.next/standalone`, `.next/static`, `public`. Runs `node apps/admin-web/server.js`. Requires `HOSTNAME=0.0.0.0` at runtime — Swarm sets `HOSTNAME` to the container name by default; Next.js standalone would bind only that IP, causing healthchecks on `127.0.0.1` to fail. `experimental.preloadEntriesOnStart: false` in `next.config.ts` prevents slow binds under task-start contention.

**`@strawboss/domain` gotcha (fixed 2026-07-13, commit `7e9c915`):** admin-web imports `composeAuxStage()` from `@strawboss/domain` (see [[architecture]] Auxiliary Trips) but for a while did not declare the dependency in `apps/admin-web/package.json`, and `Dockerfile.admin` did not copy `packages/domain/` at all. This was invisible locally — `tsc`/Node module resolution walks *up* the directory tree and silently found `@strawboss/domain` in the monorepo-root `node_modules`, so every local typecheck and `pnpm --filter @strawboss/admin-web build` outside Docker passed — but fatal in the Docker build, which installs only the explicitly declared dependency graph (`Module not found: @strawboss/domain`). Lesson: an undeclared workspace dependency only surfaces in the one environment (Docker) that actually enforces the package manifest: don't trust a green local typecheck alone when a package boundary changes. Fixed by declaring `@strawboss/domain` in `apps/admin-web/package.json` and adding it to both the `deps` and `builder` stages above.

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

**gzip (traffic diet F0)**: `gzip on`, `gzip_comp_level 5`, `gzip_min_length 1024`, `gzip_proxied any`, `gzip_vary on`, `gzip_types application/json application/geo+json text/plain`. The backend (Fastify, no `@fastify/compress`) proxies uncompressed JSON, so nginx does the compression at the edge — sync pull and parcels GeoJSON responses shrink 8-10x. `gzip_proxied any` is required because every response nginx serves here is itself a proxied response (from the backend or admin upstream); without it nginx would refuse to compress.

Routing:
- `= /api/client-log` -> `strawboss-admin:3000` (admin Next.js handles browser client-log batching).
- `/api/*` -> `strawboss-backend:3001` (NestJS Swarm VIP). 60s read timeout. Sets `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`.
- `/*` -> `strawboss-admin:3000` (Next.js Swarm VIP). Supports WebSocket upgrade (`Upgrade: $http_upgrade`).

Uses Docker embedded DNS resolver (`127.0.0.11 valid=10s ipv6=off`) for Swarm VIP DNS resolution and to handle container IP changes.

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

## Tailscale Fleet Remote Access

The ~30 Device-Owner fleet phones join the same tailnet as the production VM. This enables two capabilities: a live online/offline dot in the super-admin UI, and direct `adb` shell access to any phone without physical USB access.

### Tailnet

- **Tailnet**: `tail2b4c34.ts.net`
- The VM runs `tailscaled` as the dev/ops user (`miro`). The backend Docker container lives on a bridge network and **cannot** reach the tailnet or run `adb` — all fleet host commands run on the VM itself via `scripts/10-fleet.sh`.
- `adb` must be installed on the host (`sudo apt-get install -y android-tools-adb`).

### Credentials / Secrets

Tailscale auth key and OAuth client credentials (client ID + client secret) are stored in the `app_settings` DB table — **never** in the repository. The super-admin UI reads/writes them via:

- `GET /api/v1/super-admin/settings/tailscale` — returns masked view (`tailscaleAuthKeySet`, `tailscaleOauthConfigured`, `tailscaleTailnet`, `tailscaleTag`, `tailscaleApkSet`, `updatedAt`; raw secrets are never returned).
- `PUT /api/v1/super-admin/settings/tailscale` — updates `authKey`, `tailnet`, `oauthClientId`, `oauthClientSecret`, `tag`; send `''` to clear, omit to leave unchanged.

Per-device ephemeral keys are issued via the OAuth client so each phone gets a short-lived key that auto-expires on revocation.

### Tailscale APK hosting

The official Tailscale APK is hosted at `{UPLOADS_ROOT}/tailscale/tailscale.apk` for zero-touch install on managed phones. Uploaded via `POST /api/v1/super-admin/settings/tailscale-apk` (multipart `apk` field, 250 MB limit); SHA-256 and size are recorded in `app_settings`. This allows the mobile OTA check-in response to carry a `tailscaleApkUrl` so a newly provisioned Device-Owner phone can install Tailscale without hitting the Play Store.

### Status sync — systemd timer

The backend container cannot query the tailnet, so a host-side systemd timer feeds the red/green dot in the UI:

**Unit files**: `deploy/systemd/strawboss-fleet-sync.service` and `strawboss-fleet-sync.timer`

**Service** (`strawboss-fleet-sync.service`):
- `Type=oneshot`, runs as `User=miro`, `WorkingDirectory=/srv/apps/Strawboss`
- `ExecStart=/srv/apps/Strawboss/strawboss.sh fleet:tailscale-sync`
- `After=network-online.target tailscaled.service`

**Timer** (`strawboss-fleet-sync.timer`):
- `OnBootSec=2min`, `OnUnitActiveSec=60`, `AccuracySec=15s`
- Fires every ~60 seconds after first activation

**Install / remove**:
```bash
./strawboss.sh fleet:install-sync-timer     # sudo cp units → /etc/systemd/system, daemon-reload, enable --now
./strawboss.sh fleet:uninstall-sync-timer   # disable --now, rm units, daemon-reload
```

**Logs**: `journalctl -u strawboss-fleet-sync.service -f`

### ADB-over-TCP (one-time per phone)

Android does not allow non-root processes to persist `adb` TCP mode across reboots. The flow is:

1. Connect phone via USB with USB debugging authorized.
2. Run `./strawboss.sh fleet:enable-adb-tcp` — calls `adb tcpip 5555`.
3. Unplug USB. Phone is now reachable at `<tailscale-ip>:5555` until next reboot.
4. After a reboot, repeat step 2.

### ADB tunnel

```bash
./strawboss.sh fleet:tunnel "combina-man"
# Also accepts free-form nicknames: fleet:tunnel "Combina MAN"
# Arg is normalized to [a-z0-9-] — neutralizes shell/SQL metacharacters.
```

Resolution order: DB `tailscale_ip` (from last sync) → live `tailscale status --json` fallback → error with hint.

See [[scripts]] for full command reference, [[architecture]] for the Fleet Tailscale subsystem design.
