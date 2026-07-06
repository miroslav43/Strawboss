import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream, promises as fsp } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import sharp from 'sharp';

/** Hard upper bound enforced server-side even if a client sends a larger body. */
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB

const ALLOWED_MIMES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/**
 * Avize (delivery-note PDFs) are scanned documents that routinely exceed the
 * 3 MB image cap, so they get their own larger limit and a PDF-only allowlist.
 * Kept separate from ALLOWED_MIMES so the receipt/signature/avatar paths stay
 * image-only.
 */
export const AVIZ_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const AVIZ_ALLOWED_MIMES: Record<string, string> = {
  'application/pdf': 'pdf',
};

/**
 * Accepted input MIME types for avatar uploads. We re-encode everything to WebP
 * 512×512 on disk, so the client just needs to send a format libvips can read.
 * HEIC is accepted because iPhones default to it when "Most Compatible" is off.
 */
const AVATAR_ALLOWED_MIMES = new Set([
  'image/webp',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
]);

/** Avatars are stored as a single canonical file per user: `avatars/{userId}.webp`. */
const AVATAR_OUTPUT_SIZE = 512;
const AVATAR_OUTPUT_QUALITY = 80;

export interface SaveReceiptInput {
  mimetype: string;
  filename: string;
  stream: Readable;
  kind: string | undefined;
}

export interface SaveReceiptResult {
  url: string;
  key: string;
  sizeBytes: number;
}

export interface SaveAvatarInput {
  userId: string;
  mimetype: string;
  stream: Readable;
}

export interface SaveAvatarResult {
  /** Public URL to use as `users.avatar_url`, including a `?v=` cache-buster. */
  url: string;
  /** Storage key relative to the uploads root (without the cache-buster). */
  key: string;
  sizeBytes: number;
}

export interface SaveSignatureInput {
  mimetype: string;
  stream: Readable;
}

export interface SaveSignatureResult {
  url: string;
  key: string;
  sizeBytes: number;
}

export interface SaveSpecimenInput {
  userId: string;
  mimetype: string;
  stream: Readable;
}

export interface SaveSpecimenResult {
  /** Public URL to use as `users.signature_specimen_url`, including a `?v=` cache-buster. */
  url: string;
  /** Storage key relative to the uploads root (without the cache-buster). */
  key: string;
  sizeBytes: number;
}

/** Resolves the root directory for file uploads (env-driven, with a dev default). */
export function resolveUploadsRoot(configService: ConfigService): string {
  const fromEnv = configService.get<string>('UPLOADS_ROOT');
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  // Docker image sets `/app/uploads`; a local dev process defaults to ./uploads
  // under the monorepo (same pattern as `logs/`).
  return path.resolve(process.cwd(), 'uploads');
}

@Injectable()
export class UploadsService {
  private readonly uploadsRoot: string;

  constructor(configService: ConfigService) {
    this.uploadsRoot = resolveUploadsRoot(configService);
  }

