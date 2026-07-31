import { androidOriginsFromFingerprints } from './android-origin';

/**
 * These cases exist because the failure they guard against is invisible.
 *
 * A wrong Android origin does not throw at boot or fail a type-check — the
 * service starts, the endpoint answers, and passkey registration is rejected
 * on the device with a mismatched-origin error that reads like a server bug.
 * The conversion is the only place that can catch it.
 */
describe('androidOriginsFromFingerprints', () => {
  // Google's own documented example fingerprint.
  const FINGERPRINT =
    '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';
  const EXPECTED = 'android:apk-key-hash:FG3pg8VzBlDY7rmVLzT8ZBagg0LmHb6oigSWsj_PROU';

  it('converts a keytool fingerprint to the apk-key-hash origin', () => {
    expect(androidOriginsFromFingerprints(FINGERPRINT)).toEqual([EXPECTED]);
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(androidOriginsFromFingerprints(`  ${FINGERPRINT.toLowerCase()} `)) //
      .toEqual([EXPECTED]);
  });

  it('accepts several fingerprints, for debug, release, and Play signing', () => {
    const second = FINGERPRINT.replace(/^14/, '15');
    const origins = androidOriginsFromFingerprints(`${FINGERPRINT},${second}`);

    expect(origins).toHaveLength(2);
    expect(origins[0]).toBe(EXPECTED);
    expect(origins[1]).not.toBe(EXPECTED);
  });

  it('drops malformed entries rather than emitting a broken origin', () => {
    // Truncated, SHA-1 rather than SHA-256, and empty. Each would produce an
    // origin that never matches, which is harder to diagnose than none.
    expect(androidOriginsFromFingerprints('14:6D:E9')).toEqual([]);
    expect(
      androidOriginsFromFingerprints(
        '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42',
      ),
    ).toEqual([]);
    expect(androidOriginsFromFingerprints('')).toEqual([]);
    expect(androidOriginsFromFingerprints(undefined)).toEqual([]);
  });

  it('keeps the valid entries when one of several is malformed', () => {
    expect(androidOriginsFromFingerprints(`not-a-hash,${FINGERPRINT}`)).toEqual([
      EXPECTED,
    ]);
  });

  it('emits base64url, not base64 — "+" and "/" break the origin string', () => {
    const origins = androidOriginsFromFingerprints(FINGERPRINT);
    expect(origins[0]).not.toMatch(/[+/=]/);
  });
});
