import { z } from 'zod';
import { OtaState, ReleaseStatus, OtaTargetKind } from '@strawboss/types';
import { uuidSchema } from '../helpers/uuid.js';

export const otaStateSchema = z.nativeEnum(OtaState);
export const releaseStatusSchema = z.nativeEnum(ReleaseStatus);
export const otaTargetKindSchema = z.nativeEnum(OtaTargetKind);

// ── Device check-in (PUBLIC endpoint) ────────────────────────────────────────

export const deviceOtaReportSchema = z.object({
  deploymentId: uuidSchema,
  state: otaStateSchema,
  error: z.string().max(4000).optional(),
});

export const deviceCommandReportSchema = z.object({
  commandId: uuidSchema,
  status: z.enum(['success', 'failure']),
  error: z.string().max(4000).optional(),
});

// One-shot remote-debug command queue (Tier 1).
export const remoteCommandTypeSchema = z.enum([
  'reboot',
  'fetch_logs',
  'reinstall_apk',
  'report_state',
]);

export const deviceRemoteCommandReportSchema = z.object({
  commandId: uuidSchema,
  status: z.enum(['success', 'failure']),
  result: z.record(z.unknown()).optional(),
  error: z.string().max(4000).optional(),
});

/** Super-admin enqueues a one-shot command. `reinstall_apk` takes a releaseId (the backend
 * resolves it to a fresh signed apkUrl + packageName + sha256 at delivery time). */
export const createRemoteCommandSchema = z
  .object({
    type: remoteCommandTypeSchema,
    params: z.record(z.unknown()).optional(),
  })
  .refine((c) => c.type !== 'reinstall_apk' || typeof c.params?.releaseId === 'string', {
    message: 'reinstall_apk requires params.releaseId',
    path: ['params'],
  });
export type CreateRemoteCommandInput = z.infer<typeof createRemoteCommandSchema>;

export const deviceCheckinSchema = z.object({
  deviceUuid: z.string().min(8).max(128),
  deviceToken: z.string().max(256).optional(),
  appVersion: z.string().min(1).max(64),
  versionCode: z.number().int().nonnegative(),
  model: z.string().max(128).optional(),
  manufacturer: z.string().max(128).optional(),
  osVersion: z.string().max(64).optional(),
  androidId: z.string().max(128).optional(),
  pushToken: z.string().max(512).optional(),
  isDeviceOwner: z.boolean(),
  activeTrip: z.boolean(),
  otaReports: z.array(deviceOtaReportSchema).max(50).optional(),
  commandReports: z.array(deviceCommandReportSchema).max(50).optional(),
  remoteCommandReports: z.array(deviceRemoteCommandReportSchema).max(50).optional(),
  lastError: z.string().max(4000).optional(),
});
export type DeviceCheckinInput = z.infer<typeof deviceCheckinSchema>;

// ── Super-admin: releases ─────────────────────────────────────────────────────

/** Metadata that accompanies an APK upload (the file itself comes via multipart). */
export const createReleaseSchema = z.object({
  version: z.string().min(1).max(64),
  versionCode: z.coerce.number().int().positive(),
  changelog: z.string().max(8000).nullable().optional(),
  mandatory: z.coerce.boolean().optional(),
});
export type CreateReleaseInput = z.infer<typeof createReleaseSchema>;

export const updateReleaseSchema = z.object({
  status: releaseStatusSchema.optional(),
  mandatory: z.boolean().optional(),
  changelog: z.string().max(8000).nullable().optional(),
});
export type UpdateReleaseInput = z.infer<typeof updateReleaseSchema>;

// ── Super-admin: deployments ──────────────────────────────────────────────────

export const createDeploymentSchema = z
  .object({
    releaseId: uuidSchema,
    targetKind: otaTargetKindSchema,
    targetOrgId: uuidSchema.nullable().optional(),
    targetDeviceIds: z.array(uuidSchema).min(1).max(5000).nullable().optional(),
    /** Full ISO 8601 (frontend converts datetime-local via new Date(v).toISOString()). */
    scheduledAt: z.string().datetime().nullable().optional(),
    forceNow: z.boolean().optional(),
  })
  .refine((d) => d.targetKind !== OtaTargetKind.org || !!d.targetOrgId, {
    message: 'targetOrgId is required when targetKind = org',
    path: ['targetOrgId'],
  })
  .refine(
    (d) =>
      d.targetKind !== OtaTargetKind.device_set ||
      (Array.isArray(d.targetDeviceIds) && d.targetDeviceIds.length > 0),
    {
      message: 'targetDeviceIds is required when targetKind = device_set',
      path: ['targetDeviceIds'],
    },
  );
export type CreateDeploymentInput = z.infer<typeof createDeploymentSchema>;

// ── Super-admin: device assignment / rename ───────────────────────────────────

export const updateDeviceSchema = z.object({
  name: z.string().min(1).max(120).nullable().optional(),
  organizationId: uuidSchema.nullable().optional(),
});
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;

// ── Super-admin: Tailscale remote access ──────────────────────────────────────

/** Toggle the desired Tailscale state for one device (the device applies it via MDM). */
export const setDeviceTailscaleSchema = z.object({
  desired: z.boolean(),
});
export type SetDeviceTailscaleInput = z.infer<typeof setDeviceTailscaleSchema>;

/** Global Tailscale settings the super-admin edits. authKey null = leave unchanged;
 * empty string = clear. */
export const updateTailscaleSettingsSchema = z.object({
  authKey: z.string().max(512).nullable().optional(),
  tailnet: z.string().max(200).nullable().optional(),
  /** Tailscale OAuth client (enables per-device ephemeral keys; '' clears). */
  oauthClientId: z.string().max(256).nullable().optional(),
  oauthClientSecret: z.string().max(512).nullable().optional(),
  /** Tag applied to OAuth-minted keys, e.g. 'tag:fleet-phone'. */
  tag: z.string().max(128).nullable().optional(),
});
export type UpdateTailscaleSettingsInput = z.infer<typeof updateTailscaleSettingsSchema>;
