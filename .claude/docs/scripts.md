---
type: doc
title: "Scripts (strawboss.sh)"
created: 2026-04-16
updated: 2026-07-31
tags: [doc, scripts, tooling, bash, fleet, tailscale]
status: mature
related:
  - "[[architecture]]"
  - "[[infrastructure]]"
  - "[[feature-toggles]]"
---

# Scripts

`strawboss.sh` is the monorepo orchestrator. It sources `scripts/_lib.sh` and all `scripts/*.sh` files, then dispatches commands to matching `cmd_*()` functions.

**Source:** `strawboss.sh`, `scripts/`

## Orchestrator Pattern (`strawboss.sh`)

### How It Works

1. Sets `STRAWBOSS_ROOT` to the script's directory and `cd`s there.
2. Sources `scripts/_lib.sh` (shared helpers).
3. Sources all `scripts/[!_]*.sh` files (category scripts, sorted by filename).
4. If command is `help`, scans all scripts for `@cmd` and `@section` annotations to generate help text.
5. Otherwise, converts the command name to a function name and calls it.

### Naming Convention

Command `foo:bar-baz` maps to function `cmd_foo__bar__baz()` (colons and hyphens become double underscores).

### Adding a New Command

1. Open (or create) the relevant `scripts/<NN>-<category>.sh`.
2. Add a `@section` annotation if starting a new category.
3. Add the function with `@cmd` annotation:
```bash
# @cmd my-command "Description shown in help"
cmd_my__command() {
  header "My Command"
  # implementation
}
```
4. The command appears in help and routing automatically.

## Shared Library (`scripts/_lib.sh`)

### OS Detection

`$STRAWBOSS_OS` is set to `macos` or `linux` based on `uname -s`. Cross-platform wrappers use this to select the right flag syntax.

### Output Helpers

| Function | Purpose |
|---|---|
| `info(msg)` | Blue dot + message |
| `success(msg)` | Green checkmark + message |
| `warn(msg)` | Yellow warning + message |
| `error(msg)` | Red X + message (stderr) |
| `header(msg)` | Box-drawn section header |
| `divider()` | Horizontal line |
| `section(msg)` | Bold white section label |
| `require_cmd(name)` | Exit with error if command not found |

### Cross-Platform Wrappers

| Function | Purpose |
|---|---|
| `_stat_mtime(file)` | File modification time (epoch seconds) |
| `_stat_size(file)` | File size in bytes |
| `_dir_bytes(dir)` | Directory size in bytes |
| `_human_size(bytes)` | Format bytes as human-readable (KB/MB/GB) |
| `_port_open(port)` | Check if TCP port is listening (ss/lsof) |
| `_port_process(port)` | Get PID of process on port |
| `_kill_port(port)` | Kill processes on port |
| `_time_ago(epoch)` | Format timestamp as "Nm ago" / "Nh ago" |

### Project Helpers

| Function | Purpose |
|---|---|
| `_free_dev_ports()` | Kill processes on 3000, 3001, 19000, 19001, 8081 |
| `_ensure_env()` | Copy `.env.example` to `.env` if missing |
| `_load_env()` | Source `.env` file (calls `_ensure_env` first) |
| `_build_packages()` | Build all shared packages in order: types, validation, ui-tokens, domain, api |
| `_ensure_dev_redis()` | Start Redis container via `docker compose up -d redis` |
| `_validate_prod_env()` | Check required env vars for production |
| `_mobile_resolve_android_home()` | Find Android SDK from env, .env, or common paths |

## Commands by Category

### Main (`scripts/01-main.sh`)

| Command | Description |
|---|---|
| `setup` | Install deps, copy .env, apply DB migrations, build packages |
| `dev` | Free ports, start Redis, build packages, run backend + admin-web dev |
| `prod` | Build + rolling-deploy the Swarm app tier (`stack:deploy`); start shared nginx/certbot only if not already running; issue SSL if needed |
| `stop` | Kill dev processes on ports; remove the Swarm app-tier stack (`strawboss-app`); shared nginx/certbot and other VM apps stay running |

