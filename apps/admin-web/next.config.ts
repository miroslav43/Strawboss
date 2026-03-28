import type { NextConfig } from 'next';
import path from 'path';
import { realpathSync, existsSync } from 'fs';

const projectRoot = __dirname; // apps/admin-web
const monorepoRoot = path.resolve(projectRoot, '../..');

/**
 * Resolves a package from the monorepo root node_modules and returns paths for
 * both Turbopack (relative, from project root) and webpack (absolute canonical).
 *
 * Why we need this: pnpm creates per-workspace symlinks even with shamefully-hoist,
 * so @strawboss/api resolves @tanstack/react-query via its OWN local symlink, giving
 * a different module path than admin-web — two React Query contexts → "No QueryClient set".
 *
 * Turbopack bug: absolute paths (starting with /) get ./  prepended, becoming invalid.
 * Workaround: use a relative path (../../...) from the project root instead.
 */
function resolveShared(pkgName: string): { absolute: string; relative: string } {
  const fromRoot = path.resolve(monorepoRoot, 'node_modules', pkgName);
  let absolute = fromRoot;
  try {
    if (existsSync(fromRoot)) {
      absolute = realpathSync(fromRoot); // follow symlinks → canonical pnpm store path
    }
  } catch {
    // keep the unresolved path as fallback
  }
  // Relative path from project root (apps/admin-web) to the canonical package dir.
  // e.g. "../../node_modules/.pnpm/@tanstack+react-query@5.95.2.../node_modules/@tanstack/react-query"
  const relative = path.relative(projectRoot, absolute);
  return { absolute, relative };
}

// Packages that must resolve to a single instance across the entire bundle.
const SHARED = [
  'react',
  'react-dom',
  '@tanstack/react-query',
  '@supabase/supabase-js',
];

const nextConfig: NextConfig = {
  output: 'standalone',
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
    resolveAlias: Object.fromEntries(
      SHARED.map((pkg) => [pkg, resolveShared(pkg).relative])
    ),
  },
  webpack(config) {
    // For webpack fallback builds: use the fully-resolved canonical paths so
    // both admin-web and transpiled workspace packages land at the same file inode.
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(
        SHARED.map((pkg) => [pkg, resolveShared(pkg).absolute])
      ),
    };
    return config;
  },
};

export default nextConfig;
