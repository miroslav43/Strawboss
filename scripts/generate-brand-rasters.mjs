/**
 * Rasterizes branding/strawboss-tractor.svg for Expo mobile assets and admin OG image.
 * Also syncs the SVG into admin-web (app icon + public for login).
 *
 * Run from repo root: pnpm exec node scripts/generate-brand-rasters.mjs
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const svgPath = join(root, 'branding/strawboss-tractor.svg');
const svg = readFileSync(svgPath, 'utf8');
const svgBuf = Buffer.from(svg);

const mobileAssets = join(root, 'apps/mobile/assets');
const adminApp = join(root, 'apps/admin-web/src/app');
const adminPublicBrand = join(root, 'apps/admin-web/public/brand');

mkdirSync(mobileAssets, { recursive: true });
mkdirSync(adminPublicBrand, { recursive: true });

const BG = { r: 243, g: 222, b: 216, alpha: 1 };

async function main() {
  // Launcher icon (opaque background for universal icon)
  await sharp(svgBuf)
    .resize(1024, 1024, {
      fit: 'contain',
      position: 'centre',
      background: BG,
    })
    .png()
    .toFile(join(mobileAssets, 'icon.png'));

  // Android adaptive foreground: transparent padding, tractor ~55% of canvas (safe zone)
  const inner = 560;
  const pad = Math.floor((1024 - inner) / 2);
  await sharp(svgBuf)
    .resize(inner, inner, {
      fit: 'contain',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extend({
      top: pad,
      bottom: 1024 - inner - pad,
      left: pad,
      right: 1024 - inner - pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(join(mobileAssets, 'adaptive-icon.png'));

  // Native splash: portrait plate, centered tractor
  const splashW = 1284;
  const splashH = 2778;
  const tractorSplash = await sharp(svgBuf)
    .resize(Math.round(splashW * 0.52), null, {
      fit: 'inside',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: splashW,
      height: splashH,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: tractorSplash, gravity: 'centre' }])
    .png()
    .toFile(join(mobileAssets, 'splash.png'));

  // In-app splash logo (small, opaque)
  await sharp(svgBuf)
    .resize(200, 200, {
      fit: 'contain',
      position: 'centre',
      background: BG,
    })
    .png()
    .toFile(join(mobileAssets, 'splash-inline.png'));

  // Admin Open Graph (1200×630)
  const ogW = 1200;
  const ogH = 630;
  const tractorOg = await sharp(svgBuf)
    .resize(Math.round(ogH * 0.85), null, {
      fit: 'inside',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: ogW,
      height: ogH,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: tractorOg, gravity: 'centre' }])
    .png()
    .toFile(join(adminApp, 'opengraph-image.png'));

  copyFileSync(svgPath, join(adminApp, 'icon.svg'));
  copyFileSync(svgPath, join(adminPublicBrand, 'strawboss-tractor.svg'));

  console.log('Brand rasters OK:', mobileAssets, adminApp);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
