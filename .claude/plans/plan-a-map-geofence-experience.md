# Plan A — Map UI, Geofence-Maker Experience & Fleet Tracking

> **Owning agent:** Opus 4.7 (executor)
> **Branch suggestion:** `feat/plan-a-map-geofence`
> **Estimated total effort:** ~7 working days (mix of S/M/L)
> **Source of requests:** `/srv/apps/Strawboss/tascuri.txt` (tasks **1, 2, 3, 8, 11, 16, 18**)
> **Parallel siblings:** Plan B (geofence notifications, parcel domain), Plan C (multi-trip/iteration, task counters, fuel, notifications)
> **Dependencies on other plans:** none blocking. Some optional grouping in T18 deferred until Plan C lands `trips.parent_trip_id`.

---

## 1. Scope & non-goals

### In scope (this plan ships)

| ID  | One-liner |
|-----|-----------|
| T1  | Reusable **center-pin point picker** (păstrăm vederea 2D satelit existentă; doar UX-ul de plasare = punct rotund fix în centru + buton "Adaugă punct" lateral dreapta). Folosit în **geofence_maker** și în **ProfileScreen** (home/depot pin). **NU 3D, NU Google Earth imagery** — doar mecanica de plasare. |
| T2  | Collapsible, denser sidebars on `/[slug]/map` — each section (Parcels / Machines / Farms) opens/closes independently; compact spacing. |
| T3  | Deposits page "Add deposit" button parity with parcels — same emphasis, prominent `+`, same i18n shape; remove visual asymmetry. |
| T8  | Mobile-tracked machine positions appear live on the admin map (verify realtime + polling fallback + UX badge). |
| T11 | KML import lives on **Farms** tab and auto-assigns parcels to the chosen farm at import time. |
| T16 | Driver trip card → "Deschide în Google Maps" button that opens native maps with directions to the loader's last known GPS. |
| T18 | Reports → new "Km parcurși pe camion / pe zi" tab with date-range filter, server-computed from `machine_location_events`. |

### Out of scope (other plans / future)