### Mobile (`scripts/02-mobile.sh`)

| Command | Description |
|---|---|
| `mobile-dev` | Start Expo dev server (builds shared packages first) |
| `mobile-build` | Android APK via Expo EAS cloud build |
| `mobile-build-local` | Android APK via local Gradle (`debug` or `release`, optional `--fast` to skip `gradlew clean`) |
| `mobile-install` | Install APK on connected device via adb (auto-finds latest APK) |

#### Release-build auto-archive (`_mobile_register_release`)

When `mobile-build-local release` succeeds, the shell function `_mobile_register_release` runs automatically:

1. **Version bump** — `apps/mobile/scripts/bump-version.mjs` increments `android.versionCode` by 1 and the version patch by 1 in `app.json` before `expo prebuild`. This ensures Android's PackageInstaller always accepts the OTA self-update (it rejects same/lower versionCode).

2. **APK naming** — the output APK is copied to `<UPLOADS_ROOT>/apks/` with the descriptive filename: `strawboss-v<version>-vc<versionCode>-<gitshort>.apk`. The subdirectory is created automatically.

3. **DB registration** — using `psql "$DATABASE_URL"`, the function runs an idempotent upsert into `app_releases`:
   ```sql
   INSERT INTO app_releases (id, version, version_code, apk_key, sha256, size_bytes, changelog, mandatory, status)
   VALUES (...) ON CONFLICT (version_code) WHERE deleted_at IS NULL
   DO UPDATE SET apk_key = ..., sha256 = ..., status = 'published', updated_at = now();
   ```
   The `changelog` field is set to `"<gitshort> — <last commit subject>"`. Status is always `published`.

4. **Prune to newest 10** — immediately after insert, a `WITH ranked AS (...)` CTE soft-deletes (`deleted_at = now()`) all rows beyond the top 10 by `version_code DESC`, and physically removes their APK files from disk — but only if no `ota_deployments` row with `status IN ('pending', 'active')` references them.

**Best-effort**: if `psql` is not on PATH or `DATABASE_URL` is unset, the function warns and returns 0 — the APK is still built and can be uploaded from the UI (Fleet → Releases).

See [[architecture]] for the OTA/Fleet subsystem, [[infrastructure]] for APK storage path.

### Fleet (`scripts/10-fleet.sh`)

Host-side utilities for Tailscale remote access to the ~30 Device-Owner fleet phones. The backend container lives on a bridge network and cannot reach the tailnet or run `adb`, so these run directly on the VM.

| Command | Description |
|---|---|
| `fleet:tailscale-sync` | Sync `tailscale status --json` into the `devices` table (drives the red/green online dot in the super-admin UI) |
| `fleet:tunnel <hostname>` | Open an `adb` shell to a fleet phone over Tailscale; arg is normalized to `[a-z0-9-]` (also accepts free nicknames like "Combina MAN") |
| `fleet:status` | Tabular view of all devices: name, tailscale online state, tailnet IP, last tailscale seen, last app check-in |
| `fleet:enable-adb-tcp` | One-time per-phone: over USB, runs `adb tcpip 5555` to enable ADB-over-TCP (resets on Android reboot — non-root limit) |
| `fleet:install-sync-timer` | Install + start the systemd timer (`deploy/systemd/strawboss-fleet-sync.{service,timer}`) that runs `fleet:tailscale-sync` every 60 s |
| `fleet:uninstall-sync-timer` | Stop and remove the fleet sync timer |

#### `fleet:tailscale-sync` internals

Pipes `tailscale status --json` into `scripts/tailscale-sync.mjs`, which emits SQL:

1. First statement: `UPDATE devices SET tailscale_online = false WHERE deleted_at IS NULL` — resets everyone so phones that dropped off the tailnet go red.
2. For each online peer (`p.Online == true`): updates `tailscale_online = true`, `tailscale_ip` (first IP from `TailscaleIPs[]`), `tailscale_last_seen` (from `p.LastSeen` or `now()`), matched via `tailscale_hostname = lower(p.HostName)`.

#### `fleet:tunnel` resolution order

