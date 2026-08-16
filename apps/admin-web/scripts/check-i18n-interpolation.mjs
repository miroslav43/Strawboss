#!/usr/bin/env node
/**
 * Fiecare placeholder dintr-un catalog trebuie să fie de o formă pe care
 * `interpolate()` din src/lib/i18n.tsx chiar o înlocuiește.
 *
 * Excepții: chei unde `{...}` e text literal, nu placeholder.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '../messages');

/** Chei unde acoladele sunt text literal afișat utilizatorului. */
const LITERAL_BRACES = new Set(['settings.organization.accessCodeHint']);

/** Chei interpolate manual la locul apelului, nu prin t(). */
const MANUAL_INTERPOLATION = new Set([
  'beneficiaries.deleteConfirm',
  'beneficiaryPortal.pinStep1Title',
]);

function flatten(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, p));
    else out.push([p, String(v)]);
  }
  return out;
}

let failures = 0;
for (const file of readdirSync(messagesDir).filter((f) => f.endsWith('.json'))) {
  const cat = JSON.parse(readFileSync(join(messagesDir, file), 'utf8'));
  for (const [key, value] of flatten(cat)) {
    if (LITERAL_BRACES.has(key) || MANUAL_INTERPOLATION.has(key)) continue;
    // Scoate întâi {{x}}, apoi vezi dacă a mai rămas vreun {x}.
    const leftover = value.replace(/\{\{(\w+)\}\}/g, '').match(/\{(\w+)\}/g);
    if (leftover) {
      console.error(`${file} :: ${key} — placeholder cu acoladă simplă: ${leftover.join(', ')}`);
      failures++;
    }
  }
}

if (failures) {
  console.error(`\ni18n: ${failures} placeholder(e) pe care interpolate() nu le înlocuiește.`);
  process.exit(1);
}
console.log('i18n: toate placeholder-ele sunt de o formă interpolabilă.');
