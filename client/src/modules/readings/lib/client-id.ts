/**
 * Ids for records created on this device, before the server has issued one.
 *
 * This is the last line of defence against a duplicate reading. The sync
 * drain can be interrupted between "server created the row" and "we recorded
 * that it did" — a crash, a killed app, a lost connection after the request
 * left. On the next pass the same queued row is submitted again, and the only
 * thing that stops a second reading appearing in someone's history is the
 * gateway seeing a `clientId` it already has.
 *
 * That only works if the id is **minted once and never regenerated**. Every
 * retry of a given queued row must send the id it was created with.
 *
 * Ported from client-old's `createClientId` with its reasoning intact:
 * timestamp for rough ordering and debuggability, plus 120 bits of
 * randomness. `Math.random().toString(36).slice(2)` — the shape this
 * replaced — yields around 50 bits with a bias, which is not enough for an
 * identifier a uniqueness constraint depends on.
 */
import * as Crypto from 'expo-crypto';

const RANDOM_BYTES = 15; // 120 bits

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * `<prefix>-<userId>-<base36 timestamp>-<120 random bits>`.
 *
 * The user id is in there so two accounts on one device cannot collide, and
 * so a stray row is attributable when someone is reading the debug screen.
 */
export function createClientId(prefix: string, userId: string): string {
  const timestamp = Date.now().toString(36);
  const random = toHex(Crypto.getRandomValues(new Uint8Array(RANDOM_BYTES)));
  return `${prefix}-${userId}-${timestamp}-${random}`;
}

export const createReadingClientId = (userId: string): string =>
  createClientId('reading', userId);
