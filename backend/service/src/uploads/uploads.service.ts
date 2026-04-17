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

/** Hard upper bound enforced server-side even if a client sends a larger body. */
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB

const ALLOWED_MIMES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

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
          new PayloadTooLargeException(
            `File exceeds max size of ${MAX_BYTES} bytes`,
          ),
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
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Upload failed',
      );
    }

    // URL is relative to the API origin so mobile/admin can use their normal
    // `${API_URL}/...` composition without extra configuration.
    return {
      url: `/api/v1/uploads/${key}`,
      key,
      sizeBytes: bytesWritten,
    };
  }
}
