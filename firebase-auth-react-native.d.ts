import type { Persistence } from 'firebase/auth';

declare module 'firebase/auth' {
  // React Native build of Firebase Auth exports this helper at runtime,
  // but TypeScript types may not include it depending on module resolution.
  export function getReactNativePersistence(storage: unknown): Persistence;
}
