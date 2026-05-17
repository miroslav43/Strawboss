---
name: strawboss-deploy
description: Deploy StrawBoss to production -- build, migrate, Docker, SSL
---

# StrawBoss Production Deployment

Production runs on Docker Compose behind nginx with HTTPS on `nortiauno.com`. This checklist covers the full deploy process.

## Quick deploy (standard update)

```bash
./strawboss.sh prod
```

This runs the full production build and starts Docker Compose. For more control, follow the detailed steps below.

---

## Step 1: Pre-deploy checks

### Typecheck all packages and apps
```bash
./strawboss.sh typecheck all
```
This checks: types, validation, domain, api, backend, admin-web. All must pass before deploying.

### Build shared packages
```bash
./strawboss.sh build packages
```
Build order is enforced: types -> validation -> ui-tokens -> domain -> api.

### Verify environment
```bash
# Check .env exists and has required vars
cat .env | grep -E "^(SUPABASE_URL|DATABASE_URL|REDIS_PASSWORD|NEXT_PUBLIC_)" | head -20
```

Required production env vars:
- `SUPABASE_URL` -- Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` -- service role key for backend
- `SUPABASE_JWT_SECRET` -- JWT signing secret
- `DATABASE_URL` -- PostgreSQL connection string
- `REDIS_PASSWORD` -- Redis password (used in Docker Compose)
- `NEXT_PUBLIC_SUPABASE_URL` -- public Supabase URL (baked into Next.js build)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` -- public anon key
- `NEXT_PUBLIC_API_URL` -- production API URL (default: `https://nortiauno.com`)

---

## Step 2: Database migration

```bash
./strawboss.sh db:migrate
```

This runs all SQL files in `supabase/migrations/` via `psql` using `DATABASE_URL`.

### Migration safety checks
- Migrations are applied in filename order (00001, 00002, ...).
- All migrations should be idempotent (safe to re-run).
- For critical changes, wrap in a transaction: `psql` with `--single-transaction`.
- After migration, verify RLS is still enabled:
  ```sql
  SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false;
  ```
  This should return zero rows for tables that need RLS.

---

## Step 3: Docker build

### Build images
```bash
docker compose build --no-cache
```

### Dockerfile details

**Backend** (`Dockerfile.backend`):
- Multi-stage build: `base -> deps -> builder -> runner`
- Node.js 22 Alpine
- Builds packages in order: types -> validation -> domain -> backend
- Runner stage: non-root `appuser`, `/app/logs` owned by appuser
- Exposes port 3001
- Health check: `wget --spider http://localhost:3001/api/v1/health`

**Admin** (`Dockerfile.admin`):
- Multi-stage build: `base -> deps -> builder -> runner`
- Node.js 22 Alpine
- Builds packages in order: types -> validation -> ui-tokens -> api -> admin-web
- `NEXT_PUBLIC_*` vars are build args (baked at build time)
- Uses Next.js standalone output mode
- Runner stage: non-root `appuser`
- Exposes port 3000

### Verify health endpoint
After build, the backend container should respond to:
```
GET /api/v1/health -> { "status": "ok", "timestamp": "..." }
```
This endpoint has `@Public()` decorator -- no auth required.

---

## Step 4: Start services

```bash
docker compose up -d
```

### Service topology
```
nginx (80/443)
  ├── /api/*  -> backend:3001  (NestJS + Fastify)
  └── /*      -> admin:3000    (Next.js)

redis:6379  <- backend (BullMQ queues)
certbot     <- certificate renewal (every 12h)
```

### Verify services are up
```bash
docker compose ps
docker compose logs --tail=20 backend
docker compose logs --tail=20 admin
```

### Check health
```bash
curl -s https://nortiauno.com/api/v1/health | jq .
```

---

## Step 5: SSL (first deploy only)

```bash
# Start nginx on port 80 first
docker compose up -d nginx

# Issue Let's Encrypt certificate via HTTP-01 challenge
./strawboss.sh ssl:init

# Restart all services with HTTPS
docker compose up -d
```

### SSL details
- nginx config: `nginx/nginx.conf`
- Certificate path: `/etc/letsencrypt/live/nortiauno.com/`
- Auto-renewal: certbot container runs `certbot renew` every 12 hours
- Security headers: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy

---

## Step 6: Post-deploy verification

### Check logs for errors
```bash
./strawboss.sh logs:error
```

### Verify background jobs are running
```bash
./strawboss.sh logs | grep "JobSchedulerService"
```
You should see:
```
Seeding repeating BullMQ jobs...
Repeating jobs seeded: geofence (5m), alerts (15m), reconciliation (1h), sync-cleanup (daily 02:00)
```

### Verify realtime subscriptions
Check the admin dashboard loads and shows real-time updates. The `RealtimeProvider` subscribes to Supabase channels for `trips`, `task_assignments`, and `alerts`.

### Verify mobile sync
Trigger a sync from a mobile device and check:
```bash
./strawboss.sh logs:flow | grep -i sync
```

---

## Rollback procedure

### Quick rollback
```bash
# Stop current services
docker compose down

# Restore previous images (if tagged)
docker compose up -d
```

### Database rollback
Migrations are forward-only. For critical issues:
1. Write a corrective migration (00025_fix_*.sql).
2. Apply it: `./strawboss.sh db:migrate`
3. Rebuild and redeploy.

### Check Docker image history
```bash
docker images | grep strawboss
```

---

## Monitoring commands

```bash
./strawboss.sh status          # Build + Docker status overview
./strawboss.sh logs            # Combined logs (tail -f)
./strawboss.sh logs:error      # Error logs only
./strawboss.sh logs:flow       # Business transitions
./strawboss.sh logs:mobile     # Mobile device logs
docker compose ps              # Container status
docker compose logs -f backend # Follow backend logs
```
