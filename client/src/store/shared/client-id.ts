export const isLocalReadingId = (id: string) => id.startsWith("local-");
export const toLocalReadingId = (localId: number) => `local-${localId}`;
export const parseLocalReadingId = (id: string) =>
  Number(id.replace("local-", ""));

export const isLocalPostId = (id: string) => id.startsWith("local-post-");
export const toLocalPostId = (localId: number) => `local-post-${localId}`;
export const parseLocalPostId = (id: string) =>
  Number(id.replace("local-post-", ""));

// Combine timestamp + multiple Math.random() chunks for ~120 bits of entropy.
// Cryptographically weak but collision-resistant enough for offline-sync IDs;
// switch to expo-crypto's randomUUID() if/when that dependency is added.
const randomChunk = () =>
  Math.random().toString(36).slice(2, 12).padStart(10, "0");

export const createClientId = (prefix: string, userId: string) =>
  `${prefix}-${userId}-${Date.now().toString(36)}-${randomChunk()}${randomChunk()}`;
