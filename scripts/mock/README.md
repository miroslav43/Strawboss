# Mock notification scripts

Quick smoke-test commands for the mobile push / bell-badge pipeline. They
hit the dev backend over HTTP and let you watch real notifications light up
the device + the in-app bell badge without driving GPS or the loader UI by
hand.

## How it works

Two flavours, both run through `./strawboss.sh`:

1. **Simulator pushes** (fast, single push per call) → `mock:field-arrival`,
   `mock:loader-arrival`, `mock:warehouse-arrival`, `mock:trip-loaded`,
   `mock:trip-departed`, `mock:broadcast`. They post to the dev-only
   endpoint `POST /api/v1/dev/notifications/simulate`, which calls
   `NotificationsService.sendPush` directly with templated title/body and
   a structured `data.type` payload. **No** workflow side effects.

2. **End-to-end trip** (slow, exercises the production push paths) →
   `mock:e2e-trip` drives a real trip through `create → start-loading →
   register-load → depart → arrive`, so every push fires from
   `trips.service.ts` against the real seed data. Use this when you change
   trip lifecycle code or want to verify the mobile handler maps `trip_*`
   types correctly.

Authentication is handled inside the scripts: each call mints a short-lived
HS256 JWT signed with `SUPABASE_JWT_SECRET` from `.env`
(`scripts/_lib.sh::mock_jwt`).

## Prerequisites

```bash
./strawboss.sh db:migrate     # ensure the schema is up to date
./strawboss.sh db:seed        # load admin/loader/driver/baler users + demo parcel + task assignments
./strawboss.sh dev            # start backend on :3001 + admin web on :3000

# In another terminal, start the mobile app:
pnpm --filter @strawboss/mobile dev
# (open Expo Go and log in as the driver / loader to see push + bell badge)
```

The seed (`supabase/seed.sql`) ships these stable IDs that all the scripts
target — keep them in sync with `scripts/_lib.sh::SEED_*`:

| Alias  | UUID                                   | Role             |
| ------ | -------------------------------------- | ---------------- |
| admin  | `a0000000-0000-0000-0000-000000000001` | `admin`          |
| loader | `a0000000-0000-0000-0000-000000000002` | `loader_operator`|
| driver | `a0000000-0000-0000-0000-000000000003` | `driver`         |
| baler  | `a0000000-0000-0000-0000-000000000004` | `baler_operator` |

## Examples

```bash
# Send a "truck entered field" push to the driver (default target)
./strawboss.sh mock:field-arrival

# Send the same push but to the loader instead
./strawboss.sh mock:field-arrival --user loader

# Loader sees a truck arrive at their parcel
./strawboss.sh mock:loader-arrival

# Driver gets warehouse arrival push
./strawboss.sh mock:warehouse-arrival

# Driver gets "transport ready / depart" push
./strawboss.sh mock:trip-loaded

# Driver gets "on the road" push
./strawboss.sh mock:trip-departed

# Custom broadcast to everyone with a registered push token
./strawboss.sh mock:broadcast --title "Pauză" --body "Toți la masă în 10 minute"

# Full trip lifecycle: 4 push notifications back-to-back to the driver
./strawboss.sh mock:e2e-trip
```

After each call, open `/notifications` in the mobile app — the new
notification should appear, the bell-icon badge should reflect the unread
count, and the OS app-icon badge should match.

## Pointing at a different API

By default scripts hit `http://localhost:3001`. To target staging/prod
(only useful when `STRAWBOSS_ENABLE_DEV=1` is set on the server):

```bash
API_URL=https://api.staging.example.com ./strawboss.sh mock:field-arrival
```

## Troubleshooting

- `HTTP 401` → the dev backend isn't using the same `SUPABASE_JWT_SECRET`
  as your local `.env`. Restart the backend after editing `.env`.
- `HTTP 403` on `/dev/notifications/simulate` in production → set
  `STRAWBOSS_ENABLE_DEV=1` (the controller is gated by `NODE_ENV` +
  this flag). Production by default has `DevModule` disabled.
- `HTTP 400 "no target users resolved"` → the seed user isn't in the DB.
  Re-run `./strawboss.sh db:seed`.
- `mock:loader-arrival` produces `sentCount: 0` → the loader user has no
  active push token. Open the mobile app once as the loader so the token
  registers via `POST /api/v1/notifications/register-token`.
- Push lands in the OS but bell badge stays at zero → check that the
  mobile app called `handleIncomingPush` (foregrounded) — when the app is
  killed, the next foreground tick reconciles the local SQLite count.
