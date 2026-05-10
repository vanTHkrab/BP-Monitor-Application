import { getApiBaseUrl } from '@/constants/api';

const storagePrefixes = [
  'app/profile-images/',
  'training/blood-pressure-meter-images/',
  'profiles/',
  'blood-pressure-meter-images/',
];

const extractStorageKey = (uri: string) => {
  const raw = uri.trim();
  if (!raw) return null;

  const directPrefix = storagePrefixes.find((prefix) => raw.startsWith(prefix));
  if (directPrefix) return raw;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 's3:') {
      const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      const directStoragePrefix = storagePrefixes.find((prefix) =>
        path.startsWith(prefix),
      );
      return directStoragePrefix ? path : null;
    }

    const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));

    for (const prefix of storagePrefixes) {
      const index = path.indexOf(prefix);
      if (index >= 0) {
        return path.slice(index);
      }
    }
  } catch {
    return null;
  }

  return null;
};

export const toDisplayImageUri = (uri?: string | null) => {
  if (!uri) return undefined;

  const key = extractStorageKey(uri);
  if (!key) return uri;

  return `${getApiBaseUrl()}/storage/image?key=${encodeURIComponent(key)}`;
};
