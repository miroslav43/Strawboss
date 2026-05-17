# Mock notification scripts

Quick smoke-test commands for the mobile push / bell-badge pipeline. They
hit the backend over HTTP and let you watch notifications on the device and
the in-app bell without driving GPS or the loader UI by hand.

## How it works

Two flavours, both run through `./strawboss.sh`:

1. **Simulator pushes** (fast, one push per call) → `mock:field-arrival`,
   `mock:loader-arrival`, `mock:warehouse-arrival`, `mock:trip-loaded`,
   `mock:trip-departed`, `mock:broadcast`. Templated pushes use
   **`POST /api/v1/notifications/simulate-push`** (admin JWT). This is the
   same payload shape as the old dev-only simulator and **works in
   production** — no `DevModule` / `STRAWBOSS_ENABLE_DEV` required. There are
   **no** workflow side effects beyond `sendPush`.

2. **End-to-end trip** (slow, exercises real trip transitions) →
   `mock:e2e-trip` drives `create → start-loading → register-load → depart →
   arrive`, so pushes are emitted from `trips.service.ts`. This path needs
   **`supabase/seed.sql` UUIDs** (`SEED_PARCEL_ID`, trucks, users, etc.) to
   exist in the target database. On a production DB without seed data, trip
   creation will fail — use this on dev/staging with seed, or extend the
   script later with real IDs.

### Choosing who receives a simulated push (mock:\* except broadcast)

- **Local / seed:** pass an alias: `driver`, `loader`, `baler`, or `admin`
  → maps to stable seed UUIDs in `scripts/_lib.sh`.
- **Production / real users:**
  - Set **`MOCK_NOTIFY_USER_PATTERN`** to an SQL `ILIKE` pattern
    (e.g. `%ana@example.com%` or `%lmaletici%`). The first matching user
    (by email or username) receives the push; the alias argument is ignored
    when this env var is set.
  - Or pass a pattern containing **`%`** as the user argument, e.g.
    `./strawboss.sh mock:loader-arrival '%lmaletici%'` (requires
    **`DATABASE_URL`** in `.env` for `psql` lookup).

### Admin JWT

`mock:*` notification calls and `mock:broadcast` mint an admin JWT via
`scripts/_lib.sh::mock_notify_admin_jwt`: it prefers **`SELECT id FROM users
WHERE role = 'admin'`** when **`DATABASE_URL`** is set (production-friendly),
and falls back to **`SEED_ADMIN_ID`** when no row is found (typical local dev
before DB is up).

Other auth details: `SUPABASE_JWT_SECRET` from `.env` (`mock_jwt`).

## Prerequisites

```bash
./strawboss.sh db:migrate     # ensure the schema is up to date
./strawboss.sh db:seed        # optional: seed users + demo data (required for seed aliases + mock:e2e-trip)
./strawboss.sh dev            # start backend on :3001 + admin web on :3000

# In another terminal, start the mobile app:
pnpm --filter @strawboss/mobile dev
# (open Expo Go and log in as the target user to see push + bell badge)
```

The seed (`supabase/seed.sql`) ships these stable IDs that aliases target —
keep them in sync with `scripts/_lib.sh::SEED_*`:

| Alias  | UUID                                   | Role              |
| ------ | -------------------------------------- | ----------------- |
| admin  | `a0000000-0000-0000-0000-000000000001` | `admin`           |
| loader | `a0000000-0000-0000-0000-000000000002` | `loader_operator` |
| driver | `a0000000-0000-0000-0000-000000000003` | `driver`          |
| baler  | `a0000000-0000-0000-0000-000000000004` | `baler_operator`  |

## Examples

```bash
# Send a "truck entered field" push to the driver (default target)
./strawboss.sh mock:field-arrival

# Send the same push but to the loader instead
./strawboss.sh mock:field-arrival --user loader

# Same on production: recipient by ILIKE pattern (needs DATABASE_URL)
MOCK_NOTIFY_USER_PATTERN='%lmaletici%' \
  API_URL=https://nortiauno.com ./strawboss.sh mock:loader-arrival

# Or pass the pattern as the first argument to mock:loader-arrival
DATABASE_URL=postgres://... API_URL=https://nortiauno.com \
  ./strawboss.sh mock:loader-arrival '%lmaletici%'

# Driver gets warehouse arrival push
./strawboss.sh mock:warehouse-arrival

# Driver gets "transport ready / depart" push
./strawboss.sh mock:trip-loaded

# Driver gets "on the road" push
./strawboss.sh mock:trip-departed

# Custom broadcast to everyone with a registered push token
./strawboss.sh mock:broadcast --title "Pauză" --body "Toți la masă în 10 minute"

# Full trip lifecycle: 4 push notifications back-to-back to the driver (seed DB only)
./strawboss.sh mock:e2e-trip
```

After each call, open `/notifications` in the mobile app — the new
notification should appear, the bell-icon badge should reflect the unread
count, and the OS app-icon badge should match.

## Pointing at a different API

```bash
API_URL=https://nortiauno.com ./strawboss.sh mock:field-arrival
```

For simulated pushes on prod, set **`DATABASE_URL`** (and optionally
`MOCK_NOTIFY_USER_PATTERN` or a `%pattern%` argument) so the script can
resolve recipients and sign JWT as a real admin user.

## Troubleshooting

- `HTTP 401` → backend `SUPABASE_JWT_SECRET` does not match `.env`. Restart
  backend after editing `.env`; ensure admin user exists if using DB-backed
  JWT.
- **`HTTP 404`** on `/api/v1/notifications/simulate-push` → deploy a backend
  that includes this route (rebuild `backend` image / container).
- `No user for MOCK_NOTIFY_USER_PATTERN` / pattern argument → fix pattern or
  seed users; run `./strawboss.sh notif-lookup '%pattern%'`.
- `mock:*` produces no device notification → no active row in
  `device_push_tokens` for that user. Open the mobile app (logged in) so it
  calls `POST /api/v1/notifications/register-token`.
- **`mock:e2e-trip` fails on prod** → expected without seed UUIDs; use a DB
  that has `supabase/seed.sql` applied or replace IDs in the script.
- Push lands in the OS but bell badge stays at zero → check
  `handleIncomingPush` when app is foregrounded — when the app is killed, the
  next foreground tick reconciles the local SQLite count.
