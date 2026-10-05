// Meteo engine tests — dependency-free `node --test` (node_modules is
// root-owned, so no test runner can be added). Run against the compiled
// package:  pnpm --filter @strawboss/domain build && node --test packages/domain/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const d = require('../dist/index.js');
const P = d.STRAW_PARAMS_V1;
const H = 3_600_000;

// ── helpers ────────────────────────────────────────────────────────────────
const sunny = (hourUtc) => {
  // Romanian summer: local = UTC+3. Daylight ~03..17 UTC, peak ~10 UTC.
  const day = hourUtc >= 4 && hourUtc <= 16;
  return {
    t2m: day ? 28 : 16,
    rh: day ? 0.4 : 0.75,
    td: null,
    windMs: day ? 3 : 1,
    rsWm2: day ? 700 * Math.sin((Math.PI * (hourUtc - 3)) / 14) : 0,
    precipMm: 0,
    sm07: 0.2,
  };
};
const series = (model, startMs, hours, fn, stepH = 1) => {
  const m = new Map();
  for (let i = 0; i < hours; i++) {
    const t = startMs + i * H;
    m.set(t, fn(new Date(t).getUTCHours(), i, t));
  }
  return { model, stepH, byTime: m };
};
const baseInput = (over = {}) => {
  const harvestedAtMs = Date.UTC(2026, 6, 10, 9);
  const nowMs = Date.UTC(2026, 6, 11, 6);
  return {
    harvestedAtMs,
    nowMs,
    past: series('ecmwf_ifs', harvestedAtMs + H, 40, sunny),
    futures: [
      series('ecmwf_ifs', nowMs - (nowMs % H) + H, 72, sunny),
      series('icon_eu', nowMs - (nowMs % H) + H, 72, sunny),
    ],
    rainProb: null,
    readings: [],
    swathType: 'wide',
    thresholdWb: 0.15,
    defaultMc0Wb: 0.3,
    params: P,
    ...over,
  };
};
const rules = { baleableFracMin: 0.8, rainProbMax: 0.2 };
const deriveOpts = (over = {}) => ({
  ...rules,
  atMs: Date.UTC(2026, 6, 11, 6),
  requiredHours: 4,
  minWindowH: 3,
  areaHa: 12,
  computedAtMs: Date.UTC(2026, 6, 11, 6),
  newestIssuedAtMs: Date.UTC(2026, 6, 11, 0),
  ...over,
});
const pt = (ms, over = {}) => ({
  time: new Date(ms).toISOString(),
  p10: 0.12, p50: 0.13, p90: 0.14,
  baleableFrac: 1, baleable: false, rainProb: 0, precipMm: 0,
  dew: false, access: 'ok', observed: false, t2m: 25, rh: 0.4, windMs: 3,
  ...over,
});
const hoursFrom = (startMs, n, fn) => Array.from({ length: n }, (_, i) => pt(startMs + i * H, fn(i, startMs + i * H)));

// ── units & physics ──────────────────────────────────────────────────────────
test('wet/dry basis round-trip', () => {
  assert.ok(Math.abs(d.wbToDb(0.15) - 0.17647) < 1e-4);
  assert.ok(Math.abs(d.dbToWb(d.wbToDb(0.27)) - 0.27) < 1e-12);
  assert.throws(() => d.wbToDb(1));
});

test('VPD on known values', () => {
  // es(20 °C) = 2.338 kPa; VPD(30, 10) = 4.243 − 1.228 = 3.015 kPa (FAO-56 tables)
  assert.ok(Math.abs(d.satVapKPa(20) - 2.338) < 0.002);
  assert.ok(Math.abs(d.vpdKPa(30, 10) - 3.015) < 0.005);
  assert.equal(d.vpdKPa(10, 12), 0);
});

test('dew point ↔ RH are inverse', () => {
  const td = d.tdFromRh(25, 0.6);
  assert.ok(Math.abs(d.rhFromTd(25, td) - 0.6) < 1e-6);
  assert.throws(() => d.tdFromRh(25, 60), /fraction/); // percent must never reach the engine
});

test('EMC reproduces the two literature anchors at 20 °C', () => {
  const m070 = d.emcDb(20, 0.7, P.emc);
  const m085 = d.emcDb(20, 0.85, P.emc);
  assert.ok(Math.abs(d.dbToWb(m070) - 0.14) < 0.01, `aw 0.70 → ${d.dbToWb(m070)}`);
  assert.ok(Math.abs(m085 - 0.27) < 0.01, `RH 0.85 → ${m085}`);
});

