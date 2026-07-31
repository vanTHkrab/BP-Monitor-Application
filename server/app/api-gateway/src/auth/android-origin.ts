/**
 * Converts keytool SHA-256 fingerprints into the WebAuthn origins Android
 * actually presents.
 *
 * This is the single most confusing part of passkeys on Android, so it is
 * done here rather than left to whoever writes the .env: an Android app does
 * **not** send `https://example.com` as the origin. It sends
 * `android:apk-key-hash:<base64url of the raw SHA-256 digest>`, derived from
 * the certificate the APK was signed with. Configuring the https origin alone
 * makes every registration fail verification with a mismatched-origin error
 * that reads like a server bug.
 *
 * Input is keytool's format — 32 colon-separated hex bytes — and may list
 * several, comma-separated, because debug and release builds are signed
 * differently and Play App Signing re-signs the upload with a third key.
 * Malformed entries are dropped rather than turned into an origin that can
 * never match, which is the failure this function exists to prevent.
 *
 * It lives in its own file, apart from `better-auth.ts`, so it can be unit
 * tested: `better-auth.ts` imports ESM-only packages that the CJS Jest setup
 * cannot load.
 */
export function androidOriginsFromFingerprints(
  fingerprints: string | undefined,
): string[] {
  return (fingerprints ?? '')
    .split(',')
    .map((value) => value.trim().replace(/:/g, '').toLowerCase())
    .filter((hex) => /^[0-9a-f]{64}$/.test(hex))
    .map(
      (hex) =>
        `android:apk-key-hash:${Buffer.from(hex, 'hex').toString('base64url')}`,
    );
}
