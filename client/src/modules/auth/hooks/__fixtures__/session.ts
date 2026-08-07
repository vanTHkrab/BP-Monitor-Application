/**
 * The two things every auth-hook suite beside this file needs: a `User` that
 * satisfies the type, and a way to observe *when* the store flipped.
 *
 * `observeSignIn` exists because the ordering comments in `use-login.ts`,
 * `use-register.ts`, `use-google-sign-in.ts`, and `use-passkey-sign-in.ts` all
 * claim the same non-obvious invariant — the `me` cache is repopulated
 * **before** `signedIn` flips `status` — and that claim is unfalsifiable by
 * looking at end state. Both writes have happened by the time the mutation
 * resolves, so a test that reads the cache afterwards passes with the two
 * lines in either order. Zustand notifies synchronously, so subscribing and
 * sampling the cache from inside the listener catches the exact moment the
 * route gate could first re-render.
 */
import type { QueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/stores';
import type { User } from '../../types';

export const USER: User = {
  id: 'u1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  email: 'somchai@example.com',
  emailVerified: false,
  role: 'patient',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

export const OTHER_USER: User = {
  ...USER,
  id: 'u2',
  firstname: 'มานี',
  phone: '0899999999',
  email: 'manee@example.com',
};

export type SignInObservation = {
  /** What `['me']` held at the instant `status` became `authenticated`. */
  meAtFlip: User | null | undefined;
  /** How many unrelated cache entries survived the flip. */
  strayKeysAtFlip: number;
  flipped: boolean;
};

/**
 * Subscribes until the returned `stop()` is called. Sampling happens once,
 * on the first transition into `authenticated`.
 */
export function observeSignIn(client: QueryClient): {
  observation: SignInObservation;
  stop: () => void;
} {
  const observation: SignInObservation = {
    meAtFlip: undefined,
    strayKeysAtFlip: -1,
    flipped: false,
  };

  const unsubscribe = useAuthStore.subscribe((state) => {
    if (observation.flipped || state.status !== 'authenticated') return;
    observation.flipped = true;
    observation.meAtFlip = client.getQueryData<User>(['me']) ?? null;
    observation.strayKeysAtFlip = client
      .getQueryCache()
      .getAll()
      .filter((entry) => entry.queryKey[0] !== 'me').length;
  });

  return { observation, stop: unsubscribe };
}
