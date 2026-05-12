import { registerEnumType } from '@nestjs/graphql';

export enum ImageKind {
  PROFILE = 'profile',
  BLOOD_PRESSURE_READING = 'blood-pressure-reading',
}

registerEnumType(ImageKind, {
  name: 'ImageKind',
  description: 'Kind of image being uploaded — drives folder placement.',
});

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
]);

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const MIME_TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

// ── S3 key layout ─────────────────────────────────────────────────────────────
//
// All user-owned objects live under `users/{userId}/...`. Deleting a user is
// a single prefix delete — GDPR-friendly. Pending uploads live in a separate
// feature-agnostic `tmp/{userId}/...` namespace so one lifecycle rule cleans
// orphans across every feature.
//
// Layout reference:
//   users/{userId}/profile/avatar/{uuid}.{ext}
//   users/{userId}/bp/readings/{YYYY-MM}/{uuid}.{ext}
//   tmp/{userId}/{uuid}.{ext}
//
// Future reservations (not implemented here, but the prefix list anticipates):
//   users/{userId}/posts/{postId}/{uuid}.{ext}
//   users/{userId}/exports/{uuid}.{ext}
//   app/static/...        — public assets, CDN-fronted
//   training/bp-meter/... — curated/anonymized ML corpus

export const TMP_ROOT = 'tmp';
export const USERS_ROOT = 'users';

/**
 * Prefixes a key may legally start with. Used to gate
 * `StorageController.getImage` so users can't fetch arbitrary keys.
 */
export const ALLOWED_IMAGE_PREFIXES = [
  `${USERS_ROOT}/`,
  `${TMP_ROOT}/`,
] as const;

const extFromMime = (mimeType: string): string =>
  MIME_TYPE_EXTENSIONS[mimeType] ?? '';

const monthPartition = (now: Date = new Date()): string =>
  now.toISOString().slice(0, 7); // YYYY-MM

/**
 * Where a confirmed object of `kind` ends up, given an opaque object id and
 * its mime type. Keep this centralized so every caller (presigned confirm,
 * legacy multipart shim, future features) builds the same shape.
 */
export const buildFinalKey = (
  kind: ImageKind,
  userId: string,
  objectId: string,
  mimeType: string,
): string => {
  const ext = extFromMime(mimeType);
  switch (kind) {
    case ImageKind.PROFILE:
      return `${USERS_ROOT}/${userId}/profile/avatar/${objectId}${ext}`;
    case ImageKind.BLOOD_PRESSURE_READING:
      return `${USERS_ROOT}/${userId}/bp/readings/${monthPartition()}/${objectId}${ext}`;
  }
};

/** A pending key — same shape regardless of kind. */
export const buildTmpKey = (
  userId: string,
  objectId: string,
  mimeType: string,
): string => `${TMP_ROOT}/${userId}/${objectId}${extFromMime(mimeType)}`;

/** Validates that a tmp key belongs to the given user. */
export const isTmpKeyOwnedBy = (userId: string, key: string): boolean => {
  if (key.includes('..')) return false;
  return key.startsWith(`${TMP_ROOT}/${userId}/`);
};

/** Validates that a final user-scoped key belongs to the given user + kind. */
export const isFinalKeyOwnedBy = (
  kind: ImageKind,
  userId: string,
  key: string,
): boolean => {
  if (key.includes('..')) return false;
  const featurePrefix =
    kind === ImageKind.PROFILE
      ? `${USERS_ROOT}/${userId}/profile/`
      : `${USERS_ROOT}/${userId}/bp/`;
  return key.startsWith(featurePrefix);
};
