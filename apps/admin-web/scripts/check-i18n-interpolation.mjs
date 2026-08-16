#!/usr/bin/env node
/**
 * Verifică CONTRACTUL de interpolare al admin-web, nu forma textului.
 *
 * Un scanner al catalogului nu poate dovedi nimic aici: reparația a fost în
 * interpolate(), iar catalogul conține '{label}' și înainte, și după. Deci
 * compilăm funcția reală și o apelăm.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const messagesDir = join(appDir, 'messages');

const outDir = mkdtempSync(join(tmpdir(), 'sb-interp-'));
let interpolate;
try {
  execFileSync(
    'pnpm',
    ['exec', 'tsc', join(appDir, 'src/lib/interpolate.ts'), '--outDir', outDir,
     '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { cwd: appDir, stdio: 'pipe' },
  );
  ({ interpolate } = createRequire(import.meta.url)(join(outDir, 'interpolate.js')));
} catch (err) {
  console.error('i18n: nu am putut compila src/lib/interpolate.ts\n' + (err.stderr?.toString() ?? err.message));
  process.exit(1);
}

let failures = 0;
const check = (label, actual, expected) => {
  if (actual !== expected) {
    console.error(`  ✗ ${label}\n      așteptat: ${JSON.stringify(expected)}\n      primit:   ${JSON.stringify(actual)}`);
    failures++;
  }
};

check('acoladă dublă substituită', interpolate('a {{x}} b', { x: 1 }), 'a 1 b');
check('acoladă simplă substituită', interpolate('a {x} b', { x: 1 }), 'a 1 b');
check('acoladă simplă fără parametru rămâne literală', interpolate('a {x} b', {}), 'a {x} b');
check('acoladă dublă fără parametru devine gol', interpolate('a {{x}} b', {}), 'a  b');
check('fără parametri, textul e neatins', interpolate('a {x} {{y}} b'), 'a {x} {{y}} b');

/** Forme pe care NICIO trecere nu le înlocuiește — greșeli de scriere, nu convenții. */
const MALFORMED = /\{\s+\w+\s*\}|\{\s*\w+\s+\}|\$\{\w+\}/;

function flatten(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, p));
    else out.push([p, String(v)]);
  }
  return out;
}

for (const file of readdirSync(messagesDir).filter((f) => f.endsWith('.json') && !f.startsWith('.'))) {
  for (const [key, value] of flatten(JSON.parse(readFileSync(join(messagesDir, file), 'utf8')))) {
    const m = value.match(MALFORMED);
    if (m) {
      console.error(`  ✗ ${file} :: ${key} — placeholder malformat: ${m[0]}`);
      failures++;
    }
  }
}

rmSync(outDir, { recursive: true, force: true });

if (failures) {
  console.error(`\ni18n: ${failures} problemă/probleme de interpolare.`);
  process.exit(1);
}
console.log('i18n: contract de interpolare respectat (5/5), niciun placeholder malformat.');
