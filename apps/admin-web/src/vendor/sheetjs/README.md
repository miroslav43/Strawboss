# Vendored SheetJS (xlsx) — 0.20.3

`xlsx.mjs` is the official SheetJS ESM build, used by `@/lib/xlsx.ts` (`exportXlsx()`)
to write real `.xlsx` files client-side (currently: the transporter's own trip
ledger at `app/[slug]/(transporter)/transport/page.tsx`).

## Why this is vendored instead of `pnpm add xlsx`

- **`npm`/`registry.npmjs.org` is stale.** SheetJS stopped publishing to npm in
  2023; `xlsx` there is frozen at **0.18.5**, below the fixes for the
  prototype-pollution (CVE-2023-30533) and ReDoS advisories. Current releases
  ship only from `https://cdn.sheetjs.com/`.
- **This repo's `node_modules` is fragile.** It was built with pnpm 10 as root
  while the interactive dev user runs pnpm 9 — any `pnpm install` (plain,
  `--filter`, or `--lockfile-only`) hangs forever at 0% CPU instead of
  failing, because pnpm 9 wants to wipe and reinstall the whole tree
  interactively with no TTY to answer the prompt. Adding a dependency here is
  repo surgery, not a one-line `pnpm add`.

Vendoring gets the *current*, *real* SheetJS build with none of that risk: it
is plain static JS the Next.js build already copies (`Dockerfile.admin` does
`COPY apps/admin-web/ apps/admin-web/`, no Dockerfile change needed), and
`@/lib/xlsx.ts` imports it with a dynamic `import()` so it lands in its own
lazy chunk rather than the initial page bundle.

## Provenance

| | |
|---|---|
| Package | `xlsx` |
| Version | `0.20.3` |
| Source | `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` |
| File taken | `package/xlsx.mjs` → `xlsx.mjs` (unmodified) |
| SHA-256 | `1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db` |
| License | Apache License 2.0 — see `LICENSE` in this directory (copied verbatim from the same tarball) |

`xlsx.mjs` has **no runtime Node dependency** — its single `require('fs')`
occurrence is inside a Flow type comment (`var fs/*:: = require('fs'); */;`),
never evaluated, so no webpack `fs` fallback or polyfill is needed.

`xlsx.d.mts` is **hand-written**, not the upstream `types/index.d.ts` — it
only declares the handful of exports `@/lib/xlsx.ts` calls (`utils.aoa_to_sheet`,
`utils.book_new`, `utils.book_append_sheet`, `writeFile`). This keeps `tsc`
from parsing SheetJS's full (~28 KB) type surface on every admin-web
typecheck. If a future call site needs another export, add it there —
consult the real `types/index.d.ts` from the tarball above for the exact
signature.

## Upgrading

1. Download the new version's tarball from `cdn.sheetjs.com` (check
   `https://cdn.sheetjs.com/` or the SheetJS changelog for the current
   release).
2. Replace `xlsx.mjs` and `LICENSE` with the new tarball's `package/xlsx.mjs`
   / `package/LICENSE`.
3. Update the version, SHA-256, and source URL in this file.
4. Re-run the round-trip smoke test (unzip the sheet XML from a generated
   file, check header row / numeric cell type / diacritics survive) before
   trusting the new build.
