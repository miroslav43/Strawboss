const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// With pnpm hoisted node-linker, all packages are in the monorepo root node_modules.
// We only need to watch the monorepo root and add its node_modules to the resolver path.
config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// pnpm uses symlinks. Metro keys module identity by file path — two symlinks
// pointing to the same pnpm store entry are treated as separate modules,
// breaking React context (e.g. "No QueryClient set" when the api package's
// compiled hooks resolve @tanstack/react-query through their own node_modules
// symlink instead of the app's).
//
// resolveRequest intercepts EVERY require of these packages and redirects them
// to the canonical real path, guaranteeing a single module instance.
const singletons = ['react', 'react-native', '@tanstack/react-query'];
const singletonEntries = new Map();
for (const pkg of singletons) {
  try {
    // Resolve from projectRoot first so the app's own dependency versions win.
    // Using monorepoRoot could pick up a hoisted copy with a different version
    // (e.g. react 19.2.4 from another workspace package vs the 19.1.0 required
    // by react-native 0.81's bundled renderer).
    const entry = require.resolve(pkg, { paths: [projectRoot, monorepoRoot] });
    singletonEntries.set(pkg, fs.realpathSync(entry));
  } catch {
    // package missing — skip
  }
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (singletonEntries.has(moduleName)) {
    return { filePath: singletonEntries.get(moduleName), type: 'sourceFile' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Ensure Metro uses the correct project root for entry point resolution
config.projectRoot = projectRoot;

module.exports = config;
