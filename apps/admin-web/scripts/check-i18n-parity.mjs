#!/usr/bin/env node
/**
 * Ensures ro.json defines the same nested keys as en.json (admin-web UI catalogs).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const messagesDir = join(__dirname, '../messages');

/** @param {Record<string, unknown>} obj */
function flattenKeys(obj, prefix = '') {
  /** @type {string[]} */
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(/** @type {Record<string, unknown>} */ (v), p));
    } else {
      keys.push(p);
    }
  }
  return keys.sort();
}

const en = JSON.parse(readFileSync(join(messagesDir, 'en.json'), 'utf8'));
const ro = JSON.parse(readFileSync(join(messagesDir, 'ro.json'), 'utf8'));
const enKeys = new Set(flattenKeys(en));
const roKeys = new Set(flattenKeys(ro));
const missingInRo = [...enKeys].filter((k) => !roKeys.has(k));
const extraInRo = [...roKeys].filter((k) => !enKeys.has(k));

if (missingInRo.length || extraInRo.length) {
  console.error('i18n parity check failed.');
  if (missingInRo.length) {
    console.error('\nMissing in ro.json:\n' + missingInRo.join('\n'));
  }
  if (extraInRo.length) {
    console.error('\nExtra in ro.json:\n' + extraInRo.join('\n'));
  }
  process.exit(1);
}

console.log(`i18n: en.json and ro.json keys match (${enKeys.size} keys).`);
