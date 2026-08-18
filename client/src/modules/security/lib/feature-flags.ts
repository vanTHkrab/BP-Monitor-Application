/**
 * Ship-time switches for this module.
 *
 * ## `PASSKEY_ENABLED`
 *
 * **This is off because the passkey configuration is not landed, not because
 * the passkey code is dead. Do not delete anything it hides.**
 *
 * A working passkey needs four things to agree, and three of four fails at the
 * device with an error that reads like a server bug: `PASSKEY_RP_ID`, the
 * app-signing-key fingerprint published at the RP's `assetlinks.json`, a real
 * HTTPS domain serving it, and the Android package name. Until all four are
 * true in a deployed environment, every entry point below leads a user into a
 * WebAuthn ceremony that cannot complete — and the failure arrives *after* the
 * system biometric sheet, which reads as "my fingerprint stopped working"
 * rather than "this feature is not set up".
 *
 * So the way in is closed and everything behind it — the hooks, the management
 * screen, the GraphQL operations, the gateway resolvers, the tests — stays in
 * the tree, compiling and covered. Flipping this to `true` is the whole
 * re-enable; there is deliberately no env var and no build-time branch,
 * because a flag you can set per-environment is a flag that ships half-on.
 *
 * ### Turn it on when all of these are true
 *
 *   1. `PASSKEY_RP_ID` on the gateway names a domain the team controls.
 *   2. That domain serves `/.well-known/assetlinks.json` over real HTTPS,
 *      listing the release signing key's SHA-256 fingerprint.
 *   3. The package name in that file matches `android.package` in `app.json`.
 *   4. A registration *and* a sign-in have both completed on a release build.
 *
 * ### What it gates
 *
 * Four entry points, and they gate on different conditions, which is why the
 * flag is one shared constant rather than an edit to
 * `isPasskeyAvailableOnDevice` — that function answers "can this device do
 * WebAuthn", which is a true and useful answer that the security screen still
 * needs for its own message:
 *
 *   - `app/(auth)/login.tsx` — the "เข้าสู่ระบบด้วย Passkey" button.
 *   - `app/security/index.tsx` — the Passkey row on the hub.
 *   - `lib/security-posture.ts` — the banner recommending one.
 *   - `app/security/passkeys.tsx` — the management screen, which stays
 *     routable and so has to close itself.
 *
 * The `: boolean` annotation is load-bearing. Without it the constant takes
 * the literal type `false`, TypeScript narrows every `PASSKEY_ENABLED && …`
 * to `false`, and the code on the other side of each gate reads as unreachable
 * to the compiler and the linter — which is exactly the "this is dead, delete
 * it" conclusion this flag exists to prevent.
 */
export const PASSKEY_ENABLED: boolean = false;
