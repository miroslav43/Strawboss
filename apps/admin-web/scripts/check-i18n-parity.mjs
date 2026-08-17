#!/usr/bin/env node
/**
 * Gard de paritate și calitate pentru cataloagele admin-web (apps/admin-web/messages/*.json).
 *
 * `en.json` e referința. Fiecare alt `<locale>.json` din messages/ trebuie să
 * definească exact aceleași frunze — nici mai multe, nici mai puține — și să nu
 * lase nicio frunză goală.
 *
 * Limbile se DESCOPERĂ din director: orice `*.json` al cărui nume de bază e
 * exact un cod de limbă (`/^[a-z]{2}$/`, ex. `en`, `ro`, `hu`). Adăugarea uneia
 * = pui un fișier acolo; aici nu e nimic de editat. Un `*.json` care nu se
 * potrivește tiparului (ex. un `en.backup.json` uitat de un editor) e IGNORAT,
 * nu tratat ca limbă nouă — dar ignorarea se anunță pe stderr, ca să nu treacă
 * neobservată. Varianta veche hardcoda 'en.json' și 'ro.json' ca literale, deci
 * un al treilea catalog (hu.json) era complet invizibil pentru gard.
 *
 * Verificarea VALORILOR există fiindcă paritatea de chei singură e o iluzie
 * de siguranță: un catalog clonat din engleză și netradus are paritate
 * perfectă de chei — exact starea hu.json până la finalul Fazei 3.
 *
 * ── DOUĂ NIVELURI DE SEVERITATE, deliberat ──────────────────────────────
 *  STRUCTURAL (cheie lipsă / cheie în plus / valoare goală) — eșuează
 *  ÎNTOTDEAUNA, indiferent de flag. Sunt rupturi reale: o cheie lipsă
 *  afișează altă limbă utilizatorului.
 *
 *  NETRADUS (valoare identică cu engleza, neaflată în allowlist-ul limbii
 *  respective) — se RAPORTEAZĂ întotdeauna (număr pe stderr, deci vizibil
 *  chiar și cu stdout redirecționat spre /dev/null din cmd_typecheck; lista
 *  completă de chei pe stdout la rulare directă), dar eșuează doar cu
 *  --strict. hu.json e bifurcat din engleză la începutul Fazei 1 și rămâne
 *  netradus până la finalul Fazei 3; dacă „netradus" ar eșua implicit,
 *  `./strawboss.sh typecheck admin-web` ar fi roșu zece taskuri la rând — un
 *  gard care țipă mereu e un gard pe care toată lumea învață să-l ignore,
 *  exact patologia pe care faza asta vine s-o repare. Modul implicit rulează
 *  în typecheck și rămâne verde cât timp traducerea e în curs; --strict e
 *  poarta de ieșire a Fazei 3 și a verificării finale.
 *
 * ── ALLOWLIST PE LIMBĂ, nu una singură comună ────────────────────────────
 *  `.identical-ok.json` are `allow` (universal — unități, coduri de document
 *  și instituție, formate de fișier, nume de brand: identice în ORICE limbă)
 *  și `byLocale.<cod>` (scutiri specifice unei singure limbi). Un cuvânt care
 *  e cognat autentic într-o limbă de obicei NU e cognat în alta — româna
 *  păstrează „Total"/„Status" nemodificate, dar maghiara are nevoie de
 *  „Összesen"/„Státusz". O allowlist comună, derivată din română, ar
 *  suprima semnalul de netradus pentru maghiară exact pe cuvintele astea —
 *  mai rău decât gardul vechi, care cel puțin nu mințea. Mulțimea efectivă
 *  pentru o limbă e `allow ∪ byLocale[limbă]`; `byLocale[limbă]` lipsă
 *  înseamnă mulțime vidă.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const strict = process.argv.includes('--strict');
const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '../messages');
const REFERENCE = 'en';
/**
 * Numele de bază al unui catalog de limbă: exact două litere minuscule
 * (cod ISO 639-1, cum e SSOT-ul acum). Dacă se adaugă vreodată o variantă
 * regională (ex. `pt-BR.json`), extinde la /^[a-z]{2}(-[A-Z]{2})?$/ — nu e
 * nevoie acum, deci nu o generalizăm prematur.
 */
const LOCALE_RE = /^[a-z]{2}$/;

/** @param {string} path @returns {unknown} */
function parseJsonFile(path) {
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`i18n: ${basename(path)} nu e JSON valid — ${err.message}`);
    process.exit(1);
  }
}

