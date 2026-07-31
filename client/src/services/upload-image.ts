/**
 * Direct-to-S3 image upload via the gateway's presigned PUT.
 *
 * Flow: `requestImageUpload` → PUT the bytes straight to S3 →
 * `confirmImageUpload`. The bytes never pass through the gateway, so its
 * memory does not scale with image size.
 *
 * **The trap this file exists to contain:** do NOT build the PUT body as
 * `new Blob([bytes])`. TypeScript accepts it, but React Native's Blob rejects
 * an ArrayBuffer/Uint8Array at runtime, so the failure only shows up on a
 * device. The bytes are streamed from disk with `uploadAsync` from
 * `expo-file-system/legacy` instead, which never materialises them in JS.
 *
 * Native only. The web branch that used to live here was removed rather than
 * left broken: this app ships to phones, and a fetch+Blob path nobody runs is
 * exactly where the trap above creeps back in.
 */
import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { ApiError } from './api-error';
import { graphqlRequest } from './api';

/** Mirrors the gateway's `ImageKind` enum. */
export type ImageKind = 'PROFILE' | 'BLOOD_PRESSURE_READING';

const GQL_REQUEST_IMAGE_UPLOAD = `
  mutation RequestImageUpload($input: RequestImageUploadInput!) {
    requestImageUpload(input: $input) {
      uploadUrl
      key
      headers { name value }
      expiresAt
    }
  }
`;

const GQL_CONFIRM_IMAGE_UPLOAD = `
  mutation ConfirmImageUpload($input: ConfirmImageUploadInput!) {
    confirmImageUpload(input: $input) {
      key
      url
      imageId
    }
  }
`;

type PresignedUpload = {
  uploadUrl: string;
  key: string;
  headers: { name: string; value: string }[];
};

export type UploadedImage = {
  /** Canonical URL, safe to pass to `updateProfile(avatar:)`. */
  url: string;
  key: string;
  /** Only populated for BP uploads — the gateway skips the row for PROFILE. */
  imageId: number | null;
};

/** Thrown when the picked file is gone by the time we try to read it. */
export class LocalImageMissingError extends ApiError {
  constructor(uri: string) {
    super(`local image is unreadable: ${uri}`, { code: 'LOCAL_IMAGE_MISSING' });
    this.name = 'ApiError';
  }
}

export const isRemoteImageUri = (uri?: string | null): boolean =>
  typeof uri === 'string' && /^https?:\/\//i.test(uri);

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

const mimeTypeFor = (uri: string): string => {
  const extension = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'image/jpeg';
};

export async function uploadImageViaPresign({
  uri,
  kind,
}: {
  uri: string;
  kind: ImageKind;
}): Promise<UploadedImage> {
  // Already on the server — nothing to upload, and no new row was made.
  if (isRemoteImageUri(uri)) return { url: uri, key: uri, imageId: null };

  if (Platform.OS === 'web') {
    throw new ApiError('image upload is not supported on web', {
      code: 'UPLOAD_UNSUPPORTED',
    });
  }

  const mimeType = mimeTypeFor(uri);

  let size: number;
  try {
    // `File#size` is null when the path cannot be stat'd — the OS evicted the
    // cache entry, or the sandbox path went stale across a reinstall.
    const nativeSize = new File(uri).size;
    if (nativeSize == null) throw new LocalImageMissingError(uri);
    size = nativeSize;
  } catch (error) {
    if (error instanceof LocalImageMissingError) throw error;
    throw new LocalImageMissingError(uri);
  }

  const { requestImageUpload: presign } = await graphqlRequest<{
    requestImageUpload: PresignedUpload;
  }>(GQL_REQUEST_IMAGE_UPLOAD, { input: { kind, mimeType, size } });

  const headers = Object.fromEntries(presign.headers.map((h) => [h.name, h.value]));

  const result = await LegacyFileSystem.uploadAsync(presign.uploadUrl, uri, {
    httpMethod: 'PUT',
    headers,
    uploadType: LegacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(`S3 PUT failed with ${result.status}`, {
      httpStatus: result.status,
      code: 'UPLOAD_FAILED',
    });
  }

  const { confirmImageUpload } = await graphqlRequest<{
    confirmImageUpload: UploadedImage;
  }>(GQL_CONFIRM_IMAGE_UPLOAD, { input: { key: presign.key, kind } });

  return confirmImageUpload;
}