  async saveReceipt(input: SaveReceiptInput): Promise<SaveReceiptResult> {
    const ext = ALLOWED_MIMES[input.mimetype];
    if (!ext) {
      throw new BadRequestException(
        `Unsupported file type '${input.mimetype}'. Allowed: ${Object.keys(ALLOWED_MIMES).join(', ')}`,
      );
    }

    const dir = path.join(this.uploadsRoot, 'receipts');
    await fsp.mkdir(dir, { recursive: true });

    const key = `receipts/${randomUUID()}.${ext}`;
    const absolute = path.join(this.uploadsRoot, key);

    let bytesWritten = 0;
    const ws = createWriteStream(absolute);

    // Stream into disk while counting bytes so we can reject oversized files
    // without buffering them entirely in memory.
    input.stream.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length;
      if (bytesWritten > MAX_BYTES) {
        input.stream.destroy(
          new PayloadTooLargeException(`File exceeds max size of ${MAX_BYTES} bytes`),
        );
      }
    });

    try {
      await pipeline(input.stream, ws);
    } catch (err) {
      await fsp.unlink(absolute).catch(() => {
        /* already gone */
      });
      if (err instanceof PayloadTooLargeException) throw err;
      throw new InternalServerErrorException(err instanceof Error ? err.message : 'Upload failed');
    }

    // URL is relative to the API origin so mobile/admin can use their normal
    // `${API_URL}/...` composition without extra configuration.
    return {
      url: `/api/v1/uploads/${key}`,
      key,
      sizeBytes: bytesWritten,
    };
  }

  /**
   * Save an uploaded aviz (delivery-note PDF) for a trip request.
   *
   * A fresh UUID filename is used on every upload — even though only one aviz is
   * kept per request — so the signed URL changes and browsers never render a
   * stale cached PDF after a replace. Stored under `UPLOADS_ROOT/avize/<uuid>.pdf`
   * and served at `/api/v1/uploads/avize/<uuid>.pdf` via the signed
   * @fastify/static route (no controller change — it globs the whole prefix).
   */
  async saveAviz(input: SaveSignatureInput): Promise<SaveSignatureResult> {
    const ext = AVIZ_ALLOWED_MIMES[input.mimetype];
    if (!ext) {
      throw new BadRequestException(
        `Unsupported file type '${input.mimetype}'. Allowed: ${Object.keys(AVIZ_ALLOWED_MIMES).join(', ')}`,
      );
    }

    const dir = path.join(this.uploadsRoot, 'avize');
    await fsp.mkdir(dir, { recursive: true });

    const key = `avize/${randomUUID()}.${ext}`;
    const absolute = path.join(this.uploadsRoot, key);

    let bytesWritten = 0;
    const ws = createWriteStream(absolute);

    input.stream.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length;
      if (bytesWritten > AVIZ_MAX_BYTES) {
        input.stream.destroy(
          new PayloadTooLargeException(`File exceeds max size of ${AVIZ_MAX_BYTES} bytes`),
        );
      }
    });

    try {
      await pipeline(input.stream, ws);
    } catch (err) {
      await fsp.unlink(absolute).catch(() => {
        /* already gone */
      });
      if (err instanceof PayloadTooLargeException) throw err;
      throw new InternalServerErrorException(err instanceof Error ? err.message : 'Upload failed');
    }

    return {
      url: `/api/v1/uploads/${key}`,
      key,
      sizeBytes: bytesWritten,
    };
  }

  /**
   * Save (or replace) a user's avatar.
   *
   * We canonicalize every upload to a 512×512 WebP so downstream clients can
   * render a uniform square without extra work, and so a single `{userId}.webp`
   * file on disk is enough — no orphans accumulate across re-uploads.
   *
   * A `?v={timestamp}` cache-buster is appended to the returned URL so browsers
   * (and admin-web's `<img>` cache) pick up a new picture immediately after the
   * user replaces theirs.
   */
  async saveAvatar(input: SaveAvatarInput): Promise<SaveAvatarResult> {
    if (!AVATAR_ALLOWED_MIMES.has(input.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type '${input.mimetype}'. Allowed: ${[...AVATAR_ALLOWED_MIMES].join(', ')}`,
      );
    }

    // Collect the multipart stream into memory with a hard cap so a malicious
    // client cannot exhaust RAM by sending a very large payload. 3 MB is more
    // than enough for a photo that will be downscaled to 512 px anyway.
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    for await (const chunk of input.stream) {
      const buf = chunk as Buffer;
      bytesRead += buf.length;
      if (bytesRead > MAX_BYTES) {
        input.stream.destroy();
        throw new PayloadTooLargeException(`File exceeds max size of ${MAX_BYTES} bytes`);
      }
      chunks.push(buf);
    }
    const source = Buffer.concat(chunks);
    if (source.length === 0) {
      throw new BadRequestException('Empty file');
    }

    const dir = path.join(this.uploadsRoot, 'avatars');
    await fsp.mkdir(dir, { recursive: true });

    const key = `avatars/${input.userId}.webp`;
    const absolute = path.join(this.uploadsRoot, key);

    let output: Buffer;
    try {
      output = await sharp(source, { failOn: 'error' })
        .rotate() // respect EXIF orientation
        .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, { fit: 'cover', position: 'attention' })
        .webp({ quality: AVATAR_OUTPUT_QUALITY })
        .toBuffer();
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? `Invalid image: ${err.message}` : 'Invalid image',
      );
    }

    try {
      await fsp.writeFile(absolute, output);
    } catch (err) {
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Failed to write avatar',
      );
    }

    const version = Date.now();
    return {
      url: `/api/v1/uploads/${key}?v=${version}`,
      key,
      sizeBytes: output.length,
    };
  }

  /**
   * Save a delivery/departure signature image (PNG from the mobile canvas).
   *
   * Signatures are stored as-is under `UPLOADS_ROOT/signatures/` and served
   * at `/api/v1/uploads/signatures/<uuid>.png`. The returned `url` is what
   * mobile clients pass as `driverSignature` / `receiverSignature` in trip
   * transition DTOs — instead of embedding the raw base64 in the JSON body.
   *
   * Accepted MIME types match what the React Native canvas produces: PNG and
   * JPEG. WebP is also accepted for forward compat.
   */
  async saveSignature(input: SaveSignatureInput): Promise<SaveSignatureResult> {
    const ext = ALLOWED_MIMES[input.mimetype];
    if (!ext) {
      throw new BadRequestException(
        `Unsupported file type '${input.mimetype}'. Allowed: ${Object.keys(ALLOWED_MIMES).join(', ')}`,
      );
    }

    const dir = path.join(this.uploadsRoot, 'signatures');
    await fsp.mkdir(dir, { recursive: true });

    const key = `signatures/${randomUUID()}.${ext}`;
    const absolute = path.join(this.uploadsRoot, key);

    let bytesWritten = 0;
    const ws = createWriteStream(absolute);

    input.stream.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length;
      if (bytesWritten > MAX_BYTES) {
        input.stream.destroy(
          new PayloadTooLargeException(`File exceeds max size of ${MAX_BYTES} bytes`),
        );
      }
    });

    try {
      await pipeline(input.stream, ws);
    } catch (err) {
      await fsp.unlink(absolute).catch(() => {
        /* already gone */
      });
      if (err instanceof PayloadTooLargeException) throw err;
      throw new InternalServerErrorException(err instanceof Error ? err.message : 'Upload failed');
    }

    return {
      url: `/api/v1/uploads/${key}`,
      key,
      sizeBytes: bytesWritten,
    };
  }

  /**
   * Save (or replace) a user's signature specimen.
   *
   * Stored canonically as `uploads/specimens/{userId}.png` (overwrites every
   * upload) so trip rows that reference the URL stay valid across re-captures.
   * A `?v={timestamp}` cache-buster is appended so clients pick up the new
   * image immediately after the user redoes their specimen.
   *
   * We accept the canvas output as-is (PNG/JPEG/WebP) without re-encoding —
   * signatures are tiny line drawings; sharp resizing would only add cost
   * without visible benefit.
   */
  async saveSpecimen(input: SaveSpecimenInput): Promise<SaveSpecimenResult> {
    const ext = ALLOWED_MIMES[input.mimetype];
    if (!ext) {
      throw new BadRequestException(
        `Unsupported file type '${input.mimetype}'. Allowed: ${Object.keys(ALLOWED_MIMES).join(', ')}`,
      );
    }

    const dir = path.join(this.uploadsRoot, 'specimens');
    await fsp.mkdir(dir, { recursive: true });

    // Canonical filename — one file per user, overwrites on re-upload.
    const key = `specimens/${input.userId}.${ext}`;
    const absolute = path.join(this.uploadsRoot, key);

    let bytesWritten = 0;
    const ws = createWriteStream(absolute);

    input.stream.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length;
      if (bytesWritten > MAX_BYTES) {
        input.stream.destroy(
          new PayloadTooLargeException(`File exceeds max size of ${MAX_BYTES} bytes`),
        );
      }
    });

    try {
      await pipeline(input.stream, ws);
    } catch (err) {
      await fsp.unlink(absolute).catch(() => {
        /* already gone */
      });
      if (err instanceof PayloadTooLargeException) throw err;
      throw new InternalServerErrorException(err instanceof Error ? err.message : 'Upload failed');
    }

    const version = Date.now();
    return {
      url: `/api/v1/uploads/${key}?v=${version}`,
      key,
      sizeBytes: bytesWritten,
    };
  }
}
