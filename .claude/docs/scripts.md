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
| `prod` | Validate env, install deps, build packages + Docker images, start services, issue SSL if needed |
| `stop` | Kill dev processes on ports, stop Docker services |

### Mobile (`scripts/02-mobile.sh`)

| Command | Description |
|---|---|
| `mobile-dev` | Start Expo dev server (builds shared packages first) |
| `mobile-build` | Android APK via Expo EAS cloud build |
| `mobile-build-local` | Android APK via local Gradle (accepts `debug` or `release` arg) |
| `mobile-install` | Install APK on connected device via adb (auto-finds latest APK) |

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
| `ssl:init` | Issue Let's Encrypt cert for nortiauno.com via HTTP-01 challenge |

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
