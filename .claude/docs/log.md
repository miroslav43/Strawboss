---
type: meta
title: "Doc Change Log"
created: 2026-05-25
updated: 2026-07-27
tags: [meta, log, changelog]
status: developing
---

# Doc Change Log

Chronological log of documentation changes. Auto-appended by `/strawboss-sync-docs`.

Format: `[YYYY-MM-DD] <action> | <description>`

Actions: `save` (update), `new doc` (created), `delete`, `rename`.

---

[2026-05-25] new doc | `_index.md` — vault entry point with layers table, packages table, cross-cutting topics
[2026-05-25] new doc | `hot.md` — session entry point with invariants, current state, quick commands
[2026-05-25] new doc | `log.md` — this file, chronological doc change log
[2026-05-25] save | all 13 existing docs — added YAML frontmatter (type, title, created, updated, tags, status, related)
[2026-05-25] save | `packages-validation.md` — added `nextIterationDtoSchema` and `loaderRecallResponseSchema` under Multi-Iteration Trip DTOs
[2026-05-25] save | `packages-api.md` — updated hook count to 24 (from earlier snapshot)
[2026-05-25] save | `database.md` — reflects migrations 00001–00043
[2026-06-19] save | `backend.md` — POST /location/report now touches users.last_seen_at via ProfileService.touchLastSeen (Layer 1 presence); LocationModule imports ProfileModule
[2026-06-19] save | `mobile.md` — auth session persistence via SecureStore adapter; background heartbeat + native PresenceService keep-alive FGS (Layer 2); no forced logout on profile-fetch error
[2026-06-19] save | `packages-api.md` — createClient gains optional storage/detectSessionInUrl (CreateClientOptions/AuthStorage); backward-compatible (web unchanged)
[2026-06-19] save | `backend-agent.md` + `mobile-agent.md` — Layer 1/2 presence + auth-persistence knowledge blocks
[2026-06-19] save | `hot.md` — added presence + auth-persistence to "What's Changing Now"
[2026-06-22] save | `database.md` — Fleet/OTA tables + 4 enums (migration 00055: devices, app_releases, ota_deployments, device_ota_status); migration range now 00001–00055
[2026-06-22] save | `packages-types.md` — device entities/enums + check-in protocol interfaces (entities/device.ts)
[2026-06-22] save | `packages-validation.md` — fleet.schema.ts (checkin/release/deployment/update-device); deviceId on mobileLogIngestSchema
[2026-06-22] save | `packages-api.md` — use-fleet.ts hooks + devices/releases/deployments query keys; hook files 24→25
[2026-06-22] save | `backend.md` + `backend-agent.md` — new fleet module (public checkin + super-admin OTA), QUEUE_OTA_DEPLOY, optional firebase-admin push, deviceId in mobile-logs
[2026-06-22] save | `mobile.md` + `mobile-agent.md` — pre-login device check-in, OTA orchestrator + idle gate, native installApkSilent/getDeviceHardwareInfo, boot-rearm re-report
[2026-06-22] save | `admin-web.md` + `frontend-agent.md` — super-admin Fleet/Releases/device-detail pages, push/schedule modal, polling (no Realtime)
[2026-06-22] save | `architecture.md` — Fleet/OTA subsystem (poll model, 8-state machine, deferred-until-idle)
[2026-06-22] save | `scripts.md` + `infrastructure.md` — keystore guard (verify-keystore.sh, pre-commit, keystore-guard.yml), FIREBASE_SERVICE_ACCOUNT, apks/ storage
[2026-06-22] save | `hot.md` — added Fleet/OTA + keystore invariant to "What's Changing Now"; migration range 00055
[2026-06-22] save | `scripts.md` — mobile-build-local release auto-archives+registers APK (strawboss-v<ver>-vc<code>-<gitshort>.apk, prune-to-10) + scripts/10-fleet.sh (fleet:tailscale-sync/tunnel/status/enable-adb-tcp/install-sync-timer)
[2026-06-22] save | `database.md` — migrations 00056 (devices.tailscale_*, app_settings singleton) + 00057 (app_settings oauth/tag/apk); range 00001–00057
[2026-06-22] save | `packages-types.md` + `packages-validation.md` — DeviceCommand/DeviceCommandReport (+tailscaleApk), AppSettings, pendingCommand/commandReports, tailscale schemas
[2026-06-22] save | `packages-api.md` — useSetDeviceTailscale/useTailscaleSettings/useUpdateTailscaleSettings/useUploadTailscaleApk + settings.tailscale key
[2026-06-22] save | `backend.md` + `backend-agent.md` — tailscale command channel, PATCH devices/:id/tailscale, settings GET/PUT, tailscale-apk upload, mintEphemeralAuthKey (OAuth)
[2026-06-22] save | `mobile.md` + `mobile-agent.md` — native setTailscaleManaged/clearTailscaleManaged/isPackageInstalled, handleTailscaleCommand, zero-touch Tailscale auto-install
[2026-06-22] save | `admin-web.md` + `frontend-agent.md` — tailscale dot/toggle/settings (OAuth+APK upload), nickname-first, injection-safe tunnel cmd, APK filename
[2026-06-22] save | `infrastructure.md` + `architecture.md` — Tailscale fleet remote access (tailnet, systemd timer, adb host req, ephemeral keys, app_settings secrets)
[2026-06-22] save | `hot.md` — added Fleet Tailscale remote + release auto-register to "What's Changing Now"; migration range 00057
[2026-06-28] save | `infrastructure.md` + `devops-agent.md` — Docker Swarm app tier (`strawboss-app` stack, overlay `strawboss-net`, health-gated rolling deploys, hybrid Compose nginx); 127.0.0.1 healthchecks, HOSTNAME=0.0.0.0, single-node bind-mount constraint
[2026-06-28] save | `scripts.md` — `prod` rewritten for Swarm (stack:deploy); new `stack:status`/`stack:logs`/`stack:rollback`/`stack:rm`/`scale`; `stop` = stack rm (leaves shared nginx); `_ensure_swarm`/`_build_prod_images` helpers
[2026-06-28] save | `backend.md` + `backend-agent.md` — graceful shutdown (enableShutdownHooks + SIGTERM→close), boot advisory-lock backfill on a reserved connection, capped PG pool (max 8) for 2 replicas; multi-replica safety section
[2026-06-28] save | `admin-web.md` + `frontend-agent.md` — `/healthz` route + `experimental.preloadEntriesOnStart:false` + `HOSTNAME=0.0.0.0` for the Swarm healthcheck/fast bind
[2026-06-28] save | `hot.md` — added "Production on Docker Swarm" to What's Changing Now + prod/stack:status quick commands
[2026-07-12] save | `backend.md` — new CmrScansModule (module table + '### CMR Scans' endpoint section: attachScan() advisory-lock retire+insert, RETURNING projection, PDF magic-byte sniffing, hasCmrScan on trip_requests); documented GET /trips/auxiliary/at-loader/:loaderMachineId dateFrom scoping; FCM dead-token pruning conservatism (never prune on bare INVALID_ARGUMENT); corrected module count 31→41
[2026-07-12] save | `backend-agent.md` — added cmr-scans + trip-requests to key-modules list; new 'Replace the single active row' advisory-lock pattern + 'File uploads (multipart PDFs)' pattern (savePdf/magic-byte sniff/multipart limit/scanId basename); FCM dead-token pruning note under Fleet module
[2026-07-12] save | `database.md` — documented new document_type enum value cmr_scan (migration 00083) — photographed paper CMR for an auxiliary load's external driver, distinct from the backend-generated cmr
[2026-07-12] save | `db-agent.md` — added 00083_cmr_scan_document_type.sql to migration list (bridging undocumented 00058-00082 gap with ellipsis); document_type added to Key enums; next-migration guidance bumped 00058→00084; new rule: ALTER TYPE ... ADD VALUE must be the sole statement in its migration file (PG 12+ same-transaction restriction); added updated: frontmatter
[2026-07-12] save | `packages-api.md` — new "Trip Requests" hooks section (use-trip-requests.ts) incl. useRequestCmrScans (GET /cmr-scans/trip-request/:id) + useUploadCmrScan (POST, admin override, invalidates tripRequests.cmrScans(id) + tripRequests.all); added tripRequests/orgRequestSettings rows (incl. new .cmrScans(id) key) to Query Keys Factory table
[2026-07-12] save | `packages-types.md` — extended Document.DocumentType enum with cmr_scan; added new TripRequest entity section (incl. hasCmrScan?: boolean)
[2026-07-12] save | `mobile.md` — CMR-scan-for-auxiliary-loads feature (scanner+camera fallback, on-device PDF build, cmr_scan sync-queue entity/DIRECT_ENDPOINT_TYPES, offline auxTripId addressing, ML Kit pre-fetch, i18n); FCM data-wake handler + 90s check-in temporal gate (CHECKIN_GATE_MS); GPS background batching (POST /location/report/batch, 30-item chunks, 60s flush gate, 404/405 fallback) + trip-adaptive piggyback-sync intervals; widened polling cadence (6 hooks) + focusManager fix; heartbeat 30s→~60s (55s dedup gate); mobile-log-upload 10-min gate; SyncManager parcels sync_version fix; auth.ts single-flight refresh guard; useAuxiliaryTrips today-scoping fix; useMyTrucksToLoad include=refs N+1 fix; version bump vc37→vc41 + build:apk keystore hardening
[2026-07-12] save | `mobile-agent.md` — condensed specialist notes mirroring mobile.md: CMR-scan-flow subsection, fleet check-in temporal gate + FCM data-wake subsections, heartbeat/location-batching/polling-cadence updates, SyncManager DIRECT_ENDPOINT_TYPES + parcels-cursor notes; 3 new rules (sync_queue.action CHECK constraint, file-upload sync entities → DIRECT_ENDPOINT_TYPES not a repo, default new polling hooks to wide intervals + rely on focusManager)
[2026-07-12] save | `admin-web.md` — new "Trip Requests" page section (Aviz + CmrUploadModal uploads, hasAviz/hasCmrScan flags, 10MiB/15MiB client caps mirroring backend AVIZ_MAX_BYTES/CMR_SCAN_MAX_BYTES); /trip-requests row in Pages Inventory; DocumentViewer + /documents updated for i18n-driven documents.types.* labels (incl. cmr_scan); UserPresenceDot DEFAULT_ONLINE_WINDOW_MS 90s→180s
[2026-07-12] save | `frontend-agent.md` — new trip-requests/ route; Trip Requests upload-modal pattern (Aviz/CmrUploadModal, size-cap mirroring, hasAviz/hasCmrScan invalidation) + accessible-dialog pattern (role=dialog/aria-modal/focus/Escape) as new rule 12; rule/example for enum-derived i18n labels via t() instead of hardcoded Record maps; UserPresenceDot added to shared-components list (180s default window)
[2026-07-12] save | `infrastructure.md` — new gzip directives in nginx/conf.d/10-nortiauno.com.conf HTTPS server block (commit fc8f025, traffic-diet F0): gzip on, comp_level 5, min_length 1024, gzip_proxied any, gzip_vary on, types application/json/application/geo+json/text/plain — compensates Fastify (no @fastify/compress) proxying uncompressed JSON, shrinks sync-pull/parcels GeoJSON responses 8-10x
[2026-07-27] save | `architecture.md` — Roles/Account Types table corrected to the real 9 roles (added web-only `transportator`); new "Auxiliary Trips — a second, collapsed lifecycle" subsection (`composeAuxStage()`, Curse/Curse Aux admin merge, `LEFT JOIN LATERAL` keyed on `trip_request_id`); realtime diagram updated (trips invalidates `tripRequests.all`, new `trip_requests` channel); migration count 37→91
[2026-07-27] save | `infrastructure.md` — `Dockerfile.admin` missing `@strawboss/domain` package build/copy step, fixed + gotcha note (commit `7e9c915`)
[2026-07-27] save | `.claude/issues/security-audit-2026-05-11.md` — added ✅ FIXED: CR-9 (trip_number per-org unique index, migration 00086, commit `7137391`), CR-10 (CMR `public_sign_token` leak on GET /trips, commit `ef7ec6e`), H-18 (cross-org parcel FK hardening, migration 00091, commit `391fa6e`)
[2026-07-27] save | `database.md` — migration range 00001–00057→00001–00091; new `user_role` value `transportator` + `document_type` value `comanda`; new sections for trip-destination integrity/trip-number uniqueness (00085/00086), transporter role tables (00087/00088), geocode_cache (00089), source_parcel_id + cross-org FK hardening (00090/00091)
[2026-07-27] save | `db-agent.md` — filled in 00084–00091 descriptions, added transportator/comanda to Key enums, new cross-org composite-FK design-pattern note, next-migration guidance bumped 00084→00092
[2026-07-27] save | `mobile.md` — loader-board assignment-aware card (`useLoaderBoard` replacing deleted `useTrucksAtLoader`); local-first map cache rewritten (paired local/refresh hooks, `reconcileWithServer`); unified delivery flow (skip-weighing `scaleBroken`, receiver-signature step removed); R8/Proguard headless-loader keep rules (`withHeadlessProguard.js`)
[2026-07-27] save | `mobile-agent.md` — mirrors mobile.md additions (delivery flow, loader board, local-first cache, R8/Proguard); 2 new rules (maps must render from local SQLite not REST; never hand-edit android/, always via a config plugin)
[2026-07-27] save | `admin-web.md` — new Transporter area section (`(transporter)` route group, `ComandaModal`); Trip Requests page replaced by Curse/Auxiliary Ledger (`AuxStage`, `AuxTripSection`/`AuxTripTable`, field-vs-depot confirm modal); task-planning multi-select + richer loader/machine cards; map multi-select highlighting; new `UserAvatar` shared component
[2026-07-27] save | `frontend-agent.md` — App Router diagram corrected (`(transporter)/` added); new Curse architecture-rules block (AuxStage as SSOT, un-plan vs cancel, two-query rule); map multi-select + `FarmParcelCascade` click-through pattern; Transportator role rules block
[2026-07-27] save | `packages-types.md` — `AuxStage` on the Trip entity; `TripRequest` gains field-sourced pickup + comandă + live-trip read-model fields; new `TransporterBeneficiary`/`BeneficiaryOrderSettings` entities; `UserRole.transportator`, `DocumentType.comanda`; trip-transition DTOs rewritten for signature removal
[2026-07-27] save | `packages-validation.md` — `transportator` role + `setTransporterBeneficiariesSchema`; trip-transition schemas rewritten (signature-free depart/complete, `scaleBroken`); new "Trip Request / Beneficiary Portal" section (depotId/parcelId XOR, transporter request + order-settings schemas)
[2026-07-27] save | `packages-api.md` — new "Server Clock Offset" section (previously undocumented `client/server-clock.ts`); transporter/transporterAssignments query keys + hooks section; `useConfirmTripRequest` field-pickup support; trucks-at-loader + loader-board types; hook-file count 25→28
[2026-07-27] save | `packages-domain.md` — new "Aux Stage" section (`composeAuxStage()`/`AuxStageInput`/`auxStageOrder()` from `rules/aux-stage.ts`)
[2026-07-27] save | `backend.md` — module count 41→42 (Beneficiaries/TripRequests/Transporter/Geocode); new Trip Requests + Transporter + Comandă PDF + Geocode sections; signature-removal rewrite of depart/confirm-delivery/complete; `public_sign_token` leak + trip-destination-integrity + stale-plan-sweep job documented; loader-board endpoint; job-scheduler cadences corrected
[2026-07-27] save | `backend-agent.md` — key-modules list extended (beneficiaries/trip-requests/transporter/geocode); new "never SELECT a secret column on an unguarded route" + "never trust a client-echoed server-minted value" rules; BullMQ cadences corrected/expanded; fail-closed token-recovery pattern
[2026-07-27] save | `hot.md` — full refresh of "What's Changing Now" for the Jul 2026 backlog (transportator role, Curse/AuxStage merge, P0 cross-org fixes, R8/Proguard, signature removal, stale-plan sweep/loader board); migration range 00057→00091; hook count 24→28
[2026-07-27] save | `_index.md` — migration range 00001–00043→00001–00091 in Layers table; hook-file count 24→28
