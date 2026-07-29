#!/usr/bin/env node
/**
 * Invariant checks for the per-organization feature-toggle system.
 *
 * Written as a dependency-free Node script rather than unit tests on purpose:
 * this repo has no test runner at all (no vitest, no jest, zero *.test.ts), and
 * node_modules is root-owned so a workspace `pnpm add` is not available to the
 * dev user. These checks are the ones that actually matter, and they run with
 * plain `node`.
 *
 *   node scripts/check-features.mjs
 *
 * Requires `./strawboss.sh build packages` first (it reads the built registry).
 * Exits non-zero on the first failed invariant.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = join(ROOT, 'packages/types/dist/features.js');

let failures = 0;
let checks = 0;

function check(name, fn) {
  checks++;
  try {
    const detail = fn();
    console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const {
  FEATURE_KEYS,
  FEATURES,
  FEATURE_MODULES,
  FEATURE_PRESETS,
  resolveDisabledFeatures,
  isFeatureEnabled,
} = await import(pathToFileURL(registryPath).href);

console.log('\nFeature registry invariants\n');

/*
 * THE deploy-safety proof. Storage is sparse, so an untouched org holds `{}`
 * and its behaviour is decided entirely by the registry defaults. If this ever
 * returns a non-empty list, shipping the code silently switches that feature
 * off for every existing organization.
 */
check('an untouched org resolves to zero disabled features', () => {
  const disabled = resolveDisabledFeatures({});
  assert(disabled.length === 0, `expected [], got [${disabled.join(', ')}]`);
  return `${FEATURE_KEYS.length} keys`;
});

check('every registry default is true', () => {
  const offenders = FEATURE_KEYS.filter((k) => FEATURES[k].defaultEnabled !== true);
  assert(
    offenders.length === 0,
    `defaultEnabled must be true (use FEATURE_PRESETS.new_org instead): ${offenders.join(', ')}`,
  );
});

check('every key has a definition and every definition a key', () => {
  const keys = new Set(FEATURE_KEYS);
  const defined = new Set(Object.keys(FEATURES));
  const missing = [...keys].filter((k) => !defined.has(k));
  const extra = [...defined].filter((k) => !keys.has(k));
  assert(missing.length === 0, `no FeatureDef for: ${missing.join(', ')}`);
  assert(extra.length === 0, `FeatureDef with no key: ${extra.join(', ')}`);
});

check('every dependsOn target exists', () => {
  const keys = new Set(FEATURE_KEYS);
  const bad = [];
  for (const key of FEATURE_KEYS) {
    for (const dep of FEATURES[key].dependsOn) {
      if (!keys.has(dep)) bad.push(`${key} -> ${dep}`);
    }
  }
  assert(bad.length === 0, `unknown dependsOn: ${bad.join(', ')}`);
});

check('the dependency graph is acyclic', () => {
  // The resolver's fixed-point loop is bounded so a cycle cannot hang a
  // request, but a cycle would still make the result order-dependent.
  const state = new Map();
  const visit = (key, trail) => {
    if (state.get(key) === 'done') return;
    assert(state.get(key) !== 'visiting', `cycle: ${[...trail, key].join(' -> ')}`);
    state.set(key, 'visiting');
    for (const dep of FEATURES[key].dependsOn) visit(dep, [...trail, key]);
    state.set(key, 'done');
  };
  for (const key of FEATURE_KEYS) visit(key, []);
});

check('every leaf belongs to its module and depends on it (directly or not)', () => {
  const modules = new Set(FEATURE_MODULES);
  const reaches = (key, target, seen = new Set()) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return FEATURES[key].dependsOn.some((d) => d === target || reaches(d, target, seen));
  };
  const bad = [];
  for (const key of FEATURE_KEYS) {
    if (modules.has(key)) continue;
    const mod = FEATURES[key].module;
    assert(key.startsWith(`${mod}.`), `${key} claims module '${mod}'`);
    if (!reaches(key, mod)) bad.push(key);
  }
  assert(bad.length === 0, `leaf not reachable to its module row: ${bad.join(', ')}`);
});