test('EMC rises with RH, falls with T, stays under saturation', () => {
  assert.ok(d.emcDb(20, 0.5, P.emc) < d.emcDb(20, 0.8, P.emc));
  assert.ok(d.emcDb(35, 0.6, P.emc) < d.emcDb(10, 0.6, P.emc));
  assert.ok(d.emcDb(20, 0.99, P.emc) < P.mcSatDb);
  assert.throws(() => d.emcDb(20, 65, P.emc));
});

test('rain flags use the native block sum, not the smeared hourly value', () => {
  const t0 = Date.UTC(2026, 6, 1, 1); // labels 01,02,03 → block ending 03 UTC
  const times = [t0, t0 + H, t0 + 2 * H];
  const smeared = [0.17, 0.17, 0.17]; // 0.5 mm in 3 h
  assert.deepEqual(d.rainFlags(times, smeared, 1, 0.2), [false, false, false]);
  assert.deepEqual(d.rainFlags(times, [0.3, 0.3, 0.3], 3, 0.2), [true, true, true]);
  assert.deepEqual(d.rainFlags(times, [0.1, 0.1, 0.1], 3, 0.2), [false, false, false]);
});

// ── drying model ─────────────────────────────────────────────────────────────
test('a clear summer day dries straw from 30 % to below 15 %', () => {
  const hours = Array.from({ length: 24 }, (_, i) => {
    const w = sunny((4 + i) % 24);
    const td = d.tdFromRh(w.t2m, w.rh);
    return { ...w, td, rain: false, dew: d.isDewHour(w.t2m, td, w.windMs, w.rsWm2) };
  });
  const out = d.simulate(d.wbToDb(0.3), hours.slice(0, 13), P, 1);
  assert.ok(d.dbToWb(out.at(-1).mcDb) < 0.15, `end of day ${d.dbToWb(out.at(-1).mcDb)}`);
});

test('rain wets the straw and never dries it', () => {
  const rainy = { t2m: 18, rh: 0.95, td: 17, windMs: 2, rsWm2: 50, precipMm: 4, rain: true, dew: false };
  const [s] = d.simulate(d.wbToDb(0.14), [rainy], P, 1);
  assert.ok(s.mcDb > d.wbToDb(0.14));
  const [s2] = d.simulate(1.8, [rainy], P, 1); // already above saturation
  assert.equal(s2.mcDb, 1.8);
});

test('dew re-wets dry straw overnight', () => {
  const night = { t2m: 12, rh: 0.97, td: 11.5, windMs: 0.5, rsWm2: 0, precipMm: 0, rain: false, dew: true };
  const out = d.simulate(d.wbToDb(0.12), Array(6).fill(night), P, 1);
  assert.ok(out.at(-1).mcDb > d.wbToDb(0.12));
});

test('a turned swath dries faster than a narrow one', () => {
  const day = { t2m: 27, rh: 0.45, td: 14, windMs: 3, rsWm2: 600, precipMm: 0, rain: false, dew: false };
  const turned = d.simulate(d.wbToDb(0.3), Array(6).fill(day), P, P.swathFactor.turned).at(-1).mcDb;
  const narrow = d.simulate(d.wbToDb(0.3), Array(6).fill(day), P, P.swathFactor.narrow).at(-1).mcDb;
  assert.ok(turned < narrow);
});

test('missing weather holds the state', () => {
  const hole = { t2m: null, rh: null, td: null, windMs: null, rsWm2: null, precipMm: null, rain: false, dew: false };
  const [s] = d.simulate(0.4, [hole], P, 1);
  assert.equal(s.mcDb, 0.4);
  assert.equal(s.branch, 'hold');
});

// ── engine ───────────────────────────────────────────────────────────────────
test('engine: two dry models → narrow band, observed past, cumulative fields', () => {
  const r = d.runStrawEngine(baseInput());
  assert.equal(r.models.length, 2);
  assert.equal(r.mc0Source, 'default');
  assert.equal(r.missingPastHours, 0);
  const past = r.points.filter((p) => p.observed);
  const fut = r.points.filter((p) => !p.observed);
  assert.ok(past.length > 0 && fut.length > 0);
  assert.ok(past.every((p) => p.p10 === p.p90));
  assert.ok(fut.every((p) => p.p10 <= p.p50 && p.p50 <= p.p90));
  assert.ok(r.points.at(-1).dryHoursCum > 0);
  assert.equal(r.rainProbSource, 'models');
});

