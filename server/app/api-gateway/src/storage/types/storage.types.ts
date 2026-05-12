import { registerEnumType } from '@nestjs/graphql';

export enum ImageKind {
  PROFILE = 'profile',
  BLOOD_PRESSURE_READING = 'blood-pressure-reading',
}

registerEnumType(ImageKind, {
  name: 'ImageKind',
  description: 'Kind of image being uploaded — drives folder placement.',
});

export const IMAGE_FOLDERS: Record<ImageKind, string> = {
  [ImageKind.PROFILE]: 'app/profile-images',
  [ImageKind.BLOOD_PRESSURE_READING]: 'training/blood-pressure-meter-images',
};

export const PENDING_SEGMENT = 'pending';

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
