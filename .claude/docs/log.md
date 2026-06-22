---
type: meta
title: "Doc Change Log"
created: 2026-05-25
updated: 2026-05-25
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