test('engine: a swath reading resets the state (median of the cluster)', () => {
  const nowMs = Date.UTC(2026, 6, 11, 6);
  const r = d.runStrawEngine(
    baseInput({
      readings: [
        { measuredAtMs: nowMs - 3 * H - 20 * 60_000, moistureWb: 0.22, kind: 'swath' },
        { measuredAtMs: nowMs - 3 * H - 10 * 60_000, moistureWb: 0.25, kind: 'swath' },
        { measuredAtMs: nowMs - 3 * H, moistureWb: 0.4, kind: 'swath' }, // wild probe
        { measuredAtMs: nowMs - 2 * H, moistureWb: 0.5, kind: 'bale' }, // bale → ignored
      ],
    }),
  );
  assert.equal(r.mc0Source, 'reading');
  const resetPt = r.points.find((p) => Date.parse(p.time) === nowMs - 3 * H);
  assert.ok(Math.abs(resetPt.p50 - 0.25) < 1e-3, `reset at median ${resetPt.p50}`);
});

test('engine: a reading taken during the current hour is not dropped', () => {
  const nowMs = Date.UTC(2026, 6, 11, 6, 40);
  const r = d.runStrawEngine(baseInput({ nowMs, readings: [{ measuredAtMs: nowMs - 10 * 60_000, moistureWb: 0.33, kind: 'swath' }] }));
  const branchPt = r.points.find((p) => Date.parse(p.time) === Date.UTC(2026, 6, 11, 6));
  assert.ok(Math.abs(branchPt.p50 - 0.33) < 1e-3);
});

test('engine: ensemble rain probability is used when present', () => {
  const nowMs = Date.UTC(2026, 6, 11, 6);
  const rp = new Map();
  for (let i = 1; i <= 72; i++) rp.set(nowMs + i * H, 0.6);
  const r = d.runStrawEngine(baseInput({ rainProb: rp }));
  assert.equal(r.rainProbSource, 'ensemble');
  assert.ok(r.points.filter((p) => !p.observed).every((p) => p.rainProb === 0.6));
});

// ── window / status ──────────────────────────────────────────────────────────
test('green: baleable now and the window is long enough', () => {
  const at = Date.UTC(2026, 6, 11, 6);
  const pts = hoursFrom(at, 48, (i) => (i < 8 ? {} : { dew: true }));
  const s = d.deriveStatus(pts, deriveOpts());
  assert.equal(s.status, 'green');
  assert.equal(s.window.end, new Date(at + 7 * H).toISOString());
  assert.ok(s.reasons.some((r) => r.key === 'baleUntil'));
  assert.ok(s.reasons.some((r) => r.key === 'endsBy.dew'));
});

test('yellow: baleable later in the 48 h', () => {
  const at = Date.UTC(2026, 6, 11, 6);
  const pts = hoursFrom(at, 48, (i) => (i < 5 ? { dew: true } : {}));
  const s = d.deriveStatus(pts, deriveOpts());
  assert.equal(s.status, 'yellow');
  assert.ok(s.reasons.some((r) => r.key === 'baleableFrom'));
  assert.ok(s.reasons.some((r) => r.key === 'blockedNow.dew'));
});

test('red: no baleable hour at all in 48 h', () => {
  const at = Date.UTC(2026, 6, 11, 6);
  const pts = hoursFrom(at, 48, () => ({ baleableFrac: 0, p50: 0.3 }));
  const s = d.deriveStatus(pts, deriveOpts());
  assert.equal(s.status, 'red');
  assert.equal(s.urgency, 0);
  assert.ok(s.reasons.some((r) => r.key === 'mainBlocker.moisture'));
});

test('a 40 ha parcel with two good days split by dew is yellow, not red', () => {
  const at = Date.UTC(2026, 6, 11, 3);
  // 8 good hours, 16 dew hours, 8 good hours — 16 baleable hours total.
  const pts = hoursFrom(at, 48, (i) => ({ dew: !(i < 8 || (i >= 24 && i < 32)) }));
  const s = d.deriveStatus(pts, deriveOpts({ atMs: at, computedAtMs: at, requiredHours: d.requiredHoursFor(40, 1.5), areaHa: 40 }));
  assert.notEqual(s.status, 'red');
  assert.ok(['green', 'yellow'].includes(s.status));
  assert.ok(s.reasons.some((r) => r.key === 'notEnoughForParcel'));
});

test('grey: no area, stale data, engine blocker', () => {
  const at = Date.UTC(2026, 6, 11, 6);
  const pts = hoursFrom(at, 48, () => ({}));
  assert.equal(d.deriveStatus(pts, deriveOpts({ requiredHours: null, areaHa: null })).reasons[0].key, 'noArea');
  assert.equal(d.deriveStatus(pts, deriveOpts({ computedAtMs: at - 7 * H })).reasons[0].key, 'staleData');
  assert.equal(d.deriveStatus(pts, deriveOpts({ newestIssuedAtMs: at - 13 * H })).reasons[0].key, 'staleData');
  assert.equal(d.deriveStatus(pts, deriveOpts({ blockingReason: { key: 'noHistory' } })).status, 'grey');
  assert.equal(d.deriveStatus([], deriveOpts()).status, 'grey');
  assert.equal(d.requiredHoursFor(null, 3), null);
  assert.equal(d.requiredHoursFor(0, 3), null);
  assert.equal(d.requiredHoursFor(10, 3), 4);
});