- New geofence-trigger notifications, parcel domain enums (`crop_type`, removal of `is_active`), partial/total harvest UX → **Plan B**.
- Multi-trip iterations on a task, parent/child trip linking, fuel UX simplification, loader notification when a truck finishes a delivery, idle-truck admin alert → **Plan C**.
- Server-side cron for daily km rollup (v1 computes live on request — fast enough for a single truck/day; rollup deferred).
- Mobile inventory/deposit account screen (#12) → Plan B/C scope.
- Any change to `notifications.service.ts` push types — T16 is a **local intent only**, no push.

---

## 2. File ownership matrix

| File | Action | Rationale |
|------|--------|-----------|
| `apps/admin-web/src/app/[slug]/(dashboard)/map/page.tsx` | modify | T2 (collapse state plumbing), T11 (remove KML invocation), T8 (verify `useMachineLocations` polling). |
| `apps/admin-web/src/components/map/LeafletMap.tsx` | modify | T8 (stale-pin badge, optional pulse for fresh updates). No structural changes. |
| `apps/admin-web/src/components/map/FilterableParcelList.tsx` | modify | T11 (remove KML upload button — moves to Farms). T2 (denser rows). |
| `apps/admin-web/src/components/map/FilterableMachineList.tsx` | modify | T2 (denser rows; share collapse pattern). |
| `apps/admin-web/src/components/map/FilterableFarmList.tsx` | modify | T2 (collapse persistence). |
| `apps/admin-web/src/components/map/RouteHistoryPanel.tsx` | read-only | unchanged; referenced for T18 only. |
| `apps/admin-web/src/components/map/DepositGeofenceModal.tsx` | read-only | unchanged. |
| `apps/admin-web/src/app/[slug]/(dashboard)/farms/page.tsx` | modify | T11 (Import KML button + AssignKmlParcelsModal). |
| `apps/admin-web/src/app/[slug]/(dashboard)/deposits/page.tsx` | modify | T3 (button parity / shared `PageHeader` primary button styling). |
| `apps/admin-web/src/app/[slug]/(dashboard)/parcels/page.tsx` | read-only | reference for button styling parity (T3). |
| `apps/admin-web/src/app/[slug]/(dashboard)/reports/page.tsx` | modify | T18 (new tab + chart wiring). |
| `apps/admin-web/src/components/features/reports/KmPerTruckChart.tsx` | **new** | T18 (Recharts grouped bar chart). |
| `apps/admin-web/src/components/features/reports/KmPerTruckTab.tsx` | **new** | T18 (tab body: machine selector + chart + table). |
| `apps/admin-web/src/lib/realtime.tsx` | read-only | **already** subscribes to `machine_locations` (lines 68–80) and `machines` (lines 72–80). Confirmed FW-5 done. |
| `apps/admin-web/src/lib/kml-parser.ts` | read-only | Reuse `parseKml` from Farms; do not change signature. |
| `apps/admin-web/messages/{en,ro}.json` | modify | Add keys under `map.sidebar.*`, `farms.kml.*`, `deposits.newDepositCta.*`, `reports.kmPerTruck.*`, `mobile`-style strings live in mobile-ro literal (no i18n on mobile). |
| `packages/api/src/hooks/index.ts` | modify | Export `useLocationKmByDay()` hook + key in `queryKeys.location.kmByDay(...)`. |
| `packages/api/src/client/api-client.ts` | modify | Add typed `locationKmByDay({ machineId, from, to })` method. |
| `packages/types/src/dtos/location.dto.ts` (or extend existing) | modify | Export `KmByDayPoint = { date: string; km: number; pointCount: number }` and `KmByDayResponse = { machineId, machineCode, machineType, from, to, days: KmByDayPoint[] }`. |
| `backend/service/src/location/location.controller.ts` | modify | Add `GET /api/v1/location/machines/:machineId/km-by-day?from&to` (Roles: `admin`). |
| `backend/service/src/location/location.service.ts` | modify | Add `getKmByDay(machineId, from, to, orgId)` — PostGIS window-function pairwise haversine. |
| `apps/mobile/app/(geofence-maker)/map.tsx` | modify | T1 wire `PointPicker` (optional point-only mode for farms.tsx flow). T2 cosmetic (banner padding). |
| `apps/mobile/app/(geofence-maker)/farms.tsx` | modify | T1 (use PointPicker for "set farm center" flow). |
| `apps/mobile/app/(geofence-maker)/_layout.tsx`, `index.tsx`, `profile.tsx` | read-only | no behaviour change. |
| `apps/mobile/src/components/map/MapView.tsx` | modify | Add `PointPicker`-friendly variant by extending bridge with `ENABLE_POINT_DRAW` + `POINT_DRAWN` (small additive change, doesn't touch geofence editor). |
| `apps/mobile/src/components/map/MapScreen.tsx` | read-only | unchanged (Plan B may touch elsewhere). |
| `apps/mobile/src/map/leaflet-map-content.ts` | modify | Add `ENABLE_POINT_DRAW`/`DISABLE_POINT_DRAW` and emit `POINT_DRAWN`. |
| `apps/mobile/src/map/leaflet-geofence-editor.ts` | modify | Add the same point-draw commands so geofence_maker map can be used in point mode. |
| `apps/mobile/src/map/map-bridge.ts` | modify | Add `ENABLE_POINT_DRAW`, `DISABLE_POINT_DRAW`, `POINT_DRAWN` to types. |
| `apps/mobile/src/components/shared/PointPicker.tsx` | **new** | T1 reusable component: `<PointPicker initialCoord onPick onCancel />`. |
| `apps/mobile/src/components/ProfileScreen.tsx` | modify | T1 add "Locație de bază" card with `<PointPicker>` modal. |
| `apps/mobile/app/(driver)/index.tsx` | modify (additive) | T16: import + render `<OpenMapsToLoaderButton tripId={item.id} />` inside the existing trip card. **No restructuring**. |
| `apps/mobile/src/components/features/driver/OpenMapsToLoaderButton.tsx` | **new** | T16 self-contained button: queries `/api/v1/location/loaders-near-truck/:truckMachineId`, picks the closest loader, opens `https://www.google.com/maps/dir/?api=1&...`. |
| `apps/mobile/src/lib/api-client.ts` | read-only | Use existing `mobileApiClient.get<…>`. |
| `packages/validation/src/schemas/profile.schema.ts` | read-only (review) | If we choose to **persist** home location server-side (see T1.5 below), edit this in a follow-up PR — v1 keeps it client-side in `expo-secure-store`. |
| `apps/mobile/src/stores/auth-store.ts` | read-only | unchanged. |

### Hard "do not touch" (Plan B / Plan C own these)

- `packages/types/src/entities/parcel.ts`, `packages/validation/src/schemas/parcel.schema.ts`
- `supabase/migrations/00042_*.sql` (Plan B), `supabase/migrations/00043_*.sql` (Plan C)
- `apps/mobile/src/hooks/useGeofenceNotifications.ts`
- `apps/mobile/src/components/shared/GeofenceOverlay.tsx`
- `backend/service/src/geofence/geofence.service.ts`
- `backend/service/src/trips/trips.service.ts`
- `backend/service/src/task-assignments/task-assignments.service.ts`
- `apps/admin-web/src/app/[slug]/(dashboard)/tasks/**`
- `apps/mobile/app/(loader)/**`, `apps/mobile/app/(baler)/**`
- `apps/mobile/src/components/features/fuel/**`
- `backend/service/src/notifications/notifications.service.ts`

---

## 3. Coordination contracts (interfaces with other plans)

| Topic | What Plan A does | What Plan B / Plan C must / may do |
|-------|------------------|------------------------------------|
| Realtime subscriptions | **owns** `machine_locations` + `machines` subscription in `realtime.tsx` (already present — confirmed). | Other plans MUST NOT remove or duplicate this subscription. |
| KML import | Removes the upload button from `FilterableParcelList`; adds the upload modal to the Farms page. New parcels POSTed with `{ boundary, name, municipality, farmId: <selected farm> }`. | Plan B owns parcel domain (`crop_type`, `is_active` removal). The `farmId` param is already supported on `POST /api/v1/parcels`; no contract change. |
| `OpenMapsToLoaderButton` (T16) | Reads `trip.loader_machine_id` from local trip record if present; otherwise queries `/api/v1/location/loaders-near-truck/:truckMachineId` (existing endpoint at lines 92–110 of `location.controller.ts`). Returns the **closest** loader's lat/lon and opens native maps. | Plan C may add `parent_trip_id` and a `loaderMachineId` direct on the local trip. If `trip.loader_machine_id` (snake_case in SQLite) is set by Plan C, T16 prefers it — otherwise falls back to the loaders-near-truck call. No interface break either way. |
| Km/day grouping (T18) | v1 groups by **`machine_id + UTC day`**. | Plan C will introduce `trips.parent_trip_id`. If a future v2 needs to attribute km per iteration, Plan A documents a TODO at the SQL site (`getKmByDay`) and Plan C can add a sibling endpoint without touching this one. |
| Notifications | **No new push types** added by Plan A. T16 is a local intent (`Linking.openURL`). | Plan B/C own all new push types. |
| Home location (T1 mobile) | v1 stores the picked coord in `expo-secure-store` under `home_location_v1` (JSON `{lat, lon}`). | If Plan B/C add a server-side `home_lat`/`home_lon` field on the user profile, Plan A's secure-store value can be migrated server-side later. No DB migration required from us. |

---

## 4. Migrations

**None required.** All needed columns/tables exist:

- `machine_location_events` (`coords geography`, `lat`, `lon`, `recorded_at`) — used for T18 km/day.
- `delivery_destinations.boundary`, `parcels.boundary`, `parcels.farm_id` — used for T11.
- `machine_locations` + `machines` realtime subscriptions — already wired.

If, during execution, a missing column or index is discovered (e.g. need a covering index for the km/day query at scale), reserve **`supabase/migrations/00044_location_km_by_day_idx.sql`** (next free slot owned by Plan A). Suggested content if needed:

```sql
-- 00044_location_km_by_day_idx.sql
-- Speeds up the per-machine-per-day km aggregation in
-- LocationService.getKmByDay(). Idempotent.
CREATE INDEX IF NOT EXISTS idx_mle_machine_day
  ON machine_location_events (machine_id, (recorded_at::date), recorded_at);
```

Skip this migration unless `EXPLAIN ANALYZE` on a populated table shows a seq-scan. The existing `idx_mle_recorded_at` + `idx_mle_machine_id` should be enough for the foreseeable load (~1 truck/day = a few thousand rows).

---

## 5. Per-task deep dive

### T1 — Center-pin point picker (mobile)

#### Problem statement (RO)
> "1. sistem ca la google earth pt points in geofance manager, account pe mobile"

**Clarificare ulterioară user:** *"nu vreau sa ramana imaginea de satelit [3D Earth], eu as vrea sa luam doar sistem ul de a pune puncte pe harta de la google earth, gen sa aiba un punct pe mijloc cumva rotund si pe ala sa l misti, si apoi sa aiba cumva un buton in dreapta un add point ce ti adauga punct ul, nu sa fie imagini 3d ca pe earth, sa ramana 2d din satelit ca acum dar cu sistem ul asta"*

User wants:
1. **Vederea 2D satelit existentă rămâne neschimbată** (ArcGIS World Imagery — fără 3D, fără tile-uri Google Earth proprietare).
2. **Punct rotund fix în centrul ecranului** (NU crosshair / cross-hair stil tinte). Cerc plin roșu cu inel alb.
3. **Harta se pan-uiește SUB punct** — punctul rămâne fix vizual; user pune locul dorit sub punct.
4. **Buton lateral dreapta "Adaugă punct"** (FAB sau bară verticală dreapta) care commit-ează coordonata curentă a centrului hărții ca punct ales.

Folosit în **geofence_maker > Farms** (centru fermă) și **ProfileScreen** (home/depot pin).

#### Current state
- `apps/mobile/app/(geofence-maker)/map.tsx:42-435` — full-screen Leaflet WebView via `GeofenceEditorView` (`src/components/map/GeofenceEditorView.tsx:120`). Polygon-draw only (`Draw.Polygon`); no marker-draw.
- `apps/mobile/src/map/leaflet-geofence-editor.ts:5-270` — WebView HTML; ArcGIS World Imagery tiles already loaded (lines 85–88), Leaflet.draw plugin loaded. No point/marker draw exposed.
- `apps/mobile/src/map/leaflet-map-content.ts:1-379` — twin WebView HTML used by `MapScreen.tsx`; also uses ArcGIS World Imagery (verify same tile config).
- `apps/mobile/src/components/ProfileScreen.tsx:177-393` — no home-location card.
- `apps/mobile/src/map/map-bridge.ts:34-43` (commands) and `45-50` (events) — typed bridge; no point-related types.

#### Target state
- A new reusable component **`<PointPicker initialCoord onPick onCancel />`** at `apps/mobile/src/components/shared/PointPicker.tsx`. Full-screen modal:
  - **Baza de hartă rămâne neschimbată** — ArcGIS World Imagery 2D (același tile URL pe care îl folosim deja, **fără dependențe noi, fără 3D**).
  - Initial center = `initialCoord` if provided, else `expo-location.getCurrentPositionAsync()` (fast, low-accuracy) with a 4-s timeout fallback to Deta `[45.3883, 21.2311]`.
  - **Punct rotund fix în centrul ecranului** — un cerc plin (16 px diametru) roșu `#DC2626`, înconjurat de un inel alb (3 px), umbră subtilă jos. Stă fix vizual; user pan-uiește **harta** sub el. (Vezi CSS-ul exact în Step 2 mai jos. NU folosim crosshair / linii încrucișate — doar dotul rotund.)
  - **Buton mare "Adaugă punct" pe partea dreaptă** — vertical FAB (~56×140 px) ancorat la `right: 12, top: 50%` cu text vertical sau iconă `+` mare deasupra textului "Adaugă punct". Glove-friendly, izolat de gesturile hărții.
  - **Buton "Anulează"** mai mic, în colțul stânga-sus (X overlay deasupra hărții).
  - **FAB "Locația mea"** (re-uses existing locate logic în `map.tsx:136-165`) jos-stânga, deja existent.
  - **Banner subtil sus**: `"Deplasează harta sub punct și apasă Adaugă"` (text mic, semi-transparent, auto-fade after 4 s).
- Bridge extension (additive, non-breaking):
  ```ts
  // map-bridge.ts
  export type GeofenceEditorCommand =
    | ...existing
    | { type: 'ENABLE_POINT_DRAW' }   // shows the centered round pin, hides polygon toolbar
    | { type: 'DISABLE_POINT_DRAW' }
    | { type: 'GET_CENTER' };           // request the map center back

  export type GeofenceEditorEvent =
    | ...existing
    | { type: 'POINT_DRAWN'; lat: number; lon: number };
  ```
  Same in `leaflet-map-content.ts` (for the truck/loader role MapScreen). Even though point picker only uses geofence-editor today, mirroring keeps the two HTML payloads symmetrical for the future.
- WebView side (`leaflet-geofence-editor.ts`): when `ENABLE_POINT_DRAW` arrives, render a fixed-position `<div class="center-pin">` (pur CSS, NU strat Leaflet — rămâne centrat pe ecran cât timp harta se pan-uiește dedesubt). Pe `GET_CENTER`, trimite `POINT_DRAWN` cu `map.getCenter()`.

#### Usage sites
1. **Geofence-maker > Farms** (`apps/mobile/app/(geofence-maker)/farms.tsx`): currently allows creating a Farm record. Replace any text/coord input with a "Pune un punct pe hartă" CTA opening `<PointPicker>`. POST `coords: { lat, lon }` (existing payload field).
2. **ProfileScreen** new card `Locație de bază`:
   - Reads current value from `SecureStore.getItemAsync('home_location_v1')`.
   - Button: `"Setează locația mea"` (if not set) or `"Modifică locația mea"`.
   - On confirm → `SecureStore.setItemAsync('home_location_v1', JSON.stringify({lat, lon}))`.
   - Small map preview thumbnail (re-uses `MapView` with `CENTER_ON` command, height 120 px, non-interactive via `pointerEvents="none"`).
   - Tap thumbnail → re-opens picker pre-populated with the saved coord.

#### Step-by-step implementation
1. **`map-bridge.ts`** — append the three new types listed above. No code change to `serializeEditorCommand`/`parseGeofenceEditorEvent` needed (generic JSON).
2. **`leaflet-geofence-editor.ts`** — add the **center round pin** (NU crosshair):
   - Add to the `<style>` block:
     ```css
     .center-pin {
       position: absolute;
       top: 50%;
       left: 50%;
       width: 22px;
       height: 22px;
       margin: -11px 0 0 -11px;
       border-radius: 50%;
       background: #DC2626;             /* roșu plin */
       border: 3px solid #ffffff;       /* inel alb */
       box-shadow: 0 2px 6px rgba(0,0,0,0.45);
       pointer-events: none;            /* nu blochează gesturile pe hartă */
       z-index: 9000;
     }
     .center-pin::after {                /* mic punct mai întunecat în centru pentru contrast */
       content: '';
       position: absolute;
       top: 50%;
       left: 50%;
       width: 6px;
       height: 6px;
       margin: -3px 0 0 -3px;
       border-radius: 50%;
       background: rgba(0,0,0,0.35);
     }
     ```
   - Append a `<div id="center-pin" class="center-pin" style="display:none"></div>` to `<body>`.
   - In `window.handleCommand`, add cases:
     ```js
     case 'ENABLE_POINT_DRAW':
       document.getElementById('center-pin').style.display = 'block';
       break;
     case 'DISABLE_POINT_DRAW':
       document.getElementById('center-pin').style.display = 'none';
       break;
     case 'GET_CENTER': {
       const c = map.getCenter();
       sendEvent({ type: 'POINT_DRAWN', lat: c.lat, lon: c.lng });
       break;
     }
     ```
   - **NU** atingem stratul de tile-uri / harta — vederea 2D satelit rămâne identică.
3. **`leaflet-map-content.ts`** — mirror the same three cases so a future driver-map can do quick-pin too. (Optional in v1 — gate behind a config flag.)
4. **`PointPicker.tsx`** (new):
   ```tsx
   interface PointPickerProps {
     visible: boolean;
     initialCoord?: { lat: number; lon: number };
     onPick: (coord: { lat: number; lon: number }) => void;
     onCancel: () => void;
   }
   export function PointPicker({ visible, initialCoord, onPick, onCancel }: PointPickerProps) { ... }
   ```
   - Internally wraps `<Modal animationType="slide" presentationStyle="fullScreen">`, renders `GeofenceEditorView` (it's the most appropriate WebView wrapper since it lacks parcel data overlays).
   - On mount, after `MAP_READY`: `sendCommand({ type: 'CENTER_ON', lat, lon, zoom: 17 })` then `sendCommand({ type: 'ENABLE_POINT_DRAW' })`.
   - **Layout overlay** (deasupra WebView-ului, ordine de z-index):
     - Stânga-sus: buton X de **Anulează** (TouchableOpacity rotund 44 px, background `rgba(0,0,0,0.5)`, icon `close` alb).
     - Sus-centru: banner subtil `"Deplasează harta sub punct și apasă Adaugă"` (fade out după 4 s; reappears la primul `MOVE` event opțional).
     - **Dreapta-centru**: butonul mare **"Adaugă punct"** ancorat la `right: 12, top: '50%', transform: [{ translateY: -70 }]`. Style:
       ```tsx
       <TouchableOpacity
         onPress={() => mapRef.current?.sendCommand({ type: 'GET_CENTER' })}
         accessibilityRole="button"
         accessibilityLabel="Adaugă punct"
         style={{
           position: 'absolute', right: 12, top: '50%',
           transform: [{ translateY: -70 }],
           width: 64, minHeight: 140,
           backgroundColor: colors.primary,
           borderRadius: 16,
           paddingVertical: 16, paddingHorizontal: 8,
           alignItems: 'center', justifyContent: 'center', gap: 8,
           shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
           elevation: 6,
         }}>
         <MaterialCommunityIcons name="map-marker-plus" size={28} color="#fff" />
         <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12, textAlign: 'center' }}>
           Adaugă{`\n`}punct
         </Text>
       </TouchableOpacity>
       ```
     - Jos-stânga: FAB "Locația mea" existent (păstrat).
   - "Adaugă punct" → `sendCommand({ type: 'GET_CENTER' })`; handler-ul de `POINT_DRAWN` apelează `onPick(coord)` și închide modalul.
   - Cleanup on unmount: `DISABLE_POINT_DRAW`.
5. **`ProfileScreen.tsx`** — between the "Mașina asignată" card (line 275) and "Starea mea" section (line 303), insert:
   ```tsx
   {profile ? (
     <View style={styles.card}>
       <Text style={styles.cardTitle}>Locație de bază</Text>
       {homeCoord ? (
         <View style={styles.homePreview}>
           <Text style={styles.homeCoordText}>
             {homeCoord.lat.toFixed(5)}, {homeCoord.lon.toFixed(5)}
           </Text>
           <TouchableOpacity onPress={() => setPickerOpen(true)}>
             <Text style={styles.linkText}>Modifică</Text>
           </TouchableOpacity>
         </View>
       ) : (
         <TouchableOpacity style={styles.primaryRow} onPress={() => setPickerOpen(true)}>
           <MaterialCommunityIcons name="map-marker-plus" size={20} color={colors.primary} />
           <Text style={styles.primaryRowText}>Setează locația mea</Text>
         </TouchableOpacity>
       )}
     </View>
   ) : null}
   <PointPicker
     visible={pickerOpen}
     initialCoord={homeCoord ?? undefined}
     onCancel={() => setPickerOpen(false)}
     onPick={async (c) => { await SecureStore.setItemAsync('home_location_v1', JSON.stringify(c)); setHomeCoord(c); setPickerOpen(false); }}
   />
   ```
6. **`apps/mobile/app/(geofence-maker)/farms.tsx`** — currently 681 lines (large). Locate the form section that creates/edits a Farm. If it has a coords input, swap it for `<PointPicker>` mounted from a "Pune un punct" button. If it doesn't, add the row (the Farm entity has `coords` per `delivery_destinations` schema parallel).

#### API contracts
None new for T1 v1. (Server-side persistence of `home_location` is deferred.)

#### i18n keys (mobile uses literal RO strings)
- `Locație de bază`
- `Setează locația mea`
- `Modifică locația mea`
- `Deplasează harta sub punct și apasă Adaugă`
- `Adaugă punct` (text vertical pe butonul lateral dreapta — split pe două rânduri în UI)
- `Anulează` (accessibilityLabel pentru X-ul stânga-sus)

#### Edge cases
- **No GPS permission** → don't block; just start at Deta center. Modal Settings hint optional.
- **Offline** → still works: ArcGIS tiles cached by WebView for visited zooms; if no tiles, the user sees the blue offline banner already wired in `leaflet-geofence-editor.ts:52-67` — picker still saves the center coord (no tile needed for the coordinate calculation).
- **WebView crash** → `onCancel()` after a 10-s `MAP_READY` timeout.
- **`getCurrentPositionAsync` hangs** → use `Promise.race` with `setTimeout(reject, 4000)`. (Same defect noted as M6 in `propuneri-imbunatatiri.md`; addressing it here gives us a precedent.)

#### Acceptance criteria
1. From geofence_maker > Farms, the user can place a point by panning the **existing 2D satellite map** under a **fixed round red pin in the center of the screen**, then pressing the **right-side "Adaugă punct" vertical button**. No 3D / no Google Earth imagery introduced — tile layer unchanged.
2. The center pin is a **filled circle** (~22 px diameter) with a white ring and subtle shadow, NOT a crosshair / cross-hair / target reticle.
3. The "Adaugă punct" button is on the **right edge of the screen**, vertically centered, large enough for gloved use (≥56×140 px).
4. From Profile, a "Locație de bază" card persists the picked coord across app restarts (verified via SecureStore inspection).
5. The picker preserves zoom — opening with an existing coord centers at zoom 17 with the round pin on it.
6. Cancel (X în stânga-sus) does not mutate state.
7. No regressions in polygon drawing on the geofence-maker map (T1 is additive; pin overlay is hidden by default).

**Effort:** **M** (2 days — bridge extension + new component + ProfileScreen wiring; farms.tsx integration is small).

---

### T2 — Collapsible, compact admin map sidebar

#### Problem statement (RO)
> "2. sa se inchida si deschida alea de pe harta, gen alea din stanga sa terenurile fermele etc, sa poata sa fie deschise si inchise si sa fie mai compact"

Each section in the left panel (Parcels, Machines, Farms) should expand/collapse independently and feel denser; the whole sidebar already has a single global collapse (`mapSidebarOpen`, `map/page.tsx:533`), which stays.

#### Current state
- `map/page.tsx:681-715` mounts three children inside one scrollable aside:
  - `FilterableParcelList` (lines 87–227) — has its own `open` boolean (`useState(true)`, line 36).
  - `FilterableMachineList` (lines 78–196) — has its own `open` boolean (line 72).
  - `FilterableFarmList` (lines 94–333) — has its own `open` boolean (line 96).
- Each toggle is local-state; not persisted across reloads.
- Padding: `px-4 py-3` headers, `px-4 py-3` rows in parcels — slightly chunky for the left panel use case.

#### Target state
- Move collapse state into the parent (`map/page.tsx`) as `{ parcels: boolean; machines: boolean; farms: boolean }`. Persist in `localStorage` under `strawboss.map.sidebar.sections.v1`.
- Reduce row padding to `px-3 py-2` (parcels & machines) and `px-3 py-1.5` (farms) so the panel can show ~30% more items without scrolling.
- Header chevrons stay; add a small numeric badge next to each header showing `n items` ("3" subtle gray badge). This compensates for the denser rows.
- Add `aria-expanded` on the chevron button.

#### Step-by-step implementation
1. `map/page.tsx` (state hoist):
   ```tsx
   const [sectionsOpen, setSectionsOpen] = useLocalStorageState(
     'strawboss.map.sidebar.sections.v1',
     { parcels: true, machines: true, farms: true },
   );
   ```
   Tiny inline helper (no new dependency):
   ```ts
   function useLocalStorageState<T>(key: string, initial: T): [T, (v: T) => void] { ... }
   ```
2. Pass `open` + `onOpenChange` as props to each Filterable* — replace the internal `useState(true)`.
3. In each Filterable component:
   - Bump from `px-4 py-3` to `px-3 py-2` on rows.
   - Add `badge={parcels.length}` next to header (small `bg-neutral-100 text-neutral-500 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums`).
   - `aria-expanded={open}` on the toggle button.
4. Re-check `FilterableFarmList` nested expansions (`expandedFarmIds`, line 97) — those remain local since they are per-farm.

#### Acceptance criteria
1. Opening / closing each section is independent and persists across page reloads.
2. With all sections collapsed, only the three headers are visible — no big empty area.
3. Row density: at least 12 parcels visible in a 768×500 viewport without scrolling (currently ~8).
4. Keyboard: Tab focus on each chevron + Enter toggles.
5. No layout shift to `LeafletMap` on collapse — verified by ResizeObserver path (`LeafletMap.tsx:478-502`).

**Effort:** **S** (3–4 h).

---

### T3 — Deposits "Add deposit" button parity

#### Problem statement (RO)
> "3. Buton ul de add deposit, sa fie ca cel de la add terein cu un plus sa aiba mai mult sens cu un +"

The user wants the deposit add-button to **visually match** the parcel add-button and have a clear `+` icon.

#### Current state — already mostly matching!
- `parcels/page.tsx:505-516` — primary button: `flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90` with `<Plus className="h-4 w-4" />`.
- `deposits/page.tsx:393-404` — **identical classNames** and `<Plus className="h-4 w-4" />`.

So why is the user asking for parity? Two plausible reasons:
- The Sidebar (`Sidebar.tsx:42`) has a `Warehouse` icon for `/deposits`, but inside the page the button reads `t('deposits.newDeposit')` = "Depozit nou" — possibly the user sees the *empty-state* secondary outlined button at line 494–500 (`flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs`) and finds **that** weak.
- Or: the user wants the button to **stand out more**, perhaps with primary brand color emphasis throughout. The parcels page is the visual benchmark.

#### Target state
- Primary CTA (top right of `<PageHeader>`) — already identical, keep as-is; verify both still match after Tailwind preset changes.
- **Promote the empty-state CTA** in deposits/page.tsx:494–500 to mirror parcels/page.tsx:638–644 — same outline style. Currently both empty states use the same outline pattern; verify and fix any drift.
- **Add a small "+" affordance to the Sidebar nav** for deposits **and** parcels when collapsed view is in use? — out of scope. Stay focused.
- **Extra polish**: the deposits page Stats card row (lines 407–435) uses *inline* `<div className="...">` while parcels uses the `<StatCard>` helper component. Refactor deposits to use the same `StatCard` for visual parity (extract from `parcels/page.tsx:56-69` into a shared helper, or copy locally — copy is fine, < 15 lines).

#### Step-by-step implementation
1. In `deposits/page.tsx`:
   - Verify the primary CTA classnames byte-for-byte against parcels — they already match; **no functional change**.
   - Replace lines 407–435 (`<div className="grid …">`) with three `<StatCard>` invocations (copy `StatCard` from parcels). This is the visible win.
   - Promote empty-state button (lines 494–500) to **primary** style:
     ```tsx
     <button
       onClick={() => setShowCreate(true)}
       className="mt-3 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 mx-auto"
     >
       <Plus className="h-4 w-4" />
       {t('deposits.newDeposit')}
     </button>
     ```
2. i18n: no new keys (reuse `deposits.newDeposit`).

#### Acceptance criteria
1. The deposits page header button and the parcels page header button are visually indistinguishable side-by-side (color, padding, icon size).
2. The deposits empty-state CTA is now a primary-color button with `+`, not an outlined small button.
3. Deposit Stats cards have the same height/padding/font weight as parcel Stats cards.

**Effort:** **S** (<1 h).

---

### T8 — Live admin map machine positions

#### Problem statement (RO)
> "8. sa apara pe harta admin si locatiile etc(harta de pe mobile)"

Mobile-tracked machines must be visible **and update live** on the admin `/[slug]/map` page.

#### Current state
- Realtime: `realtime.tsx:68-80` already subscribes to both `machine_locations` and `machines` — confirmed (FW-5 done).
- Hook: `useMachineLocations(apiClient)` consumed at `map/page.tsx:509`. With realtime, the cache invalidates on every event and the `LeafletMap` machine sync effect (`LeafletMap.tsx:561-609`) re-renders markers.
- Polling fallback: `useMachineLocations` returns the data from `/api/v1/location/machines`. Need to verify it has a `refetchInterval` for the "realtime unavailable" case.
- `LeafletMap.tsx:22-27` defines `ONLINE_THRESHOLD_MS = 15 * 60 * 1000` (15 min). If a position is stale, the ring goes gray. There is **no visible explanation** for the user.

#### Target state
- Verify polling fallback (every 30 s) is in place — if `useMachineLocations` doesn't have `refetchInterval`, **add it via a hook option** without modifying the package. The page can pass it: `useMachineLocations(apiClient, { refetchInterval: 30_000 })`.
- A small "Live" pill in the top-left of the map (next to layer toggles) shows: `Last update: 12s ago · 3 online · 1 offline`. Source: most recent `recordedAt` in `machines`.
- When a marker's `recordedAt` updates within the last 60 s, give it a brief CSS pulse animation (1.2 s, ease-out). Implementation: track previous `recordedAt` per machine in a ref; on render, if newer → add CSS class `marker-just-updated` for 1.2 s.
- Polish the offline ring color from gray to `#9ca3af` (already is); add a tooltip extension `"Offline · 23 min ago"` for clarity.

#### Step-by-step implementation
1. In `map/page.tsx:509`, pass options:
   ```tsx
   const { data: machines = [] } = useMachineLocations(apiClient, { refetchInterval: 30_000 });
   ```
   If `useMachineLocations`'s second arg is not options, add a thin wrapper in `packages/api/src/hooks/index.ts` (only this hook; this is admin-web only, won't affect mobile).
2. New component `apps/admin-web/src/components/map/LiveStatusPill.tsx`:
   ```tsx
   export function LiveStatusPill({ machines, realtimeStatus }: { machines: MachineLastLocation[]; realtimeStatus: 'connected'|'reconnecting'|'disconnected' }) { ... }
   ```
   Renders `{realtimeStatus==='connected' ? 'LIVE' : 'OFFLINE'}` + last-update-ago + online count. Mount inside `LeafletMap.tsx` above the layer-toggles div (or pass realtimeStatus prop from page).
3. In `LeafletMap.tsx`:
   - Track `prevRecordedAtRef = useRef<Map<string,string>>(new Map())`.
   - In the machine-marker effect, after creating each marker, compare against the previous timestamp; if changed and within 60 s of now, schedule `setTimeout(() => marker._icon?.classList.remove('marker-just-updated'), 1200)`.
   - Add CSS via Leaflet `divIcon`'s `className`:
     ```css
     .marker-just-updated { animation: pulseRing 1.2s ease-out; }
     @keyframes pulseRing { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.7); } 100% { box-shadow: 0 0 0 18px rgba(34,197,94,0); } }
     ```
4. No backend changes.

#### API contracts
None changed. Optionally document expected polling interval in `packages-api.md` (`useMachineLocations` now defaults to 30 s when none set by caller — *do not break existing callers*).

#### i18n keys
| key | en | ro |
|-----|----|----|
| `map.liveStatus.live` | "LIVE" | "LIVE" |
| `map.liveStatus.reconnecting` | "Reconnecting…" | "Reconectare…" |
| `map.liveStatus.offline` | "Offline" | "Offline" |
| `map.liveStatus.lastUpdateAgo` | "Last update: {ago}" | "Ultima actualizare: {ago}" |
| `map.liveStatus.onlineCount` | "{n} online · {off} offline" | "{n} online · {off} offline" |

#### Edge cases
- Realtime disconnected: pill shows red dot + "Reconectare…". Polling continues at 30 s.
- 0 machines: pill hidden.
- Machine reappears after long offline: ring transitions gray→green, pulse plays once.

#### Acceptance criteria
1. Driving a phone with the mobile app, the admin map marker visibly updates ≤ 30 s after each report.
2. Killing realtime (block WebSocket in DevTools) does not stop updates entirely; the pill switches to "Reconectare" and updates still arrive ~30 s later.
3. Updates within the last 60 s render a subtle pulse around the marker (visible but not distracting).
4. Tooltip on machine marker now shows "Online" or "Offline · 23 min ago".
5. `clientLogger.info('Map: realtime status changed', { status })` is emitted on transitions.

**Effort:** **M** (1 day).

---

### T11 — KML import on Farms tab, auto-assign to selected farm

#### Problem statement (RO)
> "11. KML ar trebui adăugate de la tab ul de ferme, și atunci să se asigneze direct la o fermă"

Move the KML import UI from the map sidebar to the Farms page, and at import time auto-assign every parsed parcel to the **currently selected** farm.

#### Current state
- `FilterableParcelList.tsx:97-110` exposes an "Importă KML" button. The parsing happens via `parseKml()` from `lib/kml-parser.ts`, then `onKmlParsed(parsed)` bubbles to `map/page.tsx:527`, which renders `<KmlImportModal>` (`map/page.tsx:210-365`). That modal loops `createParcel.mutateAsync(...)` **without `farmId`**.
- Farms page (`farms/page.tsx:413-757`) has no KML affordance.

#### Target state
- Remove KML upload button + parsing from `FilterableParcelList` (also drop the `onKmlParsed` prop and the parent state `kmlParcels` in `map/page.tsx`).
- Add an **"Importă KML"** button on the Farms page header, alongside "Fermă nouă".
- New modal `KmlImportToFarmModal`:
  1. Step 1 — pick file (or drag-drop).
  2. Step 2 — select a destination Farm (dropdown; default = no farm).
  3. Step 3 — review list (uses existing `KmlParsedParcel[]`).
  4. Step 4 — confirm; loop `mutateAsync` with `{ boundary, name, municipality, farmId: <selected> }`.

#### Step-by-step implementation
1. **`farms/page.tsx`** — header CTA group:
   ```tsx
   <div className="flex items-center gap-2">
     <button onClick={() => setKmlOpen(true)} className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
       <Upload className="h-4 w-4" />
       {t('farms.kml.import')}
     </button>
     <button onClick={() => setShowCreate((v) => !v)} className="...primary...">...New farm...</button>
   </div>
   ```
2. New component `apps/admin-web/src/components/features/farms/KmlImportToFarmModal.tsx` (or co-located in farms/page.tsx for v1):
   ```tsx
   interface Props {
     farms: Farm[];
     onClose: () => void;
   }
   ```
   - State: `file`, `parsed: KmlParsedParcel[]|null`, `selectedFarmId`, `progress: {done, failed}|null`.
   - Uses `parseKml(text)` from `lib/kml-parser.ts` (unchanged).
   - Loop via `useCreateParcel.mutateAsync({ boundary, name, municipality, farmId })`.
   - If `selectedFarmId` is empty, omit `farmId` (keeps current behaviour for "import without farm").
3. **`map/page.tsx`**: drop `kmlParcels` state, drop `<KmlImportModal>` (the modal inside this file at lines 210–365). Keep the on-map `<KmlImportModal>` rendering removed too. Delete or leave `KmlImportModal` definition (we can delete since nothing else uses it — `git grep KmlImportModal` should show only this file after the change).
4. **`FilterableParcelList.tsx`**:
   - Delete `Upload` import, `fileInputRef`, `handleFileChange`, `kmlError` state, the upload button + hidden input, the `onKmlParsed` prop, and the `kmlError` banner.
   - Slim props interface accordingly.
5. **API** — `POST /api/v1/parcels` already accepts `farmId`. Verify with current schema, no backend change.

#### API contracts
None new. Existing `POST /api/v1/parcels { boundary, name?, municipality?, farmId? }`.

#### i18n keys
| key | en | ro |
|-----|----|----|
| `farms.kml.import` | "Import KML" | "Importă KML" |
| `farms.kml.modal.title` | "Import parcels from KML" | "Importă câmpuri din KML" |
| `farms.kml.modal.selectFile` | "Select a .kml file" | "Alege un fișier .kml" |
| `farms.kml.modal.selectFarm` | "Assign to farm" | "Asignează la fermă" |
| `farms.kml.modal.selectFarmHint` | "Or leave empty to import unassigned" | "Sau lasă gol pentru import neasignat" |
| `farms.kml.modal.preview` | "{n} parcels detected" | "{n} câmpuri detectate" |
| `farms.kml.modal.confirm` | "Import {n}" | "Importă {n}" |
| `farms.kml.modal.importing` | "Importing {done}/{total}…" | "Se importă {done}/{total}…" |
| `farms.kml.modal.done` | "Done. {ok} imported, {failed} failed." | "Gata. {ok} importate, {failed} eșuate." |
| `farms.kml.modal.noPolygons` | "No polygons found in this KML." | "Nu s-au găsit poligoane în acest KML." |

#### Edge cases
- KML parse error → red banner inside the modal; do not auto-close.
- A farm is deleted between picker and confirm → mutation returns 404 for that one parcel; surfaced in the `failed` counter.
- Re-importing the same KML (already-existing boundaries): server will create duplicate parcels (parcels are not deduped by geometry). Document this; do not add dedup in v1 (Plan B's parcel domain work may handle it).

#### Acceptance criteria
1. Map sidebar no longer shows an "Importă KML" button.
2. Farms page header shows "Importă KML"; clicking opens the modal.
3. Picking a farm + confirming creates N parcels with `farmId` set; verified via DB or by switching to Map and seeing them grouped under the chosen farm in `FilterableFarmList`.
4. Importing without a farm leaves them in the "Unassigned" section (unchanged behaviour, just via the new entry point).
5. `clientLogger.info('KML import requested', { count, farmId })` emitted at confirm time.

**Effort:** **M** (1–1.5 days).

---

### T16 — "Open in Google Maps" to loader position

#### Problem statement (RO)
> "16. buton cand dai pe cursa de pe driver sa aiba maps catre pozitia loaderului, gen sa deschida un google maps daca vrea sa i dai un buton."

On a driver's trip card, add a button that opens the device's native maps app with **directions from the driver's current position to the loader's last known GPS**.

#### Current state
- `apps/mobile/app/(driver)/index.tsx:420-490` — list item renders trip cards. No mention of the loader's GPS.
- Existing endpoint `GET /api/v1/location/loaders-near-truck/:truckMachineId` (`location.controller.ts:92-110`) returns nearby loaders with `lat`/`lon`.
- `apps/mobile/src/hooks/useNearbyLoaders.ts` exists (referenced at `(driver)/index.tsx:240`).

#### Target state
- A new self-contained component `<OpenMapsToLoaderButton tripId truckMachineId? />`:
  - On mount, fetches loader candidates via `useNearbyLoaders()` (already in scope of the driver layout — passed via props or re-called locally).
  - Picks the closest loader (`distanceM` minimum). If none, button is disabled with tooltip "Niciun loader detectat".
  - On press: builds `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lon>&travelmode=driving` and calls `Linking.openURL(...)`.
  - Adds haptic feedback (`Haptics.selectionAsync()` if available) on press.
- Inserted **inside the existing trip card render** (`(driver)/index.tsx:420-490`) without restructuring.

#### Step-by-step implementation
1. **`OpenMapsToLoaderButton.tsx`** (new):
   ```tsx
   import { TouchableOpacity, Text, Linking, Alert, StyleSheet } from 'react-native';
   import { MaterialCommunityIcons } from '@expo/vector-icons';
   import * as Haptics from 'expo-haptics';
   import { colors } from '@strawboss/ui-tokens';
   import { useNearbyLoaders } from '@/hooks/useNearbyLoaders';
   import { mobileLogger } from '@/lib/logger';

   interface Props {
     tripId: string;
     /** Optional explicit truck machine ID (preferred when known). */
     truckMachineId?: string;
     /** Optional pre-resolved loader machine ID from local trip record (Plan C). */
     loaderMachineId?: string | null;
   }

   export function OpenMapsToLoaderButton({ tripId, loaderMachineId }: Props) {
     const { data: loaders } = useNearbyLoaders();
     const closest = loaderMachineId
       ? loaders?.find((l) => l.id === loaderMachineId)
       : (loaders ?? []).slice().sort((a, b) => a.distanceM - b.distanceM)[0];

     const disabled = !closest;

     const onPress = async () => {
       if (!closest) return;
       try { await Haptics.selectionAsync(); } catch {}
       const url = `https://www.google.com/maps/dir/?api=1&destination=${closest.lat},${closest.lon}&travelmode=driving`;
       mobileLogger.info('OpenMapsToLoader pressed', { tripId, loaderId: closest.id, distanceM: closest.distanceM });
       const can = await Linking.canOpenURL(url);
       if (!can) { Alert.alert('Hărți', 'Nu s-a putut deschide aplicația de hărți.'); return; }
       await Linking.openURL(url);
     };

     return (
       <TouchableOpacity
         onPress={onPress}
         disabled={disabled}
         style={[styles.btn, disabled && styles.btnDisabled]}
         accessibilityRole="button"
         accessibilityLabel={disabled ? 'Niciun loader detectat' : 'Deschide rută în Hărți'}
       >
         <MaterialCommunityIcons name="map-marker-distance" size={14} color={disabled ? '#999' : colors.primary} />
         <Text style={[styles.text, disabled && styles.textDisabled]}>
           {disabled ? 'Loader necunoscut' : 'Deschide în Hărți'}
         </Text>
       </TouchableOpacity>
     );
   }
   ```
2. **`(driver)/index.tsx`** — inside the existing trip card `renderItem` (around line 457, inside `<View style={styles.meta}>`), add:
   ```tsx
   <OpenMapsToLoaderButton tripId={item.id} loaderMachineId={(item as LocalTrip).loader_machine_id ?? null} />
   ```
   No surrounding layout change — sits next to existing meta rows.
3. Lazy `useNearbyLoaders` is already polled at the parent (`(driver)/index.tsx:240`); React Query share will avoid a second fetch.
4. Import: add `import { OpenMapsToLoaderButton } from '@/components/features/driver/OpenMapsToLoaderButton';` to the top of `index.tsx`.

#### API contracts
- **Existing only**: `GET /api/v1/location/loaders-near-truck/:truckMachineId` (already returns `{ id, distanceM, lat, lon, ... }`).
- If Plan C eventually adds `loader_machine_id` on the SQLite `trips` row, T16 reads it directly with no fetch.

#### i18n / strings (mobile = literal RO)
- `Deschide în Hărți`
- `Loader necunoscut`
- `Niciun loader detectat`
- `Hărți` (alert title)
- `Nu s-a putut deschide aplicația de hărți.`

#### Edge cases
- iOS: `Linking.canOpenURL('https://www.google.com/maps/...')` always returns `true` for `https`. Safe. If we want to prefer Apple Maps on iOS, alternative `maps://?daddr=lat,lon` — keep Google for now (user explicitly asked for Google Maps).
- No loaders → disabled button with explicit text.
- Loader offline >15 min → button still works but warns by appending `(ultima poziție acum X min)` next to the loader name (optional in v1; ship the simple version).
- App in background → opening URL handled by OS; no special handling.
- Permissions: no extra permissions needed for `Linking.openURL`.

#### Acceptance criteria
1. Each trip in the driver list shows a "Deschide în Hărți" button.
2. Pressing it opens Google Maps (Android intent / iOS Safari→Maps) with directions pre-filled to the loader's coordinates.
3. When no loader is near, button is disabled and reads "Loader necunoscut".
4. Logged `mobileLogger.info` line with `tripId` + `loaderId` + `distanceM`.
5. Haptic feedback on press (no error if module missing).

**Effort:** **S** (3–4 h).

---

### T18 — Reports: km per truck per day

#### Problem statement (RO)
> "18. Rapoarte, sa apara km parcursi de un km pe zi in functie de linia de gps."

A reports section showing kilometres travelled per truck per day, computed from the `machine_location_events` GPS trail. Includes date-range filter.

#### Current state
- `backend/service/src/reports/reports.controller.ts` exists (`/farms`, `/depots`, `/timeline`). No location-derived reports.
- `backend/service/src/location/location.service.ts:441-468` already has the per-machine route query (ordered points within `[from, to]`) — we re-use the same shape.
- `apps/admin-web/src/app/[slug]/(dashboard)/reports/page.tsx:29-37` has a `TABS` array; adding a tab is a one-line append.
- No existing `KmPerTruck*` components.

#### Target state
- **Backend** endpoint:
  - `GET /api/v1/location/machines/:machineId/km-by-day?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Roles: `admin` (matches `getRouteHistory`).
  - Response:
    ```json
    {
      "machineId": "uuid",
      "machineCode": "TR-001",
      "machineType": "truck",
      "from": "2026-05-01",
      "to": "2026-05-07",
      "days": [
        { "date": "2026-05-01", "km": 132.4, "pointCount": 287 },
        { "date": "2026-05-02", "km": 0,     "pointCount": 0   }
      ]
    }
    ```
  - All days in `[from, to]` returned, even with `km=0` (`generate_series`) so the chart is contiguous.
- **SQL query** (justified below): use `LAG()` window function with `ST_DistanceSphere(prev_point, point)` summed per UTC day.
- **Frontend**:
  - New tab `"reports.tabs.kmPerTruck"`.
  - `KmPerTruckTab` body: machine selector (multi-select; default = all trucks), date range picker (re-use existing `<ReportFilters>`), `KmPerTruckChart` (grouped bar by day, one bar per machine).
  - Below the chart, a simple table (`machine` | per-day cells | total). CSV export reusing `exportCsv`.

#### Why pairwise `ST_DistanceSphere` (LAG) over `ST_MakeLine` + `ST_Length::geography`?

`ST_MakeLine` builds a single linestring from all points in a day and `ST_Length::geography` returns its total length. **Pros**: very concise. **Cons**: includes spurious "teleport" segments if GPS jumps; PostGIS treats them as straight legs between **all consecutive** points regardless of dt — exactly what we want.

The pairwise `LAG` approach gives equivalent maths and lets us:
- filter out individual segments with implausible speed (e.g. `<dt_minutes * 200 km/h`) — a small data-cleaning filter for the most egregious GPS spikes; **deferred to v2** to keep v1 simple.
- compute the day partition cleanly using `recorded_at::date AT TIME ZONE 'UTC'`.

For v1, both produce the same number for clean data. I pick **window function + `ST_DistanceSphere`** because it composes naturally with the `generate_series` zero-fill.

#### Step-by-step implementation

##### Backend

1. **`location.service.ts`** — append method:
   ```ts
   async getKmByDay(
     machineId: string,
     from: string,
     to: string,
     orgId: string | null,
   ): Promise<{
     machineId: string;
     machineCode: string | null;
     machineType: string | null;
     from: string;
     to: string;
     days: { date: string; km: number; pointCount: number }[];
   }> {
     // ── validate range ──────────────────────────────
     const fromDate = new Date(from);
     const toDate = new Date(to);
     if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
       throw new BadRequestException('Invalid from/to');
     }
     if (fromDate > toDate) throw new BadRequestException('"from" must be ≤ "to"');
     // cap to 90 days to avoid abuse
     const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / 86_400_000);
     if (diffDays > 90) throw new BadRequestException('Range cannot exceed 90 days');

     // ── machine in-org check (mirrors getRouteHistory) ──
     const machineCheck: ReturnType<typeof sql>[] = [
       sql`id = ${machineId}::uuid`,
       sql`deleted_at IS NULL`,
     ];
     if (orgId !== null) machineCheck.push(sql`organization_id = ${orgId}::uuid`);
     const machineWhere = sql.join(machineCheck, sql` AND `);

     const machineResult = await this.drizzleProvider.db.execute(sql`
       SELECT COALESCE(internal_code, registration_plate) AS "machineCode",
              machine_type AS "machineType"
       FROM machines WHERE ${machineWhere} LIMIT 1
     `);
     const machine = (machineResult as unknown as Array<{ machineCode: string|null; machineType: string|null }>)[0] ?? null;
     if (!machine) throw new BadRequestException('Machine not found');

     // ── km per day via window function + ST_DistanceSphere ──
     const result = await this.drizzleProvider.db.execute(sql`
       WITH pts AS (
         SELECT
           (recorded_at AT TIME ZONE 'UTC')::date AS day,
           recorded_at,
           ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS geom
         FROM machine_location_events
         WHERE machine_id = ${machineId}::uuid
           AND recorded_at >= ${from}::date
           AND recorded_at <  (${to}::date + INTERVAL '1 day')
       ),
       pairwise AS (
         SELECT
           day,
           ST_DistanceSphere(
             LAG(geom) OVER (PARTITION BY day ORDER BY recorded_at),
             geom
           ) AS leg_m
         FROM pts
       ),
       per_day AS (
         SELECT
           day,
           COALESCE(SUM(leg_m), 0) / 1000.0 AS km,
           COUNT(*)                          AS point_count
         FROM pairwise
         GROUP BY day
       ),
       all_days AS (
         SELECT generate_series(${from}::date, ${to}::date, INTERVAL '1 day')::date AS day
       )
       SELECT
         a.day::text                                              AS date,
         ROUND(COALESCE(p.km, 0)::numeric, 2)::float              AS km,
         COALESCE(p.point_count, 0)::int                          AS "pointCount"
       FROM all_days a
       LEFT JOIN per_day p USING (day)
       ORDER BY a.day
     `);

     return {
       machineId,
       machineCode: machine.machineCode,
       machineType: machine.machineType,
       from,
       to,
       days: result as unknown as { date: string; km: number; pointCount: number }[],
     };
   }
   ```
2. **`location.controller.ts`** — append handler:
   ```ts
   @Get('machines/:machineId/km-by-day')
   @Roles(UserRole.admin)
   getKmByDay(
     @Param('machineId') machineId: string,
     @Query('from') from: string,
     @Query('to') to: string,
     @CurrentUser() user: RequestUser,
   ) {
     return this.locationService.getKmByDay(machineId, from, to, user.organizationId);
   }
   ```

##### Types & API client

3. `packages/types/src/dtos/location.dto.ts` (or new file `km-by-day.dto.ts`):
   ```ts
   export interface KmByDayPoint { date: string; km: number; pointCount: number }
   export interface KmByDayResponse {
     machineId: string;
     machineCode: string | null;
     machineType: string | null;
     from: string;
     to: string;
     days: KmByDayPoint[];
   }
   ```
4. `packages/api/src/client/api-client.ts` — add `locationKmByDay({ machineId, from, to })` typed method.
5. `packages/api/src/hooks/index.ts` — add `queryKeys.location.kmByDay(machineId, from, to)` and `useLocationKmByDay(apiClient, args, options?)`.

##### Frontend

6. `apps/admin-web/src/components/features/reports/KmPerTruckTab.tsx` (new):
   - State: `selectedMachineIds: string[]`.
   - Pull list of trucks via `useMachines(apiClient)` filtered by `machineType==='truck'`.
   - For each selected machine, call `useLocationKmByDay(...)` (sequential or via `useQueries`).
   - Render `<KmPerTruckChart data={...} />`.
   - Render a small data table with totals and an "Export CSV" button.
7. `apps/admin-web/src/components/features/reports/KmPerTruckChart.tsx` (new):
   - Recharts `<BarChart>` with `<CartesianGrid>`, `<XAxis dataKey="date">`, `<YAxis>`, one `<Bar dataKey="<machineCode>">` per selected machine.
   - Reuse colours from `ui-tokens` (`colors.primary`, `colors.warning`, …).
8. `apps/admin-web/src/app/[slug]/(dashboard)/reports/page.tsx`:
   - Append `'kmPerTruck'` to the `Tab` union and `TABS` array.
   - Add the conditional render under the tab body: `{tab === 'kmPerTruck' && <KmPerTruckTab dateFrom={dateFrom} dateTo={dateTo} />}`.
   - Date filters are shared via existing `<ReportFilters>` — no change.

#### API contracts

```http
GET /api/v1/location/machines/:machineId/km-by-day?from=2026-05-01&to=2026-05-07
Authorization: Bearer <admin-JWT>

