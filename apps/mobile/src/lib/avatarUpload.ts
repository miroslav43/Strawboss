import * as ImageManipulator from 'expo-image-manipulator';
import type { User } from '@strawboss/types';
import { mobileApiClient } from './api-client';
import { mobileLogger } from './logger';

/**
 * Compress and upload a new profile picture.
 *
 * Pipeline:
 *   localUri (camera frame or gallery file, usually 2-5 MB JPEG)
 *     -> resize to max 1024 px on the longest edge (aspect preserved)
 *     -> re-encode as WebP at quality 0.85
 *     -> POST multipart/form-data to /api/v1/profile/avatar
 *
 * Backend re-encodes to canonical 512x512 WebP before writing. This
 * client-side pass just keeps the bytes on the wire small enough to be
 * friendly on slow rural connections.
 */
const MAX_EDGE_PX = 1024;
const WEBP_QUALITY = 0.85;

export async function uploadAvatar(sourceUri: string): Promise<User> {
  const compressed = await ImageManipulator.manipulateAsync(
    sourceUri,
    [{ resize: { width: MAX_EDGE_PX } }],
    {
      compress: WEBP_QUALITY,
      format: ImageManipulator.SaveFormat.WEBP,
    },
  );

  const form = new FormData();
  // React Native's FormData accepts this shape for file parts even though
  // the cross-platform TS types don't model it — mirrors `receiptUpload`.
  form.append('file', {
    uri: compressed.uri,
    name: `avatar-${Date.now()}.webp`,
    type: 'image/webp',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  try {
    const user = await mobileApiClient.upload<User>(
      '/api/v1/profile/avatar',
      form,
    );
    mobileLogger.flow('Avatar uploaded', {
      userId: user.id,
      avatarUrl: user.avatarUrl,
    });
    return user;
  } catch (err) {
    mobileLogger.error('Avatar upload failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