test('urgency: dry today + rain tomorrow outranks wet all week and dry all week', () => {
  const at = Date.UTC(2026, 6, 11, 6);
  const o = deriveOpts();
  const dryThenRain = d.deriveStatus(hoursFrom(at, 48, (i) => (i < 20 ? {} : { rainProb: 0.9, baleableFrac: 0 })), o);
  const dryAllWeek = d.deriveStatus(hoursFrom(at, 48, () => ({})), o);
  const wetAllWeek = d.deriveStatus(hoursFrom(at, 48, () => ({ baleableFrac: 0, rainProb: 0.8 })), o);
  assert.ok(dryThenRain.urgency > dryAllWeek.urgency);
  assert.ok(dryThenRain.urgency > wetAllWeek.urgency);
  const sorted = [wetAllWeek, dryAllWeek, dryThenRain].sort(d.compareByStatusAndUrgency);
  assert.equal(sorted[0], dryThenRain);
  assert.equal(sorted.at(-1), wetAllWeek);
});

test('status at a past instant (fingerprint) uses the snapshot hours around it', () => {
  const start = Date.UTC(2026, 6, 11, 0);
  const pts = hoursFrom(start, 72, (i) => (i < 10 ? { dew: true } : {}));
  const at6 = d.deriveStatus(pts, deriveOpts({ atMs: start + 6 * H, computedAtMs: start }));
  const at14 = d.deriveStatus(pts, deriveOpts({ atMs: start + 14 * H + 30 * 60_000, computedAtMs: start + 10 * H, newestIssuedAtMs: start + 6 * H }));
  // the same snapshot is too old to vouch for an instant 14.5 h after it was computed
  assert.equal(d.deriveStatus(pts, deriveOpts({ atMs: start + 14 * H, computedAtMs: start })).status, 'grey');
  assert.equal(at6.status, 'yellow');
  assert.equal(at14.status, 'green');
});

// ── fingerprint ──────────────────────────────────────────────────────────────
test('canonicalJson is deterministic and rejects non-JSON values', () => {
  assert.equal(d.canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined }), '{"a":[true,null,"x"],"b":1}');
  assert.equal(d.canonicalJson({ a: 1, b: 2 }), d.canonicalJson({ b: 2, a: 1 }));
  assert.throws(() => d.canonicalJson({ t: new Date() }));
  assert.throws(() => d.canonicalJson({ n: NaN }));
  assert.throws(() => d.canonicalJson([undefined]));
  assert.throws(() => d.canonicalJson({ big: 1n }));
});

test('buildFingerprint freezes the bale-hour values and the series since harvest', () => {
  const start = Date.UTC(2026, 6, 11, 0);
  const pts = hoursFrom(start, 72, (i) => ({ rainCumMm: i * 0.1, dryHoursCum: i }));
  const baledAt = new Date(start + 14 * H + 30 * 60_000).toISOString();
  const derived = d.deriveStatus(pts, deriveOpts({ atMs: Date.parse(baledAt), computedAtMs: start + 10 * H, newestIssuedAtMs: start + 6 * H }));
  const fp = d.buildFingerprint({
    baleProduction: { id: 'b1', parcelId: 'p1', baleCount: 40, productionDate: '2026-07-11', startTime: null, endTime: baledAt },
    baledAt,
    baledAtBasis: 'end_time',
    harvestEvent: { id: 'h1', harvestedAt: new Date(start + 2 * H).toISOString(), swathType: 'wide' },
    snapshot: { id: 's1', computedAt: new Date(start).toISOString(), modelVersion: 'straw-v1-uncalibrated', models: ['ecmwf_ifs', 'icon_eu'], points: pts },
    settings: { thresholdWb: 0.15, baleableFracMin: 0.8, rainProbMax: 0.2, minWindowH: 3, pressCapacityHaH: 3 },
    derived,
    runStatusAtCompute: 'yellow',
    measured: null,
    attribution: 'test',
  });
  assert.equal(fp.windowStatus, 'green');
  assert.equal(fp.dryingHours, 15); // label 15:00 covers 14:30
  assert.equal(fp.payload.series.length, 13); // labels 03:00..15:00 (after harvest at 02:00)
  const text = d.canonicalJson(fp.payload);
  assert.equal(text, d.canonicalJson(JSON.parse(text)));
});
