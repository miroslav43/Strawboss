# StrawBoss Security / Quality Audit — Remediation Plans

Full multi-angle audit (web, mobile, logic, data-integrity, UI/UX, security) of the ~88k-LOC monorepo, run with 14 specialist reviewers + adversarial verification of every finding.

**55 raw findings → 50 CONFIRMED, 5 refuted.** Severity: **6 critical · 10 high · 12 medium (1 plausible) · 22 low.**

## Files (implement one tier at a time)

| Tier | File | Tasks | Theme |
|---|---|---|---|
| 🔴 Critical | [`01-CRITICAL.md`](./01-CRITICAL.md) | 6 | Pre-auth cross-tenant read/write/delete chain + irreversible offline data loss |
| 🟠 High | [`02-HIGH.md`](./02-HIGH.md) | 10 | Brute-force, trip-fork authz hole, stored XSS, snake_case data breakage, fleet plugin shadow, delta-sync starvation |
| 🟡 Medium | [`03-MEDIUM.md`](./03-MEDIUM.md) | 12 | Input allowlists, race guards, OTA self-heal, error UI, reconciliation, mobile UX |
| 🟢 Low | [`04-LOW.md`](./04-LOW.md) | 22 | Reliability, i18n, a11y, layout (batched by group) |

Each task carries exact `file:line`, concrete steps, and acceptance criteria. Recommended order: Critical → High → Medium → Low.

## The headline risk

A **pre-authentication, cross-tenant data-breach-and-tamper chain** reachable with nothing but the public Supabase anon key: AuthGuard accepts the anon key as a valid org-less identity → roleless controllers pass it → the `organizationId===null` "no filter" branch → `/sync/pull` dumps every org's data and `/sync/push` writes/deletes anywhere. Fixed by the Critical tier (C1–C4).

## Shared root causes (fix the pattern, not just the symptom)

- **R1** — `organizationId===null` is overloaded to mean "no org filter"/super-admin; an unauthenticated anon-key request also produces `null`. Gate the unfiltered branch on an explicit `role==='super_admin'`, never on `null`.
- **R2** — `RolesGuard` is allow-by-default (`roles.guard.ts:24`): a controller with no `@Roles` is reachable by any authenticated identity. 9 controllers lack `@Roles`.
- **R3** — `SELECT *` returns snake_case; admin-web hooks typed camelCase → silent `undefined`. Breaks 4 live admin pages.
- **R4** — Leaflet tooltip/popup content built from user strings without `esc()` → stored XSS. (`esc()` exists in `LeafletMap.tsx` but isn't used everywhere.)
- **R5** — list queries destructure `isLoading` but ignore `isError` → backend failures render as innocuous empty states.
- **R6** — i18n/a11y gaps: hardcoded RO/EN strings, missing switch/sort ARIA semantics.

## Decision locked (C5)

Fleet app moves to an **`assembleRelease` build with `android:debuggable=false`, still signed with the existing pinned `debug.keystore`** — kills the adb/`run-as` data-extraction risk without breaking OTA (signer unchanged). **Keystore rotation is out of scope** (would require re-provisioning all ~30 phones).

## Working notes

- Build order for shared-package edits: `types → validation → ui-tokens → domain → api → backend/admin-web`. Tasks touching `packages/validation`/`packages/api` need `./strawboss.sh build packages` before downstream apps see them.
- After each task: `./strawboss.sh typecheck all` (green). You run the UI build yourself.
- Static-only project (no automated test suite) → verification is behavioral (see each file's verification section).
- `5 findings were refuted during adversarial verification and are intentionally excluded.`

## Cross-tier verification (full sweep at the end)

- **Auth chain (C1–C4):** anon-key `curl` to `/dashboard/overview` and `/sync/pull` → 401/403 (200 today); real user JWT still works and is org-scoped.
- **Sync ownership (C3):** driver A → push update to driver B's trip → rejected; own trip OK.
- **Session-loss (C6):** offline mutation → expire refresh token → reopen → row survives.
- **XSS (H8/H9):** machine `internalCode = <img src=x onerror=alert(1)>` → inert on map/tracks.
- **snake_case (H4–H7):** command-center / dashboard / machine detail render real trip fields + chart.
- **Portal throttle (H1) / XFF (M4):** brute-force → 429; spoofed XFF doesn't reset the counter.
- **Fleet build (C5):** `aapt dump badging` shows debuggable absent; signer SHA-256 unchanged; OTA still installs; background-presence soak passes.
- **Migrations (M8/M12/L7):** `./strawboss.sh db:migrate` against a scratch DB replays clean.
