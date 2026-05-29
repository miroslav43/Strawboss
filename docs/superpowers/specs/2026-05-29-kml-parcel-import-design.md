---
title: Per-farm KML parcel import
date: 2026-05-29
status: approved
---

# Per-farm KML parcel import

## Problem

Admins receive APIA/cooperative field maps as KML files (e.g.
`geofences 2025 cooperativa (3).kml`). We want a per-farm **Import KML** button
that imports every parcel in the file into that farm.

StrawBoss already has the plumbing (parcels with PostGIS `boundary` polygons, a
client-side `kml-parser.ts`, a `KmlImportToFarmModal`, and a top-level Import
KML button). **But the existing parser was written for a different KML dialect**
and cannot read this file.

### KML dialect of the target file (ogr2ogr "tracks" export)

```
Document → Schema name="tracks" → Folder name="tracks" → N × Placemark
```

Each Placemark = one parcel:

| Source                                   | Meaning                          | Maps to            |
|------------------------------------------|----------------------------------|--------------------|
| `<name>` → `"RO010502500 - 1a"`          | APIA block code + parcel suffix  | `parcels.code`     |
| `<SimpleData name="cmt">` → `"4.18"`     | declared area (hectares)         | `areaHectares`     |
| `<SimpleData name="desc">` → `"PORUMB"`  | crop / land use                  | `parcels.notes`    |
| `<SimpleData name="src">` → `"2025"`     | campaign year                    | `parcels.notes`    |
| `<MultiGeometry><LineString><coordinates>` | closed ring of `lon,lat` pairs | `parcels.boundary` (GeoJSON Polygon) |

The existing parser only handles `<Polygon>` + `commune`/`crop_name`/`<description>`,
so on this file it returns 0 parcels ("No polygons found").

## Decisions (confirmed with user)

1. **Crop** → store raw `desc` in `parcels.notes`; leave `cropType` null
   (StrawBoss crop enum = straw cereals only; corn/soy/alfalfa do not fit).
