# 🔴 CRITICAL — 6 tasks

> Part of the StrawBoss audit. See [`README.md`](./README.md) for full context, root causes (R1–R6), and the C5 keystore decision.
> Build order for shared-package edits: `types → validation → ui-tokens → domain → api → backend/admin-web`. Typecheck after each task: `./strawboss.sh typecheck all` (you run the UI build).

**Theme:** a pre-auth, cross-tenant read/write/delete chain + irreversible offline data loss. Do these first, in order **C1 → C2 → C4 → C3 → C6 → C5**. C1 is the keystone; the rest are defense-in-depth so the system is safe even if one layer regresses.

> ⚠️ Before starting, confirm the deployed anon key is a legacy JWT: it should start with `eyJ`. If the project already migrated to `sb_publishable_…` keys, C1's exploit path is closed but the hardening steps are still correct to apply.

---

## C1 · Reject non-user tokens (anon/service_role) in AuthGuard
- **Files:** `backend/service/src/auth/auth.guard.ts` (HS256 branch ~106–124; identity assembly ~126–161)
- **Defect:** any token signed with `SUPABASE_JWT_SECRET` is accepted with no `role` allowlist and no `sub` requirement; the anon key (public, in every bundle) yields `{role:'anon', sub:'', organizationId:null}` and skips the `is_active` check.
- **Steps:**
  1. Import the canonical role set from `@strawboss/types` (the `UserRole` union/enum used by `RolesGuard`).
  2. After extracting `role` and `sub`, add: if `sub` is empty **or** `role` is not one of the known `UserRole` values (this excludes `anon`/`service_role`), `throw new UnauthorizedException('Invalid token identity')` — before any `request.user` assignment.
  3. Make `loadUserContext(sub, role)` run for **every** non-super_admin request (drop the `&& sub` short-circuit reliance now that empty `sub` is rejected), so `organizationId`/`organizationSlug` are always DB-derived, never left as an unauthenticated `null`.
  4. Add `audience`/`issuer` options to **both** `jwtVerify` calls (HS256 and JWKS) — pin `iss` to the Supabase project URL and set the expected `aud` (`authenticated`). Confirm real user tokens still verify.
- **Acceptance:** `curl -H "Authorization: Bearer <anon key>" .../api/v1/dashboard/overview` → **401** (200 today). A valid logged-in user JWT still passes and `request.user.organizationId` is populated from DB.
- **Notes:** super_admin path (org=null by design) is preserved because super_admin has a real `sub` and a valid enum role.

## C2 · Add `@Roles` + explicit super_admin gate to Documents & Dashboard
- **Files:** `backend/service/src/documents/documents.controller.ts`, `documents/documents.service.ts:58–62`; `dashboard/dashboard.controller.ts`, `dashboard/dashboard.service.ts:50,95,148,244,273`
- **Defect (R1,R2):** no `@Roles`; `if (orgId)`/`orgId!==null` drops the org filter when null → cross-tenant document download + analytics.
- **Steps:**
  1. Add class-level `@Roles(...)` to both controllers listing only legitimate roles (admin, dispatcher, depot_manager as applicable; include super_admin only where cross-org view is intended).
  2. In both services, replace the `orgId != null ? filter : no-filter` idiom: require the unfiltered branch to be gated on an explicit `callerRole === 'super_admin'` argument threaded from the controller (`@CurrentUser()`), not on `orgId` being null.
  3. For `DocumentsService.findById`, when `callerRole !== 'super_admin'` always apply `AND organization_id = :orgId`.
- **Acceptance:** anon-key (pre-C1) and any non-privileged role get 403; a document from org B is not returned to an org-A admin by UUID; dashboard aggregates are org-scoped for non-super_admin.

## C4 · Lock down the Sync controller
- **Files:** `backend/service/src/sync/sync.controller.ts`; `sync/sync.service.ts` `pull()` ~650, ~674–690, ~732
- **Defect (R1,R2):** no `@Roles`; with `orgId=null` + empty `callerId` both org and owner filters vanish → `/sync/pull` dumps all orgs; `/sync/push` writes anywhere.
- **Steps:**
  1. Add `@Roles('driver','loader_operator','baler_operator','depot_manager','dispatcher','admin')` (the operational roles) to `SyncController`.
  2. In `pull()`/`push()`, thread `callerRole`; make the "no org filter" branch unreachable unless `callerRole === 'super_admin'` — otherwise a missing `orgId` is a `ForbiddenException`, never "all orgs".
- **Acceptance:** `/sync/pull` with a forged anon identity → 403; a real driver only receives their org's rows.

