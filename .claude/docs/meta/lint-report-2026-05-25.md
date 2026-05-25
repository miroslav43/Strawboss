---
type: meta
title: "Lint Report 2026-05-25"
created: 2026-05-25
updated: 2026-05-25
tags: [meta, lint]
status: developing
---

# Lint Report: 2026-05-25

## Summary

- Pages scanned: 16
- Issues found: 1 (informational)
- Auto-fixed: 0
- Needs review: 0

All checks passed. One informational note about `_index.md` (expected for vault entry points).

---

## Orphan Pages

- `_index.md`: no inbound links. **Informational** — this is the vault entry point; it links to everything and is not expected to be linked back to. No action needed.

## Dead Links

None. All `[[wikilinks]]` in body text resolve to existing pages.

Notes:
- `[[<topic>]]` and `[[stem]]` in `_index.md` Conventions section are inside inline code spans (backticks) and are not live wikilinks — pass.

## Frontmatter Gaps

None. All 16 pages have complete frontmatter: `type`, `title`, `created`, `updated`, `tags`, `status`.

## Empty Sections

None.

## Stale Index Entries

None. `_index.md` lists 13 layer/package docs + `hot`, `log`, `_index` — all files exist.

## Address Validation

DragonScale is **present** (`scripts/allocate-address.sh` + `.vault-meta/address-counter.txt`).

- Rollout baseline: **2026-05-25** (set in `.vault-meta/legacy-pages.txt`)
- Counter state: 1 (no addresses allocated yet)
- All 16 pages listed as **legacy** in `.vault-meta/legacy-pages.txt` → address not required for these pages
- Post-rollout pages without address: 0 errors
- Format errors: 0
- Uniqueness collisions: 0

New pages created after 2026-05-25 should be assigned a `c-NNNNNN` address via `./scripts/allocate-address.sh`.

## Semantic Tiling

Skipped. The `tiling-check.py` script scans `VAULT_ROOT/wiki/` but pages in this vault live in the root (`VAULT_ROOT/`). 0 pages were scanned.

To enable tiling for this vault, either:
1. Move docs into a `wiki/` subdirectory and update `_index.md` references, OR
2. Edit `scripts/tiling-check.py` line 50: change `VAULT_ROOT / "wiki"` to `VAULT_ROOT` and update `EXCLUDE_PATH_PREFIXES` accordingly.

---

## Cross-Reference Coverage

Inbound link counts per page (from body text wikilinks, excluding frontmatter `related:`):

| Page | Inbound Links | Source pages |
|---|---|---|
| `_index` | 0 | (entry point) |
| `hot` | 2 | `_index` (×2) |
| `log` | 2 | `_index` (×2) |
| `architecture` | 2 | `_index`, `hot` |
| `backend` | 9 | `_index`, `architecture`, `hot`, others |
| `database` | 8 | `_index`, `architecture`, `hot`, others |
| `mobile` | 8 | `_index`, `architecture`, `hot`, others |
| `sync-protocol` | 6 | `_index`, `architecture`, `hot`, others |
| `packages-domain` | 5 | `_index`, `architecture`, `hot` |
| `packages-validation` | 3 | `_index`, `architecture`, `hot` |
| `infrastructure` | 3 | `_index`, `architecture` (×2) |
| `scripts` | 3 | `_index`, `architecture` (×2) |
| `admin-web` | 4 | `_index`, `architecture` |
| `packages-api` | 2 | `_index`, `architecture` |
| `packages-types` | 2 | `_index`, `architecture` |
| `packages-ui-tokens` | 2 | `_index`, `architecture` |

All pages reachable within 1–2 hops from `_index`.
