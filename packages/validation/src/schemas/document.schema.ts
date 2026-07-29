import { z } from 'zod';
import { DocumentType, DocumentStatus } from '@strawboss/types';
import { uuidSchema } from '../helpers/uuid.js';
import { isoDateSchema } from '../helpers/iso-date.js';
import { timestampsSchema } from '../helpers/common.js';
import { softDeleteSchema } from '../helpers/common.js';

export const documentTypeSchema = z.nativeEnum(DocumentType);
export const documentStatusSchema = z.nativeEnum(DocumentStatus);

/**
 * Which end of an auxiliary trip a scanned CMR belongs to: `loading` is the
 * paper CMR the loader photographs at pickup (`document_type = 'cmr_scan'`),
 * `delivery` is the photo the external driver uploads at the destination
 * (`document_type = 'cmr_scan_delivery'`). Validates the `?kind=` query param
 * shared by the cmr-scans and transporter CMR routes — default is `loading` so
 * every pre-existing call site (mobile, old admin links) keeps working unchanged.
 */
export const cmrScanKindSchema = z.enum(['loading', 'delivery']).default('loading');
export type CmrScanKind = z.infer<typeof cmrScanKindSchema>;

export const documentSchema = z
  .object({
    id: uuidSchema,
    tripId: uuidSchema,
    documentType: documentTypeSchema,
    status: documentStatusSchema,
    title: z.string().min(1),
    fileUrl: z.string().url().nullable(),
    fileSizeBytes: z.number().int().nonnegative().nullable(),
    mimeType: z.string().nullable(),
    metadata: z.record(z.unknown()).nullable(),
    generatedAt: isoDateSchema.nullable(),
    sentAt: isoDateSchema.nullable(),
    sentTo: z.array(z.string()).nullable(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);