2. **Re-import** → use KML `<name>` as the stable `code`; **upsert** (update the
   existing parcel's geometry/area/notes/farm on conflict). Idempotent.
3. **Area** → use declared `cmt`; fall back to PostGIS-computed area when absent.
4. **Architecture A** → browser parses; a new backend `POST /api/v1/parcels/import`
   does the bulk upsert. (Not pure client-side; not raw-file-to-server.)

## Design

### 1. Parser — `apps/admin-web/src/lib/kml-parser.ts` (extend, keep back-compat)

- Make the parser portable: use `getElementsByTagName` + `getAttribute` instead
  of browser-only `querySelectorAll(':scope > …', '[attr="x"]')`, and accept an
  optional injected `DOMParser` (defaults to the browser global). This keeps
  browser behaviour identical **and** lets us run it in Node (via
  `@xmldom/xmldom`) for verification.
- Geometry: per Placemark, use `<Polygon>` if present (old path); otherwise build
  ring(s) from `<LineString>` `<coordinates>` (existing `parseRing` already
  closes rings and enforces ≥3 points). One ring → Polygon, many → MultiPolygon.
- Fields, with fallbacks (new dialect first, old dialect second):
  - `code` ← direct-child `<name>`
  - `cropRaw` ← `SimpleData[name=desc]` ?? `SimpleData[name=crop_name]`
  - `year` ← `SimpleData[name=src]`
  - `declaredHa` ← `SimpleData[name=cmt]` ?? `<description>`
  - `municipality` ← `SimpleData[name=commune]` ?? `""` (server reverse-geocodes)
- Extend `KmlParsedParcel`: add `code: string | null`, `cropRaw: string | null`,
  `year: string | null`, `declaredHa: number | null` (keep `name`,
  `municipality`, `previewHa`, `boundary`).

### 2. Backend — `parcels.service.ts` + `parcels.controller.ts`

- Refactor the area/centroid/municipality computation out of `create()` into a
  private `computeGeo(boundaryStr, declaredHa, municipality)` helper, reused by
  both `create()` and `importMany()`.
- `importMany(orgId, { farmId, parcels })`: reject `orgId === null` (super_admin
  has no tenant) with `BadRequestException`; verify `farmId` (when present)
  belongs to `orgId` and is live (`NotFoundException` otherwise — never link to
  another tenant's farm). Then, per parcel, do an explicit state-driven write
  rather than `ON CONFLICT` (the `xmax` insert/update discriminator is subtle and
  not worth depending on for correctness-critical counting):

  1. `SELECT deleted_at FROM parcels WHERE code = ? AND organization_id = ?`.
  2. Row exists & soft-deleted → `skipped++`, leave untouched (resurrection is an
     explicit admin action, not a re-import side effect).
  3. Row exists & live → `UPDATE` boundary/centroid/area/farm, `notes =
     COALESCE(?, notes)` (never destroy admin-edited notes), `updated_at = now()`;
     `crop_type` and `harvest_status` left untouched → `updated++`.
  4. No row → `INSERT` (crop_type defaults null, harvest_status 'planned') →
     `created++`.

  - Each row is independent — one bad geometry is caught and recorded as `failed`
    without aborting the rest. The full unique constraint still guards against a
    concurrent-import race (a losing INSERT surfaces as a failed row).
  - Returns `{ total, created, updated, skipped, failed, errors: { code, message }[] }`.
- `sync_version` is stamped automatically by the global trigger on insert/update.
- Endpoint: `POST /api/v1/parcels/import`, `@Roles('admin','geofence_maker')`,
  org scoped from `@CurrentUser()`, body validated by `importParcelsSchema`.
- The unique constraint already exists (`parcels_code_org_unique UNIQUE
  (code, organization_id)`, full — no partial). **No DB migration required.**

### 3. Shared packages

- `@strawboss/types`: `ParcelImportResult { total; created; updated; skipped;
  failed; errors: { code: string; message: string }[] }`.
- `@strawboss/validation`:
  - `importParcelSchema = { code: string≥1; name?: string≥1; boundary: string;
    areaHectares?: number>0; notes?: string|null }`
  - `importParcelsSchema = { farmId?: uuid|null; parcels: importParcelSchema[]
    (1..500) }`
- `@strawboss/api`: `useImportParcels(client)` → `POST /api/v1/parcels/import`;
  on success invalidate `queryKeys.parcels.all` + `queryKeys.farms.all`.

### 4. UI — admin-web

- `farms/page.tsx`: add a per-farm **Import KML** icon button in each farm card's
  action row (next to Edit), setting `kmlFarmId`. Render the modal with
  `defaultFarmId={kmlFarmId}` and `lockFarm`. Keep the top-level button for
  multi-/unassigned imports.
- `KmlImportToFarmModal.tsx`:
  - New `lockFarm?: boolean` prop — when set, show the locked farm name instead
    of the `<select>`.
  - Replace the per-parcel `useCreateParcel` loop with a single
    `useImportParcels.mutateAsync({ farmId, parcels })`.
  - Map each parsed parcel → `{ code, name, boundary: JSON.stringify(boundary),
    areaHectares: declaredHa ?? undefined, notes: [cropRaw, year].filter(Boolean)
    .join(' · ') || null }`. Synthesize a `code` (`KML-<i>`) only if `<name>` is
    empty.
  - Result UI: "X added · Y updated · Z failed" (+ failed codes if any).
  - Preview rows show declared ha + crop.

### 5. i18n

New keys under `farms.kml.modal` in `messages/en.json` + `messages/ro.json`:
`lockedFarm` ("Importing into {{name}}"), `result` ("{{created}} added ·
{{updated}} updated · {{failed}} failed"), `someFailed`. New `farms.importKml`
tooltip for the per-farm button. Existing `noPolygons` reworded to
`noParcels`/kept.

## Verification (repo has no test runner)

- Standalone Node script (`@xmldom/xmldom`) runs the real parser against
  `geofences 2025 cooperativa (3).kml` → expect 20 parcels (the 21st `<name>`
  is the `<Folder>`, correctly skipped), closed rings,
  correct `code`/`declaredHa`/`cropRaw`; plus a Polygon-dialect snippet for
  regression.
- `./strawboss.sh build` (correct order), `typecheck`, `lint`.
- Review workflow: backend/security, web, logic reviewers over the diff.

## Known limitations (from adversarial review — accepted, not fixed here)

- **MultiPolygon parcels fail per-row.** `parcels.boundary` is
  `GEOMETRY(Polygon, 4326)`, so a Placemark that yields a MultiPolygon (multiple
  `<Polygon>`/rings under one Placemark) is rejected by PostGIS and reported as a
  failed row. Pre-existing in `create()`; the target cooperative file is 100%
  single polygons. A clean fix is a column-type migration to `GEOMETRY(4326)` —
  deferred as a follow-up (shared-schema change, out of this feature's scope).
- **Unnamed placemarks get positional codes** (`KML-<i>`). Real APIA files always
  carry `<name>`, so this only affects malformed KML; two different unnamed files
  imported into one org could collide. Documented; not hardened.
- The injectable `DomParserLike` is for browser-DOM-compatible parsers; the
  `<parsererror>` check is browser-specific (xmldom reports via callback). Only
  the browser path is used in production.

## Out of scope

- Extending the crop_type enum (decision 1).
- Mobile changes (parcels already sync via `sync_version`; new parcels flow to
  devices automatically).
- A new dedicated geofence table (parcels remain the field-geofence entity).
