// expo-crypto's native module is absent under jest-expo. The replacement is
// a real PRNG, not a stub returning zeroes — a mock that always produced the
// same bytes would make the uniqueness assertions below pass vacuously.
jest.mock('expo-crypto', () => ({
  getRandomValues: (array: Uint8Array) => {
    for (let i = 0; i < array.length; i += 1) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return array;
  },
}));

import { createClientId, createReadingClientId } from './client-id';

describe('createClientId', () => {
  it('includes the prefix and the user id', () => {
    const id = createClientId('reading', 'user-1');

    expect(id.startsWith('reading-user-1-')).toBe(true);
  });

  // The whole point: this id is what the gateway's uniqueness check keys on
  // when a sync retries a row it may have already created.
  it('does not repeat across many calls in the same millisecond', () => {
    const ids = new Set(Array.from({ length: 5_000 }, () => createReadingClientId('user-1')));

    expect(ids.size).toBe(5_000);
  });

  it('separates two accounts on the same device', () => {
    const a = createReadingClientId('user-a');
    const b = createReadingClientId('user-b');

    expect(a.includes('user-a')).toBe(true);
    expect(b.includes('user-b')).toBe(true);
    expect(a).not.toBe(b);
  });

  // 120 bits as 30 hex characters. Checked because the failure mode of a
  // shorter id is a collision months later, in one user's history.
  it('carries 120 bits of randomness', () => {
    const random = createClientId('reading', 'u').split('-').at(-1);

    expect(random).toMatch(/^[0-9a-f]{30}$/);
  });
});
