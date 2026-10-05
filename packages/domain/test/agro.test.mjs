// Agro indicators, climatology and meteo alerts — dependency-free `node --test`
// against the compiled package (build packages first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const d = require('../dist/index.js');
const H = 3_600_000;
const T0 = Date.UTC(2026, 6, 10, 6); // 09:00 Bucharest (UTC+3)

const hour = (i, over = {}) => ({
  timeMs: T0 + i * H,
  tempC: 15,
  dewPointC: 5,
  precipMm: 0,
  precipProb: 0,
  windMs: 2,
  gustMs: 4,
  leafWetProb: 0,
  soilTemp0C: 12,
  soilMoist0to1: 0.2,
  soilMoist3to9: 0.22,
  capeJkg: 100,
  isDay: true,
  ...over,
});
const series = (n, fn = () => ({})) => Array.from({ length: n }, (_, i) => hour(i, fn(i)));
const localDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(ms);

// ── spraying ─────────────────────────────────────────────────────────────────
test('spray: calm sunny 15 °C gives one long window', () => {
  const hs = series(24);
  assert.equal(d.sprayHour(hs, 0).ok, true);
  const w = d.sprayWindows(hs, T0);
  assert.equal(w.length, 1);
  assert.equal(w[0].startMs, T0);
});

test('spray: each threshold blocks with its reason', () => {
  const at = (over) => d.sprayHour(series(12, (i) => (i === 0 ? over : {})), 0);
  assert.deepEqual(at({ gustMs: 8 }).reasons, ['gust']);
  assert.deepEqual(at({ windMs: 0.3 }).reasons, ['calm']);
  assert.deepEqual(at({ windMs: 5, gustMs: 6 }).reasons, ['wind']);
  assert.deepEqual(at({ tempC: 6, dewPointC: 0 }).reasons, ['too_cold']);
  assert.deepEqual(at({ tempC: 27 }).reasons, ['too_hot']);
  assert.deepEqual(at({ leafWetProb: 0.6 }).reasons, ['leaf_wet']);
  assert.deepEqual(at({ dewPointC: 14.2 }).reasons, ['leaf_wet']);
  assert.deepEqual(at({ precipMm: 0.5 }).reasons, ['rain_now']);
});

test('spray: rain at +5 h blocks, rain at +7 h does not; probability 25 % blocks', () => {
  assert.deepEqual(d.sprayHour(series(12, (i) => (i === 5 ? { precipMm: 1 } : {})), 0).reasons, ['rain_soon']);
  assert.equal(d.sprayHour(series(12, (i) => (i === 7 ? { precipMm: 1 } : {})), 0).ok, true);
  assert.deepEqual(d.sprayHour(series(12, (i) => (i === 3 ? { precipProb: 0.25 } : {})), 0).reasons, ['rain_soon']);
});

test('spray: unknown at the end of the series and with missing data', () => {
  const hs = series(10);
  assert.equal(d.sprayHour(hs, 5).ok, null); // only 4 hours ahead
  assert.equal(d.sprayHour(series(10, (i) => (i === 0 ? { windMs: null } : {})), 0).ok, null);
});

test('spray: a single good hour is not a window', () => {
  const hs = series(20, (i) => (i === 3 ? {} : { gustMs: 9 }));
  assert.equal(d.sprayWindows(hs, T0).length, 0);
});

// ── workability ──────────────────────────────────────────────────────────────
test('field workability levels and reasons', () => {
  assert.equal(d.fieldWorkability({ soilMoist0to1: 0.42, soilMoist3to9: 0.42, rainPast48hMm: 0, rainNext24hMm: 0 }).level, 'no_go');
  const m = d.fieldWorkability({ soilMoist0to1: 0.25, soilMoist3to9: 0.25, rainPast48hMm: 12, rainNext24hMm: 0 });
  assert.equal(m.level, 'marginal');
  assert.ok(m.reasons.includes('rain_recent'));
  const c = d.fieldWorkability({ soilMoist0to1: 0.2, soilMoist3to9: 0.2, rainPast48hMm: 0, rainNext24hMm: 15 });
  assert.equal(c.level, 'marginal');
  assert.deepEqual(c.reasons, ['rain_coming']);
  assert.equal(d.fieldWorkability({ soilMoist0to1: null, soilMoist3to9: null, rainPast48hMm: null, rainNext24hMm: null }).level, 'unknown');
});