check('switching a module off cascades to all its leaves', () => {
  for (const mod of FEATURE_MODULES) {
    const disabled = new Set(resolveDisabledFeatures({ [mod]: false }));
    const leaves = FEATURE_KEYS.filter((k) => k !== mod && FEATURES[k].module === mod);
    const escaped = leaves.filter((k) => !disabled.has(k));
    assert(escaped.length === 0, `${mod} off but still enabled: ${escaped.join(', ')}`);
    assert(disabled.has(mod), `${mod} off did not disable itself`);
  }
  return `${FEATURE_MODULES.length} modules`;
});

check('an unknown key is treated as ENABLED (old clients keep working)', () => {
  assert(isFeatureEnabled([], 'anything'), 'empty disabled list must mean everything on');
  assert(
    isFeatureEnabled(['costs.fuel'], 'a.key.from.a.newer.release'),
    'unknown keys must fail open',
  );
  assert(!isFeatureEnabled(['costs.fuel'], 'costs.fuel'), 'a listed key must read as disabled');
});

check('a module row is wired only when every one of its leaves is', () => {
  const bad = [];
  for (const mod of FEATURE_MODULES) {
    if (!FEATURES[mod].wired) continue;
    const leaves = FEATURE_KEYS.filter((k) => k !== mod && FEATURES[k].module === mod);
    const unwired = leaves.filter((k) => !FEATURES[k].wired);
    if (unwired.length) bad.push(`${mod} (unwired leaves: ${unwired.join(', ')})`);
  }
  assert(bad.length === 0, bad.join('; '));
  const wired = FEATURE_KEYS.filter((k) => FEATURES[k].wired);
  return `${wired.length}/${FEATURE_KEYS.length} wired`;
});

check('presets reference only real keys, and enterprise is empty', () => {
  const keys = new Set(FEATURE_KEYS);
  for (const [name, overrides] of Object.entries(FEATURE_PRESETS)) {
    for (const key of Object.keys(overrides)) {
      assert(keys.has(key), `preset '${name}' references unknown key '${key}'`);
    }
  }
  assert(
    Object.keys(FEATURE_PRESETS.enterprise).length === 0,
    'enterprise must be {} (pure registry defaults), not an explicit all-true map',
  );
});

/*
 * Coverage, not correctness: enumerate every write route in the backend and
 * report the ones that carry neither @RequireFeature nor a CORE exemption.
 * Review discipline is not what keeps the gate complete — this list is.
 */
console.log('\nBackend write-route coverage\n');

const CONTROLLER_ROOT = join(ROOT, 'backend/service/src');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

const WRITE_DECORATOR = /@(Post|Put|Patch|Delete)\(/;
const controllers = walk(CONTROLLER_ROOT);
const ungated = [];
let totalWrites = 0;

for (const file of controllers) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const classGated = lines.some((l) => l.includes('@RequireFeature('));
  for (let i = 0; i < lines.length; i++) {
    if (!WRITE_DECORATOR.test(lines[i])) continue;
    totalWrites++;
    // Scan the decorator block between this route and its handler signature.
    let gated = false;
    for (let j = i; j < Math.min(i + 12, lines.length); j++) {
      if (lines[j].includes('@RequireFeature(')) {
        gated = true;
        break;
      }
      if (j > i && /^\s{2}(async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(lines[j])) break;
    }
    if (!gated) {
      ungated.push({
        file: relative(ROOT, file),
        line: i + 1,
        route: lines[i].trim(),
        classGated,
      });
    }
  }
}

console.log(`  ${totalWrites} write routes across ${controllers.length} controllers`);
console.log(`  ${totalWrites - ungated.length} gated, ${ungated.length} ungated\n`);
console.log('  Ungated (each must be a deliberate CORE exemption — see features.ts header):');
const byFile = new Map();
for (const u of ungated) byFile.set(u.file, (byFile.get(u.file) ?? 0) + 1);
for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(count).padStart(3)}  ${file}`);
}

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} invariants held\n`,
);
process.exit(failures === 0 ? 0 : 1);
