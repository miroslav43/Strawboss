export const TABLES = {
  operations: `CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    machine_id TEXT,
    parcel_id TEXT,
    trip_id TEXT,
    bale_count INTEGER DEFAULT 0,
    weight_kg REAL,
    photo_uri TEXT,
    signatures TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    server_version INTEGER DEFAULT 0
  )`,

  trips: `CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    trip_number TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    source_parcel_id TEXT,
    destination_id TEXT,
    destination_name TEXT,
    destination_address TEXT,
    truck_id TEXT,
    driver_id TEXT,
    loader_id TEXT,
    loader_operator_id TEXT,
    bale_count INTEGER DEFAULT 0,
    gross_weight_kg REAL,
    tare_weight_kg REAL,
    receiver_name TEXT,
    loading_started_at TEXT,
    loading_completed_at TEXT,
    departure_at TEXT,
    arrival_at TEXT,
    delivered_at TEXT,
    completed_at TEXT,
    -- Depot-operator confirmation (driver → operator depozit). Pulled from server.
    depot_operator_id TEXT,
    depot_confirmed_at TEXT,
    depot_operator_signature_url TEXT,
    scale_broken INTEGER DEFAULT 0,
    -- Read-model flag: destination depot has an assigned operator (drives the
    -- driver's read-only delivery view).
    destination_has_operator INTEGER DEFAULT 0,
    acknowledged_at TEXT,
    has_pending_transition INTEGER DEFAULT 0,
    delivery_step_progress INTEGER,
    delivery_draft_json TEXT,
    -- Plan C — multi-iteration columns. NULL parent_trip_id = root iteration.
    parent_trip_id TEXT,
    iteration_index INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    server_version INTEGER DEFAULT 0
  )`,

  sync_queue: `CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
    payload TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_flight', 'failed', 'completed')),
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    next_retry_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    client_version INTEGER DEFAULT 0
  )`,
  bale_productions: `CREATE TABLE IF NOT EXISTS bale_productions (
    id TEXT PRIMARY KEY,
    parcel_id TEXT NOT NULL,
    baler_id TEXT,
    operator_id TEXT NOT NULL,
    production_date TEXT NOT NULL,
    bale_count INTEGER NOT NULL DEFAULT 0,
    avg_bale_weight_kg REAL,
    start_time TEXT,
    end_time TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    server_version INTEGER DEFAULT 0
  )`,

  fuel_logs: `CREATE TABLE IF NOT EXISTS fuel_logs (
    id TEXT PRIMARY KEY,
    machine_id TEXT,
    operator_id TEXT NOT NULL,
    parcel_id TEXT,
    logged_at TEXT NOT NULL,
    fuel_type TEXT DEFAULT 'diesel',
    quantity_liters REAL NOT NULL,
    hourmeter_hrs REAL,
    is_full_tank INTEGER DEFAULT 0,
    receipt_photo_uri TEXT,
    receipt_photo_url TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    server_version INTEGER DEFAULT 0
  )`,

  consumable_logs: `CREATE TABLE IF NOT EXISTS consumable_logs (
    id TEXT PRIMARY KEY,
    machine_id TEXT,
    operator_id TEXT NOT NULL,
    parcel_id TEXT,
    consumable_type TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT DEFAULT 'kg',
    logged_at TEXT NOT NULL,
    receipt_photo_uri TEXT,
    receipt_photo_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    server_version INTEGER DEFAULT 0
  )`,
  bale_loads: `CREATE TABLE IF NOT EXISTS bale_loads (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    parcel_id TEXT NOT NULL,
    loader_id TEXT,
    operator_id TEXT,
    bale_count INTEGER NOT NULL DEFAULT 0,
    loaded_at TEXT,
    gps_lat REAL,
    gps_lon REAL,
    notes TEXT,
    -- Set when the load was registered while the field's GPS presence could
    -- not be verified (offline / boundary not cached) and the operator
    -- explicitly confirmed anyway — see server migration 00094.
    location_unverified INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    server_version INTEGER DEFAULT 0
  )`,

  task_assignments: `CREATE TABLE IF NOT EXISTS task_assignments (
    id TEXT PRIMARY KEY,
    assignment_date TEXT NOT NULL,
    machine_id TEXT,
    parcel_id TEXT,
    assigned_user_id TEXT,
    priority TEXT DEFAULT 'normal',
    sequence_order INTEGER NOT NULL,
    estimated_start TEXT,
    estimated_end TEXT,
    actual_start TEXT,
    actual_end TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    server_version INTEGER DEFAULT 0
  )`,
  notifications: `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data_json TEXT,
    severity TEXT NOT NULL DEFAULT 'info',
    is_read INTEGER NOT NULL DEFAULT 0,
    read_at INTEGER,
    created_at INTEGER NOT NULL
  )`,

  // FM-13 — local parcel geometry cache for offline map rendering.
  // Populated during pull sync from task_assignments that carry parcel data.
  // `geometry` stores the GeoJSON boundary as a JSON string (TEXT).
  // `harvest_status` mirrors the server field so the map can colour-code parcels.
  // `cached_at` lets us expire stale geometry on next pull.
  parcels: `CREATE TABLE IF NOT EXISTS parcels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    area_hectares REAL,
    municipality TEXT,
    harvest_status TEXT,
    crop_type TEXT,
    farm_name TEXT,
    centroid_json TEXT,
    geometry TEXT,
    cached_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // Local cache for delivery destinations (depots). Used by the geofence-maker
  // map to render existing depots and by handleSaveDeposit to persist newly
  // drawn depots before they sync to the server. `boundary` and `coords_json`
  // are JSON-encoded GeoJSON strings; `cached_at` lets us expire stale rows.
  delivery_destinations: `CREATE TABLE IF NOT EXISTS delivery_destinations (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT,
    boundary TEXT,
    coords_json TEXT,
    confirm_radius_m INTEGER,
    is_default INTEGER DEFAULT 0,
    cached_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // Persisted sync cursors per table. Needed because once the SyncManager
  // applies a tombstone it `DELETE`s the local row, so `MAX(server_version)`
  // on the table no longer reflects the highest version the client has seen.
  // Without this table, tombstones would be re-delivered on every pull cycle
  // forever (LIMIT 1000 could then starve fresh updates).
  sync_cursors: `CREATE TABLE IF NOT EXISTS sync_cursors (
    table_name TEXT PRIMARY KEY,
    server_version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // Plan C — write-through cache for the depot dashboard, so the deposit
  // role still shows yesterday's snapshot on a cold boot offline.
  deposit_inventory_cache: `CREATE TABLE IF NOT EXISTS deposit_inventory_cache (
    depot_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  )`,
} as const;