// ── risks ────────────────────────────────────────────────────────────────────
test('frost: air near zero is low, frozen soil is high, beyond horizon ignored', () => {
  assert.equal(d.frostRisk(series(48, (i) => (i === 20 ? { tempC: 1.5 } : {})), T0).level, 'low');
  const r = d.frostRisk(series(48, (i) => (i === 20 ? { tempC: 2.5, soilTemp0C: -0.5 } : {})), T0);
  assert.equal(r.level, 'high');
  assert.equal(r.minSoilC, -0.5);
  assert.equal(d.frostRisk(series(80, (i) => (i === 70 ? { tempC: -3 } : {})), T0).level, 'none');
});

test('heat stress thresholds', () => {
  assert.equal(d.heatStress([{ date: '2026-07-10', tMaxC: 33 }]).level, 'moderate');
  assert.equal(d.heatStress([{ date: '2026-07-10', tMaxC: 28 }, { date: '2026-07-11', tMaxC: 36 }]).level, 'high');
  assert.equal(d.heatStress([]).level, 'none');
});

test('storm risk needs instability AND precipitation', () => {
  assert.equal(d.stormRisk(series(24, (i) => (i === 5 ? { capeJkg: 2500, precipProb: 0.2 } : {})), T0).level, 'none');
  assert.equal(d.stormRisk(series(24, (i) => (i === 5 ? { capeJkg: 1200, precipProb: 0.5 } : {})), T0).level, 'moderate');
  assert.equal(d.stormRisk(series(24, (i) => (i === 5 ? { capeJkg: 2100, precipProb: 0.6 } : {})), T0).level, 'high');
});

test('water balance: ET0 vs rain over 7 days', () => {
  const days = Array.from({ length: 10 }, () => ({ et0Mm: 4, precipMm: 1 }));
  const w = d.waterBalance(days);
  assert.equal(w.days, 7);
  assert.equal(w.et0Mm, 28);
  assert.equal(w.rainMm, 7);
  assert.equal(w.balanceMm, -21);
  assert.equal(w.deficit, true);
  assert.equal(d.waterBalance([{ et0Mm: null, precipMm: null }]).balanceMm, null);
});

test('weather icons by code and day/night', () => {
  assert.equal(d.weatherIcon(0, false), 'clear_night');
  assert.equal(d.weatherIcon(0, true), 'clear');
  assert.equal(d.weatherIcon(96, true), 'thunderstorm_hail');
  assert.equal(d.weatherIcon(63, true), 'rain');
  assert.equal(d.weatherIcon(1234, true), 'unknown');
  assert.equal(d.weatherIcon(null, true), 'unknown');
});

// ── climate ──────────────────────────────────────────────────────────────────
test('doyIndex uses a fixed leap calendar', () => {
  assert.equal(d.doyIndex('2025-03-01'), 60);
  assert.equal(d.doyIndex('2024-03-01'), 60);
  assert.equal(d.doyIndex('2024-02-29'), 59);
  assert.equal(d.doyIndex('2025-12-31'), 365);
});

test('climate normals from two synthetic years', () => {
  const days = [];
  for (const y of ['2023', '2024']) {
    for (const date of d.datesBetween(`${y}-01-01`, `${y}-12-31`)) {
      days.push({ date, tmeanC: y === '2023' ? 10 : 12, precipMm: 1 });
    }
  }
  const n = d.buildClimateNormals(days);
  assert.equal(n.years, 2);
  assert.equal(n.doyTmean.length, 366);
  assert.equal(n.doyTmean[0], 11);
  assert.equal(n.doyTmean[59], 12); // Feb 29 only from 2024
  assert.equal(n.monthly[0].precipMm, 31); // mean January total
  assert.equal(n.monthly[0].tmeanC, 11);
  assert.equal(n.doyGdd5[10], 6);
});

test('GDD and normal sums', () => {
  assert.equal(d.gddDay(-3, 0), 0);
  assert.equal(d.gddDay(12, 5), 7);
  assert.equal(d.gddBaseFor('grau'), 0);
  assert.equal(d.gddBaseFor('rapita'), 5);
  assert.equal(d.gddBaseFor(null), 5);
  const ones = new Array(366).fill(1);
  assert.equal(d.sumNormal(ones, '2025-12-30', '2026-01-02'), 4);
  assert.equal(d.sumNormal(ones, '2025-02-27', '2025-03-01'), 3); // no Feb 29 in 2025
});