1. Looks up `tailscale_ip` from `devices` table by `tailscale_hostname` (keyed on the normalized arg).
2. Falls back to live `tailscale status --json` parsed in-process via Node.js if the DB has no IP.
3. Connects via `adb connect <ip>:5555`, then opens an interactive `adb shell`.

#### Prerequisite: ADB-over-TCP

`adb tcpip 5555` must be run once per phone over USB before wireless/tailnet tunneling works. Android resets this on every reboot (non-root security limit). Use `fleet:enable-adb-tcp` while the phone is USB-connected with USB debugging authorized.

See [[infrastructure]] for the systemd timer and Tailscale fleet setup.

### Status & Diagnostics (`scripts/03-status.sh`)

| Command | Description |
|---|---|
| `status` | Full dashboard: env, package builds, ports, Docker services, disk usage, git |
| `health` | Run all health checks with pass/fail summary (prereqs, builds, services, connectivity) |
| `doctor` | Diagnose issues and suggest fixes (stale builds, missing deps) |
| `info` | Show runtime versions, SDK info, env vars, project metadata |
| `ports` | Show all dev port usage (3000, 3001, 6379, 5432, 19000, 8081, 80, 443) |
| `size` | Disk usage breakdown by package, app, node_modules, logs, .git |

### Build & Code Quality (`scripts/04-build.sh`)

| Command | Description |
|---|---|
| `install` | `pnpm install` |
| `build [target]` | Build specific target: `types`, `validation`, `ui-tokens`, `domain`, `api`, `backend`, `admin`, `packages`, `all` |
| `typecheck [target]` | TypeScript check (runs all packages or a specific one) |
| `lint` | ESLint across all packages |
| `clean` | Remove `dist/` and `.next/` build artifacts + `.tsbuildinfo` + `.turbo` |
| `clean:all` | Remove dist/ AND all `node_modules/` |

Build targets respect dependency order. For example, `build backend` first builds types, validation, and domain before building the backend itself.

### Database (`scripts/05-db.sh`)

| Command | Description |
|---|---|
| `db:migrate` | Apply all `supabase/migrations/*.sql` via psql (single-transaction per file, skip on duplicate) |
| `db:seed` | Run `supabase/seed.sql` |
| `db:reset` | Migrate + seed |
| `db:status` | Check DB connectivity, show table/row counts |

### Docker (`scripts/06-docker.sh`)

| Command | Description |
|---|---|
| `docker:build` | Build Docker images (`docker compose build`) |
| `docker:up [svc...]` | Start Docker services (optional specific services) |
| `docker:down [svc...]` | Stop Docker services |
| `docker:logs [svc...]` | Tail Docker service logs |
| `docker:fix-volume-perms` | Fix `logs/` + `uploads/` ownership for Docker (appuser UID 100) |
| `ssl:init` | Issue Let's Encrypt cert for nortiauno.com via HTTP-01 challenge |

#### Swarm — app-tier production (`scripts/06-docker.sh`)

The production app tier (backend ×2, admin ×1, redis ×1) runs as a Swarm stack named `strawboss-app` on a single-node Swarm. This enables health-gated rolling deploys with zero downtime. The shared nginx + certbot remain on Compose (`docker-compose.yml`) and are NOT part of the stack. See [[infrastructure]] for `docker-stack.yml` and the overlay network setup.

| Command | Description |
|---|---|
| `stack:deploy` | Build tagged images via `docker build -f Dockerfile.{backend,admin}` then `docker stack deploy -c docker-stack.yml --resolve-image never strawboss-app`; health-gated rolling update with auto-rollback |
| `stack:status` | Show Swarm services and running tasks for the app tier |
| `stack:logs [svc]` | Tail a Swarm service log; `svc` is `strawboss-backend` (default), `strawboss-admin`, or `redis` |
| `stack:rollback [backend\|admin]` | `docker service rollback` the named service to its previous image (default: `backend`) |
| `stack:rm` | Remove the app-tier stack; nginx/certbot and other VM apps stay running |
| `scale <backend\|admin> <n>` | `docker service scale` the named service to `n` replicas |

