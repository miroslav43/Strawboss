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
