# Meteo models: verified facts (2026-10-05, public S3 distribution)

Source of truth for `METEO_MODELS` in `meteo.constants.ts`. Verified against
`https://openmeteo.s3.amazonaws.com/data/<s3name>/static/meta.json`.
The self-hosted instance acceptance tests (plan step 0, tests 1-5) must still be
run on `strawboss-meteo` and any difference recorded here.

| Key (stored) | API model id | S3 directory | Step | Role | Notes |
|---|---|---|---|---|---|
| `ecmwf_ifs` | `ecmwf_ifs` | `ecmwf_ifs` | 1 h | PRIMARY (past series + member) | 9 km. Stores `dew_point_2m`; the API derives RH from it |
| `icon_eu` | `icon_eu` | `dwd_icon_eu` | 1 h | member + per-hour fallback for the past | Stores `relative_humidity_2m`. No `soil_moisture_0_to_7cm` (arrives as nulls; the engine treats access as `unknown`) |
| `rain_prob` | `ecmwf_ifs025` | `ecmwf_ifs025_ensemble` | 3 h | rain probability only | Only `precipitation_probability`. |

## To confirm on the self-hosted instance (step 0, test 2)

The mapping "request `models=ecmwf_ifs025&hourly=precipitation_probability`, store
under model key `rain_prob`" is inferred from the S3 layout: the S3 name is the
ENSEMBLE directory `ecmwf_ifs025_ensemble`, which holds only
`precipitation_probability`. The API id that serves it (`ecmwf_ifs025` vs an
`_ensemble` id) must be checked. If the arrays come back all null, the client
returns `null`, the engine receives `rainProb = null` and falls back to model
votes (`rainProbSource: 'models'`, "reduced confidence").

## Request shape

`GET ${OPEN_METEO_BASE_URL}/v1/forecast?latitude&longitude&models=<id>&hourly=<vars>&wind_speed_unit=ms&timezone=UTC&timeformat=unixtime&forecast_days=7&past_days=<n>`

- ONE model per request, so response keys are unsuffixed.
- `hourly` = `temperature_2m, relative_humidity_2m, dew_point_2m, wind_speed_10m, shortwave_radiation, precipitation, soil_moisture_0_to_7cm`.
- Normalised on ingest: RH % -> fraction, probability % -> fraction.
- Coordinates are rounded to a 0.02 deg grid (`coord_key = "lat.toFixed(2),lon.toFixed(2)"`) and the request uses the rounded point.
- `past_days = clamp(ceil((now - earliest open harvested_at in the cell) / 1 day) + 1, 2, 30)`.

## Run freshness

`meta.json` -> `last_run_initialisation_time` (stored as `issued_at`) and
`last_run_availability_time`. A run is usable only when availability is at least
10 minutes old; `meta.json` is re-read after the fetch and the result is discarded
when the init time changed.

## History

Every ingest merges the past hours (time <= now) into `meteo_cell_history`
(per cell, model, UTC day; new non-null values win). The engine's past series is
per hour: primary model (history + latest) else `icon_eu`, so history back to
`harvested_at` survives whatever the server keeps.

## Licence

`meteo-client.ts` refuses any host that is, or ends in, `open-meteo.com`
(non-commercial licence of the public API). Data attribution: ECMWF, DWD (CC BY 4.0).