const allowFile = join(messagesDir, '.identical-ok.json');
/** @type {{ allow?: string[], byLocale?: Record<string, string[]> }} */
const allowConfig = existsSync(allowFile) ? parseJsonFile(allowFile) : {};
/** Frunze permise identice cu engleza în ORICE limbă: unități, coduri, branduri. */
const universalAllow = new Set(allowConfig.allow ?? []);
/** Frunze permise identice cu engleza doar pentru limba respectivă. */
const byLocaleAllow = new Map(
  Object.entries(allowConfig.byLocale ?? {}).map(([locale, keys]) => [locale, new Set(keys)]),
);
/** @param {string} locale @param {string} key */
function isAllowedIdentical(locale, key) {
  return universalAllow.has(key) || (byLocaleAllow.get(locale)?.has(key) ?? false);
}

/** @param {Record<string, unknown>} obj @returns {Map<string,string>} */
function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, p, out);
    else out.set(p, String(v));
  }
  return out;
}

const jsonFiles = readdirSync(messagesDir).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
const locales = [];
for (const f of jsonFiles) {
  const base = basename(f, '.json');
  if (LOCALE_RE.test(base)) {
    locales.push(base);
  } else {
    console.error(
      `i18n: ignor ${f} — numele nu e un cod de limbă de 2 litere (ex. 'en', 'ro', 'hu').`,
    );
  }
}

if (!locales.includes(REFERENCE)) {
  console.error(`i18n: lipsește catalogul de referință ${REFERENCE}.json`);
  process.exit(1);
}

const ref = flatten(parseJsonFile(join(messagesDir, `${REFERENCE}.json`)));

let structuralFailed = false;
let grandUntranslated = 0;
const perLocaleUntranslated = [];

for (const locale of locales.filter((l) => l !== REFERENCE)) {
  const cat = flatten(parseJsonFile(join(messagesDir, `${locale}.json`)));

  const missing = [...ref.keys()].filter((k) => !cat.has(k));
  const extra = [...cat.keys()].filter((k) => !ref.has(k));
  const empty = [...cat].filter(([, v]) => v.trim() === '').map(([k]) => k);
  const untranslated = [...cat]
    .filter(([k, v]) => ref.get(k) === v && !isAllowedIdentical(locale, k))
    .map(([k]) => k);

  const structuralProblems = [
    ['lipsesc din', missing],
    ['în plus în', extra],
    ['goale în', empty],
  ].filter(([, list]) => list.length);

  if (structuralProblems.length) {
    structuralFailed = true;
    console.error(`\n✗ ${locale}.json — STRUCTURAL (eșuează întotdeauna, orice mod)`);
    for (const [label, list] of structuralProblems) {
      console.error(`  ${list.length} ${label} ${locale}.json:`);
      console.error(
        list
          .slice(0, 40)
          .map((k) => `    ${k}`)
          .join('\n'),
      );
      if (list.length > 40) console.error(`    … și încă ${list.length - 40}`);
    }
  } else {
    console.log(
      `✓ ${locale}.json — structural OK (${cat.size} chei, paritate cu ${REFERENCE}.json)`,
    );
  }

  if (untranslated.length) {
    grandUntranslated += untranslated.length;
    perLocaleUntranslated.push([locale, untranslated.length]);
    const verdict = strict ? '✗ EȘUEAZĂ' : '⚠ NU eșuează implicit';
    console.error(
      `${verdict}: ${locale}.json are ${untranslated.length} frunze NETRADUSE ` +
        `(identice cu ${REFERENCE}.json)` +
        (strict ? ' — cerut --strict.' : ' — rulează cu --strict ca poartă de ieșire.'),
    );
    console.log(`  frunze netraduse din ${locale}.json:`);
    console.log(
      untranslated
        .slice(0, 40)
        .map((k) => `    ${k}`)
        .join('\n'),
    );
    if (untranslated.length > 40) console.log(`    … și încă ${untranslated.length - 40}`);
  } else {
    console.log(`✓ ${locale}.json — 0 frunze netraduse`);
  }
}

const untranslatedFails = strict && grandUntranslated > 0;

if (structuralFailed || untranslatedFails) {
  console.error('\ni18n: verificarea cataloagelor a eșuat.');
  if (structuralFailed) {
    console.error('  — probleme STRUCTURALE de mai sus (întotdeauna fatale, orice mod).');
  }
  if (untranslatedFails) {
    console.error(
      `  — ${grandUntranslated} frunze netraduse ` +
        `(${perLocaleUntranslated.map(([l, n]) => `${l}: ${n}`).join(', ')}) și a fost cerut --strict.`,
    );
  }
  process.exit(1);
}

if (grandUntranslated > 0) {
  console.error(
    `\ni18n: VERDE, DAR NETERMINAT — ${grandUntranslated} frunze netraduse rămase ` +
      `(${perLocaleUntranslated.map(([l, n]) => `${l}: ${n}`).join(', ')}). ` +
      'Nu e eșec în modul implicit; rulează cu --strict ca poartă finală a Fazei 3. ' +
      'Nu confunda acest verde cu „gata".',
  );
} else {
  console.log(`\ni18n: ${locales.length} cataloage — structural OK, 0 frunze netraduse.`);
}