## C3 · Enforce per-record ownership on sync push
- **Files:** `backend/service/src/sync/sync.service.ts` `push()` ~431/458, `applyMutation()` ~507–597; `pull()` owner filters ~664–690
- **Defect:** `applyMutation` scopes only by `organization_id`; no ownership check → any org member can UPDATE/soft-DELETE/INSERT another user's rows.
- **Steps:**
  1. Pass `callerId` and `callerRole` into `applyMutation`.
  2. For UPDATE/DELETE: fetch the existing row's owner column (`driver_id`/`loader_operator_id` for `trips`; `operator_id` for `bale_loads`/`fuel_logs`/`consumable_logs`/`bale_productions`; `assigned_user_id` for `task_assignments`). Reject unless it equals `callerId` **or** `callerRole ∈ {admin,dispatcher,depot_manager}`.
  3. For INSERT: reject if the payload sets an owner column to a value other than `callerId`, unless elevated role.
  4. Add the missing `ownerFilter` for `bale_loads` in `pull()`; review whether `machines`/`parcels`/`task_assignments` should be org-wide readable for every mobile role.
- **Acceptance:** driver A pushing an update to driver B's trip id → rejected; A's own trip update succeeds; a load can't be re-attributed to another operator.
- **Depends on:** C1/C4 (ownership relies on a trustworthy `callerId`).

## C6 · Don't wipe unsynced local data on session loss
- **Files:** `apps/mobile/app/_layout.tsx:210–221`; `apps/mobile/src/components/ProfileScreen.tsx` `handleLogout` ~99–121; `apps/mobile/src/lib/storage.ts` `clearLocalData` ~53–70
- **Defect:** `onAuthStateChange` calls `clearLocalData()` (deletes `sync_queue` + all operational tables) on any `session===null`, including automatic refresh-token expiry after a long offline stretch → silent unrecoverable data loss.
- **Steps:**
  1. In the auth listener, before any wipe, read `SyncQueueRepo.getPendingCount()` + `getFailedCount()`.
  2. **Automatic `SIGNED_OUT`** (not user-initiated): do **not** wipe. Keep the queue; retry once a valid session returns. Only wipe when a *different* user id successfully logs in (compare stored last-user vs new).
  3. **Manual logout**: if pending/failed > 0, show a blocking confirm ("N pending records will be lost — sync now / logout anyway") reusing the existing confirm-modal pattern (as used for `clearFailedQueue`/`releaseDeviceOwner`); only then `clearLocalData()`.
  4. Distinguish "user tapped logout" from "SDK emitted SIGNED_OUT" with an explicit in-flight flag set by the logout handler.
- **Acceptance:** queue an offline mutation, expire/clear the refresh token, reopen app → pending row survives and eventually syncs after re-login. Manual logout with pending rows prompts first.

## C5 · Ship the fleet APK as a hardened release build (keep signer)
- **Files:** `apps/mobile/android/app/build.gradle:100–115`; `apps/mobile/package.json` `build:apk`/`build:android:local`; `apps/mobile/INSTALARE-DEVICE-OWNER.md`
- **Defect:** fleet build is `assembleDebug` → `android:debuggable=true`; `run-as`/adb over Tailscale reads the private SQLite/PII DB, logs, SecureStore.
- **Steps (per the locked decision — no keystore rotation):**
  1. Keep `buildTypes.release.signingConfig = signingConfigs.debug` (preserves the pinned same-signer for OTA).
  2. Ensure `buildTypes.release` has `debuggable false`, `minifyEnabled true` (+ shrinkResources), and a proguard config; verify no `debuggable true` override remains.
  3. Change the fleet build scripts to `gradlew assembleRelease` (not `assembleDebug`); update the OTA-build tooling (`./strawboss.sh mobile-build-local release`) and the doc.
  4. Confirm the release artifact keeps the same signing cert SHA-256 (OTA same-signer check) — the keystore-guard (`scripts/verify-keystore.sh`) must still pass.
- **Acceptance:** `aapt dump badging <apk>` / manifest shows `application-debuggable` **absent**; the signer SHA-256 is unchanged; an OTA update from the prior fielded version still installs silently.
- **Notes:** bump `versionCode` as usual. Do a single on-device soak test (background presence + OTA) since minify can affect reflection-based native modules.

---

## Verification (Critical tier)
- Anon-key `curl` to `/api/v1/dashboard/overview` and `POST /api/v1/sync/pull {"tables":{"trips":0}}` → **401/403** (both 200 today); a real user JWT still works and is org-scoped.
- Driver A pushing an update to driver B's trip id → rejected; A's own trip update succeeds.
- Offline mutation → expire/clear refresh token → reopen app → pending `sync_queue` row survives.
- Fleet build: `aapt dump badging <apk>` shows debuggable absent; signer SHA-256 unchanged; OTA still installs.
- `./strawboss.sh typecheck all` green.
