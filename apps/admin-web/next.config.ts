import type { NextConfig } from 'next';
import { loadEnvConfig } from '@next/env';
import path from 'path';
import { realpathSync, existsSync, readFileSync } from 'fs';

const projectRoot = __dirname; // apps/admin-web
const monorepoRoot = path.resolve(projectRoot, '../..');

/**
 * `@next/env` merge rule: a key from a later `.env*` file is skipped if it already
 * exists on `process.env` (even as `""`). CI/shell sometimes exports empty
 * `NEXT_PUBLIC_*`, which blocks the repo root `.env` — then `next build` prerender
 * fails with "supabaseUrl is required". We re-apply root `.env` for public keys
 * when the current value is missing or blank.
 */
function mergeRootEnvFromDotenvFile(): void {
  const filePath = path.join(monorepoRoot, '.env');
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key.startsWith('NEXT_PUBLIC_')) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    const cur = process.env[key];
    if (cur === undefined || cur === '') {
      process.env[key] = val;
    }
  }
}

// Load Strawboss root `.env` / `.env.local` so `NEXT_PUBLIC_*` exist when Next runs from apps/admin-web.
loadEnvConfig(monorepoRoot, process.env.NODE_ENV === 'development');
mergeRootEnvFromDotenvFile();

/**
 * pnpm may hoist a package only under `apps/admin-web/node_modules` (e.g. Docker
 * install) while omitting the symlink at repo root. Webpack aliases must use a
 * path that actually exists or resolution fails with "Can't resolve".
 */
function resolvePackageDir(pkgName: string): string | null {
  const candidates = [
    path.resolve(monorepoRoot, 'node_modules', pkgName),
    path.resolve(projectRoot, 'node_modules', pkgName),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) {
        return realpathSync(c);
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/**
 * Resolves a package from the monorepo (root or admin-web node_modules) and returns
 * paths for both Turbopack (relative, from project root) and webpack (absolute canonical).
 *
 * Why we need this: pnpm creates per-workspace symlinks even with shamefully-hoist,
 * so @strawboss/api resolves @tanstack/react-query via its OWN local symlink, giving
 * a different module path than admin-web — two React Query contexts → "No QueryClient set".
 *
 * Turbopack bug: absolute paths (starting with /) get ./  prepended, becoming invalid.
 * Workaround: use a relative path (../../...) from the project root instead.
 */
function resolveShared(pkgName: string): { absolute: string; relative: string } {
  const resolved = resolvePackageDir(pkgName);
  const fromRoot = path.resolve(monorepoRoot, 'node_modules', pkgName);
  const absolute = resolved ?? fromRoot;
  const relative = path.relative(projectRoot, absolute);
  return { absolute, relative };
}

/**
 * For packages where CJS and ESM entry files create separate module-level
 * singletons (e.g. React.createContext in @tanstack/react-query), resolve to
 * the specific ESM entry file instead of the package directory.  This forces
 * both require() and import to load the exact same file, sharing one context.
 */
function resolveToEsmEntry(pkgName: string): { absolute: string; relative: string } | null {
  const pkgDir = resolvePackageDir(pkgName);
  if (!pkgDir) return null;
  try {
    const pkgJson = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    const esmEntry = pkgJson.exports?.['.']?.import?.default;
    if (typeof esmEntry === 'string') {
      const absoluteFile = path.resolve(pkgDir, esmEntry);
      if (!existsSync(absoluteFile)) return null;
      return { absolute: absoluteFile, relative: path.relative(projectRoot, absoluteFile) };
    }
  } catch {
    // Fall through — caller falls back to directory alias
  }
  return null;
}

// Turbopack (dev): dedupe all singletons workspace packages might resolve twice.
const SHARED = [
  'react',
  'react-dom',
  '@tanstack/react-query',
  '@tanstack/query-core',
  '@supabase/supabase-js',
];

/**
 * Webpack (`next build --webpack`): only force-alias TanStack Query. Aliasing
 * `react` / `react-dom` here broke prerender of `/_global-error` (null dispatcher
 * → `useContext` crash) on Next 16.2 + React 19.
 */
const WEBPACK_DEDUPE = ['@tanstack/react-query', '@tanstack/query-core'] as const;

// Packages that create module-level React contexts and have separate CJS/ESM
// entry files.  These must alias to the specific ESM entry file, not the
// package directory, to prevent duplicate-context bugs.
const ESM_ENTRY_PACKAGES = new Set(['@tanstack/react-query', '@tanstack/query-core']);

/**
 * Upstream Nest API used only by the Next.js dev-server rewrite proxy.
 *
 * Priority:
 *   1. NEXT_DEV_API_PROXY_URL — explicitly override the local backend URL.
 *   2. http://localhost:3001   — sensible default so new endpoints (e.g. /farms)
 *                               that haven't been deployed to production yet still work.
 *
 * NEXT_PUBLIC_API_URL is intentionally NOT used here because it bakes the
 * production domain into the build; using it for dev proxying would route all
 * dev requests to the live server and break undeployed features.
 */
function devApiUpstreamOrigin(): string {
  const raw = process.env.NEXT_DEV_API_PROXY_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      return `${u.protocol}//${u.host}`;
    } catch { /* fall through */ }
  }
  return 'http://localhost:3001';
}

