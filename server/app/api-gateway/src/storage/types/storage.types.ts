export type ImageKind = 'profile' | 'blood-pressure-reading';

export const IMAGE_FOLDERS: Record<ImageKind, string> = {
  profile: 'app/profile-images',
  'blood-pressure-reading': 'training/blood-pressure-meter-images',
};

export const ALLOWED_IMAGE_PREFIXES = [
  'app/profile-images/',
  'training/blood-pressure-meter-images/',
  'profiles/',
  'blood-pressure-meter-images/',
] as const;

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
