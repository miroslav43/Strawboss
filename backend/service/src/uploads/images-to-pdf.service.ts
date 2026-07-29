import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

/** Downscale target — matches the on-device compression in cmrScanUpload.ts. */
const PAGE_MAX_WIDTH = 1600;
const JPEG_QUALITY = 80;

/**
 * Convert photographed CMR pages (JPEG/PNG/WebP) into a single paginated A4
 * PDF, server-side.
 *
 * Mirrors `buildCmrPdf()` in `apps/mobile/src/lib/cmrScanUpload.ts` — same
 * per-page normalization, same "one full-bleed page per photo" layout — so a
 * CMR built on the loader's phone and one uploaded through the external
 * driver's browser look alike. This is the path a driver's arrival-CMR photo
 * takes: the public upload has no on-device scanner, so the conversion that
 * usually happens on the phone happens here instead.
 */
@Injectable()
export class ImagesToPdfService {
  /**
   * Each input buffer is normalized independently — EXIF auto-rotated,
   * resized, re-encoded to JPEG — before being embedded as a base64 data URL.
   * Re-encoding through sharp also strips EXIF (including GPS) rather than
   * carrying a stranger's photo metadata into a stored legal document.
   *
   * Rendering reuses the exact SSRF guard `CmrService.generateCmr` uses: only
   * data:/about:/blob: requests are allowed through the headless page, so
   * nothing embedded in a page can make the renderer fetch an external URL.
   */
  async renderImagesToPdf(images: Buffer[]): Promise<Buffer> {
    if (images.length === 0) {
      throw new Error('renderImagesToPdf: no pages to render');
    }

    let pageDivs: string[];
    try {
      pageDivs = await Promise.all(
        images.map(async (buf) => {
          const normalized = await sharp(buf, { failOn: 'error' })
            .rotate() // respect EXIF orientation before it's discarded below
            .resize({ width: PAGE_MAX_WIDTH, withoutEnlargement: true })
            .jpeg({ quality: JPEG_QUALITY }) // re-encoding drops EXIF/GPS metadata
            .toBuffer();
          return `<div class="page"><img src="data:image/jpeg;base64,${normalized.toString('base64')}" /></div>`;
        }),
      );
    } catch (err) {
      throw new Error(err instanceof Error ? `Invalid image: ${err.message}` : 'Invalid image');
    }

    const html = `<!doctype html>
<html>
<head>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; }
  .page {
    width: 210mm;
    height: 297mm;
    display: flex;
    align-items: center;
    justify-content: center;
    page-break-after: always;
  }
  .page:last-child { page-break-after: auto; }
  .page img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style>
</head>
<body>${pageDivs.join('')}</body>
</html>`;

    // In Docker (Alpine) there is no bundled Chrome — PUPPETEER_EXECUTABLE_PATH
    // points at the system Chromium installed in the image. Unset locally,
    // where Puppeteer falls back to its own downloaded browser (same pattern
    // as CmrService.generateCmr).
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });
    try {
      const page = await browser.newPage();
      // Block every outbound request from the rendered page — only inline
      // data: resources are needed; anything else must not be fetched.
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        const allowed =
          url.startsWith('data:') || url.startsWith('about:') || url.startsWith('blob:');
        (allowed ? req.continue() : req.abort()).catch(() => {});
      });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close().catch(() => {});
    }
  }
}