const nextConfig: NextConfig = {
  /**
   * `next dev`: browser calls same-origin `/api/v1/...` so CORS does not apply.
   * The dev server proxies to NEXT_PUBLIC_API_URL (e.g. https://nortiauno.com).
   * Production uses NEXT_PUBLIC_API_URL directly in the client bundle (no rewrite).
   */
        async rewrites() {
           if (process.env.NODE_ENV !== 'development') return [];
           const upstream = devApiUpstreamOrigin();
           return [
             {
               source: '/api/v1/:path*',
               destination: `${upstream}/api/v1/:path*`,
             },
           ];
         },
  /**
   * Production bundles must use webpack (`next build --webpack`) so the
   * `webpack()` aliases below run. Default `next build` uses Turbopack, which
   * skips those aliases and can leave two copies of @tanstack/react-query →
   * "No QueryClient set" for hooks from @strawboss/api. Dev still uses Turbopack.
   */
  output: 'standalone',
  // Monorepo + `output: 'standalone'`: trace files from repo root so Docker copies
  // the same hoisted `node_modules` graph as local `next build` (avoids missing or
  // duplicate package copies that only show up in the image).
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: [
    '@strawboss/types',
    '@strawboss/api',
    '@strawboss/ui-tokens',
    '@strawboss/validation',
  ],
  turbopack: {
    // Force all imports of shared singletons through the monorepo-root copy.
    // Relative paths (../../...) are used instead of absolute because Turbopack in
    // Next.js 16 incorrectly strips the leading / from absolute paths.
    // For ESM_ENTRY_PACKAGES, alias to the ESM entry *file* (not the directory)
    // so CJS require() and ESM import resolve to the same module.
    resolveAlias: Object.fromEntries(
      SHARED.map((pkg) => {
        if (ESM_ENTRY_PACKAGES.has(pkg)) {
          const esm = resolveToEsmEntry(pkg);
          if (esm) return [pkg, esm.relative];
        }
        return [pkg, resolveShared(pkg).relative];
      })
    ),
  },
  webpack(config) {
    config.resolve.alias = config.resolve.alias || {};
    for (const pkg of WEBPACK_DEDUPE) {
      const esm = resolveToEsmEntry(pkg);
      if (esm) {
        config.resolve.alias[`${pkg}$`] = esm.absolute;
        config.resolve.alias[pkg] = esm.absolute;
      } else {
        const dir = resolvePackageDir(pkg);
        if (dir && existsSync(path.join(dir, 'package.json'))) {
          config.resolve.alias[pkg] = dir;
        }
        // If unresolved, omit alias — wrong paths break Docker with "Can't resolve".
      }
    }
    return config;
  },
};

export default nextConfig;