**Internal helpers** (called by `stack:deploy` / `prod`; not invoked directly):

- `_ensure_swarm` — idempotent: initializes single-node Swarm if needed, creates the attachable overlay network `strawboss-net`, and attaches the running nginx container to it so nginx can reach the Swarm service VIPs. Safe to run on every deploy.
- `_build_prod_images` — builds `strawboss-backend` and `strawboss-admin` images tagged with the current git short-SHA and `:latest`. The Dockerfiles are self-contained (workspace install + build happen inside the image); no host-side `pnpm install` or `_build_packages` call is needed for production builds.

### Logs (`scripts/07-logs.sh`)

| Command | Description |
|---|---|
| `logs` | Tail today's `web/all` log |
| `logs:error` | Tail today's `web/error` log |
| `logs:flow` | Tail today's `web/flow` log (business events) |
| `logs:http` | Tail today's `web/http` log |
| `logs:mobile` | Tail today's `mobile/all` log |
| `logs:count` | Show log file sizes and line counts for today |
| `logs:clean` | Delete all log files |

All log commands use `_logs_today_path(category)` which resolves to `$STRAWBOSS_ROOT/logs/<category>/YYYY-MM-DD.log`.

## Security Scripts

### `scripts/verify-keystore.sh`

Pins the Android OTA signing keystore by SHA-256. Used by the pre-commit hook and CI.

**Why this matters:** The ~30 Device-Owner phones self-install OTA APKs via Android's PackageInstaller. Android requires every new APK to be signed with the **same key** as the installed one. The signing config in `apps/mobile/android/app/build.gradle` points at `apps/mobile/android/app/debug.keystore`. If this file ever changes, every phone already in the field can no longer silently self-update — each needs a manual re-sideload.

**What it does:**

1. Reads `apps/mobile/android/app/debug.keystore`.
2. Computes SHA-256 (`sha256sum` on Linux, `shasum -a 256` on macOS).
3. Compares against `EXPECTED="221e0a3106aa4c3ccc154e0a418b55020b3f9ea6e84f92e8749cd9e2f39f5e58"`.
4. Exits non-zero (with an explanatory message) if the digest differs.

**Rotation procedure (rare):** Update `EXPECTED` in `scripts/verify-keystore.sh`, commit with `--no-verify` (bypasses the local hook), update `keystore-guard.yml` expectations, and plan a manual re-sideload of the full fleet with the first APK signed under the new key.

## Feature-Registry Invariant Checks

### `scripts/check-features.mjs`

Dependency-free Node script (this repo has no test runner — no vitest, no jest, zero `*.test.ts`, and
`node_modules` is root-owned so a workspace `pnpm add` is unavailable to the dev user) verifying the
per-organization feature-toggle registry in `packages/types/src/features.ts`. See [[feature-toggles]]
for the full system.

```bash
./strawboss.sh build packages   # required first — reads the BUILT registry
node scripts/check-features.mjs
```

Runs 10 registry invariants (an untouched org resolves to zero disabled features; every default is
`true`; every key has exactly one definition; every `dependsOn` target exists; the dependency graph is
acyclic; every leaf reaches its module; switching a module off cascades to all its leaves; an unknown
key reads as enabled; a module is `wired` only once every leaf is; every preset-named module is
actually reached by it), then a **backend write-route coverage scan**: walks every `*.controller.ts`
under `backend/service/src`, flags every `@Post`/`@Put`/`@Patch`/`@Delete` route, and requires each to
carry `@RequireFeature(...)` or appear in the script's own `EXEMPT` map with a reason (`CORE` or
`IN-SERVICE`). Exits non-zero on the first failed invariant — this mechanical check, not review
discipline, is what keeps the gate complete when someone adds a new write endpoint.

## Root `prepare` Script

The root `package.json` contains:

```json
"prepare": "git config core.hooksPath .githooks || true"
```

This runs automatically after every `pnpm install` and wires the local `.githooks/` directory as the active Git hooks path. The result: the `pre-commit` keystore guard is active for every developer without any manual setup step.

See [[infrastructure]] for the pre-commit hook and CI guard details.