test('climate anomaly', () => {
  assert.deepEqual(d.climateAnomaly({ actualTmean: 14.26, normalTmean: 12, actualPrecip: 30, normalPrecip: 40 }), { anomalyC: 2.3, precipPct: 75 });
  assert.equal(d.climateAnomaly({ actualTmean: null, normalTmean: 12, actualPrecip: 5, normalPrecip: 0.5 }).precipPct, null);
});

// ── alerts ───────────────────────────────────────────────────────────────────
const th = { ...d.ALERT_DEFAULTS, lookaheadH: 48 };
const nightStart = Date.UTC(2026, 9, 10, 18); // 21:00 local

test('a frost night across midnight is ONE alert, on the day of the minimum', () => {
  const hs = Array.from({ length: 14 }, (_, i) => ({
    ...hour(0),
    timeMs: nightStart + i * H,
    tempC: i >= 1 && i <= 9 ? (i === 7 ? -2 : -0.5) : 4,
  }));
  const c = d.evaluateMeteoAlerts(hs, nightStart - H, th, localDay);
  const frost = c.filter((x) => x.alertType === 'frost');
  assert.equal(frost.length, 1);
  assert.equal(frost[0].localDay, localDay(nightStart + 7 * H));
  assert.equal(frost[0].peakValue, -2);
  assert.equal(frost[0].severity, 'warning');
});

test('two frosts 24 h apart are two alerts; deep frost is severe', () => {
  const hs = Array.from({ length: 40 }, (_, i) => ({
    ...hour(0),
    timeMs: nightStart + i * H,
    tempC: i === 6 ? -1 : i === 30 ? -4 : 5,
  }));
  const frost = d.evaluateMeteoAlerts(hs, nightStart - H, th, localDay).filter((x) => x.alertType === 'frost');
  assert.equal(frost.length, 2);
  assert.equal(frost[1].severity, 'severe');
});

test('wind gust severity and storm needs precipitation', () => {
  const hs = Array.from({ length: 10 }, (_, i) => ({ ...hour(0), timeMs: T0 + (i + 1) * H, gustMs: i === 3 ? 25 : 5 }));
  const w = d.evaluateMeteoAlerts(hs, T0, th, localDay).filter((x) => x.alertType === 'wind');
  assert.equal(w.length, 1);
  assert.equal(w[0].severity, 'severe');
  const dry = Array.from({ length: 10 }, (_, i) => ({ ...hour(0), timeMs: T0 + (i + 1) * H, capeJkg: 3000, precipProb: 0.1 }));
  assert.equal(d.evaluateMeteoAlerts(dry, T0, th, localDay).filter((x) => x.alertType === 'storm').length, 0);
});

test('heavy rain is a daily total per local day', () => {
  const split = Array.from({ length: 4 }, (_, i) => ({
    ...hour(0),
    timeMs: Date.UTC(2026, 9, 10, 19 + i * 2), // 22:00, 00:00, 02:00, 04:00 local
    precipMm: 7.5,
  }));
  assert.equal(d.evaluateMeteoAlerts(split, split[0].timeMs - H, th, localDay).filter((x) => x.alertType === 'heavy_rain').length, 0);
  const oneDay = Array.from({ length: 3 }, (_, i) => ({ ...hour(0), timeMs: T0 + (i + 1) * H, precipMm: 10 }));
  const r = d.evaluateMeteoAlerts(oneDay, T0, th, localDay).filter((x) => x.alertType === 'heavy_rain');
  assert.equal(r.length, 1);
  assert.equal(r[0].peakValue, 30);
  assert.equal(r[0].severity, 'warning');
});

test('alerts honour the lookahead and changed thresholds', () => {
  const far = Array.from({ length: 60 }, (_, i) => ({ ...hour(0), timeMs: T0 + (i + 1) * H, tempC: i === 50 ? -5 : 5 }));
  assert.equal(d.evaluateMeteoAlerts(far, T0, { ...th, lookaheadH: 36 }, localDay).length, 0);
  const warm = Array.from({ length: 10 }, (_, i) => ({ ...hour(0), timeMs: T0 + (i + 1) * H, tempC: 20 }));
  assert.equal(d.evaluateMeteoAlerts(warm, T0, th, localDay).length, 0);
  assert.equal(d.evaluateMeteoAlerts(warm, T0, { ...th, heatC: 15 }, localDay)[0].alertType, 'heat');
});