200 OK
{
  "machineId": "…",
  "machineCode": "TR-001",
  "machineType": "truck",
  "from": "2026-05-01",
  "to": "2026-05-07",
  "days": [
    { "date": "2026-05-01", "km": 132.40, "pointCount": 287 },
    { "date": "2026-05-02", "km":   0.00, "pointCount":   0 }
  ]
}

400 Bad Request  (range > 90 days, invalid dates)
404 Bad Request  (machine not in org — keep the same 400 used by getRouteHistory for parity)
```

#### i18n keys

| key | en | ro |
|-----|----|----|
| `reports.tabs.kmPerTruck` | "Km per truck" | "Km / camion" |
| `reports.kmPerTruck.title` | "Kilometres travelled per truck per day" | "Kilometri parcurși per camion pe zi" |
| `reports.kmPerTruck.selectMachines` | "Select trucks" | "Selectează camioane" |
| `reports.kmPerTruck.allTrucks` | "All trucks" | "Toate camioanele" |
| `reports.kmPerTruck.noMachines` | "No trucks in this organization." | "Nu există camioane în organizație." |
| `reports.kmPerTruck.totalKm` | "Total: {km} km" | "Total: {km} km" |
| `reports.kmPerTruck.export` | "Export CSV" | "Export CSV" |
| `reports.kmPerTruck.empty` | "No GPS data in the selected range." | "Nu există date GPS în intervalul selectat." |

#### Edge cases
- A truck with **one** GPS report in a day → `LAG()` is NULL for the first row → `SUM` ignores NULL → `km=0`. Correct behaviour.
- Range > 90 days → 400.
- Multiple selected machines: render a grouped bar chart. UX cap: 6 machines max (warn user via banner if more).
- Time zone: server uses UTC for date partitioning. Document this in the UI (small footer note: "Zilele sunt calculate în UTC"). Local-time partitioning is a v2 enhancement.
- Performance: with a 1-Hz GPS sample over 7 days for a single truck ≈ 600k rows. The query uses the existing `idx_mle_machine_id` + `idx_mle_recorded_at` indexes; expect <500 ms. If slow, ship the optional `00044` index.

#### Acceptance criteria
1. Reports page shows a new "Km / camion" tab.
2. Selecting a date range and a truck renders a per-day bar chart with the correct totals.
3. A day with no GPS shows a 0-bar (not missing).
4. CSV export contains `machine,date,km,pointCount` rows.
5. Backend rejects ranges > 90 days with `400`.
6. RLS: a non-admin or cross-org `machineId` returns `400 "Machine not found"`.

**Effort:** **L** (3 days — SQL + 3 frontend components + types + hook + i18n + manual verification).

---

## 6. Cross-cutting concerns

### Accessibility
- All new buttons: `accessibilityRole="button"` + `accessibilityLabel`.
- Sidebar collapse: `aria-expanded` on chevrons.
- Live-status pill: `role="status"` + `aria-live="polite"` so screen readers announce updates.
- Color: avoid red-green-only meaning in the live pill (text + colored dot, never colour alone).

### Theming via `@strawboss/ui-tokens`
- All new admin-web colours via `colors.*` / Tailwind preset (avoid raw `#hex` outside Leaflet popup HTML).
- Mobile: import `colors` from `@strawboss/ui-tokens` (already done in `ProfileScreen.tsx:23`); avoid hard-coding `#0A5C36` in new code (we'll leave existing fab colours alone — no scope creep).

### Logging
- Admin: every new mutation/intent uses `clientLogger.info|warn|error` with structured payload (`{ feature: 'map.kml-import', ... }`).
- Mobile: every new mutation/intent uses `mobileLogger` (NDJSON). T16's `Linking.openURL` logs `tripId` + `loaderId` + `distanceM`.
- Backend: NestJS `Logger` (`location.service.ts` already wired). Log `{ machineId, from, to, days: result.length }` at info.

### Error boundaries
- `KmPerTruckTab` wraps its `useQueries` results in a try/catch; renders `<ErrorBox>` on failure with retry.
- `PointPicker` shows a fallback screen if WebView fails to load (10 s timeout).

---

## 7. Verification checklist

### Per-package type-check
```bash
pnpm --filter @strawboss/types typecheck
pnpm --filter @strawboss/validation typecheck
pnpm --filter @strawboss/api typecheck
pnpm --filter @strawboss/backend typecheck
pnpm --filter @strawboss/admin-web typecheck
pnpm --filter @strawboss/mobile typecheck
```

### Lint
```bash
./strawboss.sh lint
```

### Manual smoke tests

| Task | Steps | Expected |
|------|-------|----------|
| T1 mobile | Open geofence_maker > Farms > "Pune un punct" | Crosshair appears, panning works, "Salvează" emits `POINT_DRAWN`. |
| T1 profile | Open Profile > "Setează locația mea" | After save, restart app → coord still visible. |
| T2 | Map > collapse Parcels, reload | Parcels stays collapsed. |
| T3 | Visit /deposits and /parcels side-by-side | Buttons visually identical. |
| T8 | Start mobile app driving GPS reports; watch admin map | Marker updates ≤ 30 s; pulse plays. |
| T8 negative | Disable WebSocket in DevTools | Pill = "Reconectare"; polling still works. |
| T11 | Upload `samples/parcels.kml` on Farms with farm A selected | All parcels show under farm A in the list and on the map. |
| T16 | On a phone with a real loader nearby, tap "Deschide în Hărți" | Google Maps opens with directions. |
| T18 | Reports > Km / camion > pick last 7 days + truck TR-001 | Bar chart shows totals matching `SELECT date_trunc(...)` query manually run in psql. |

### Browser / device matrix
- Web: Chrome (admin desktop), Firefox (sanity), Safari (admin tablet).
- Mobile: Pixel 6 (Android 14), iPhone 13 (iOS 17). Note: background tracking on iOS is **out of scope** (M5 in propuneri); confirm foreground-tracking only.

---

## 8. PR strategy

### Single branch: `feat/plan-a-map-geofence`

**Commit grain** (recommended, in order):

1. `feat(map): live status pill + 30s polling fallback (T8)` — additive.
2. `feat(map): per-section collapse persisted in localStorage (T2)` — small refactor + i18n keys.
3. `chore(ui): deposit page parity with parcels — StatCard + primary empty-state CTA (T3)` — purely cosmetic.
4. `feat(farms): KML import on Farms tab with auto-assign (T11)` — remove from map sidebar, add to farms; new modal.
5. `feat(mobile): reusable PointPicker via WebView ENABLE_POINT_DRAW (T1)` — bridge + new component.
6. `feat(profile): home location picker stored in SecureStore (T1)` — uses PointPicker.
7. `feat(driver): OpenMapsToLoaderButton on each trip card (T16)` — self-contained.
8. `feat(reports): km per truck per day endpoint + UI tab (T18)` — backend + frontend in one commit (atomic for review).
9. `docs(claude): update .claude/docs/{admin-web,mobile,backend}.md` — via `/strawboss-sync-docs` after merge.

### PR description template

- Summary of the 7 tasks with screenshots/GIFs per task.
- Coordination contracts box (links to Plan B/C).
- Manual test plan checklist (the table above).
- Known follow-ups: iOS background GPS (M5), inventory mobile screen (#12), v2 km/day local-time partitioning.

---

## 9. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| WebView CSS crosshair drifts on Android pinch-zoom mid-gesture | M | M | The crosshair is HTML, not a Leaflet layer — it stays pinned to the viewport. Already tested pattern (used by Google Earth). |
| `useMachineLocations` second-arg shape varies → polling option lost | L | M | Verify hook signature in `packages/api/src/hooks/index.ts` before commit; extend in a tiny inline wrapper if needed. |
| KML import with farmId silently fails server-side (validator) | L | H | Run a smoke import on dev DB and assert `farm_id` is set in `parcels` row. Add a server-side log line. |
| `getKmByDay` slow for >30-day ranges on a busy truck | M | M | Cap at 90 days (already in service). Ship the optional `00044` index if EXPLAIN shows seq-scan. |
| Two plans both edit `realtime.tsx` | L | H | Plan B is explicitly told (in the prompt) that machine_locations subscription is owned here. Confirmed in coordination box. |
| Existing `KmlImportModal` referenced by tests or other pages | L | L | `git grep KmlImportModal` before deletion; we only delete after confirming no other usage. |
| Linking.openURL on iOS opens Safari for `https://maps...` instead of Maps app | M | L | Acceptable per user request (they said "google maps"). Safari handoff is fine. If we want to prefer Apple Maps, add a follow-up. |
| Mobile bridge type changes break Plan B WebView consumers | L | M | All additions are **new** enum members — old commands still work. `parseEvent` is generic JSON. |
| `expo-haptics` not in dependencies | L | L | Mobile already uses `Vibration` (`ProfileScreen.tsx:13`). T16 wraps `Haptics` in try/catch so a missing module is silent. Add to `package.json` only if not present. |
| Admin map performance with 200+ machine markers and pulse animation | L | L | Pulse only triggers on **changed** markers (delta check). Total visible markers usually < 20. |

---

*End of plan-a-map-geofence-experience.md*
