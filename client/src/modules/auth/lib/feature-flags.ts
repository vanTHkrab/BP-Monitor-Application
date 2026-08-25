/**
 * Ship-time switches for this module.
 *
 * ## `GOOGLE_SIGN_IN_ENABLED`
 *
 * **On since 2026-08-25, shipping in 1.2.0.** Verified end to end on a real
 * Android device the day before: a Google account is created, `resolveGate`
 * routes it through the phone step and then role selection, and it lands in
 * the app. Every blocker `docs/project/AUTH-google-oauth-plan.md` named is
 * closed.
 *
 * **Two rough edges ship with it, deliberately.** Neither breaks the flow;
 * both are worth knowing before the first support message arrives:
 *
 *   - **The completion form is one screen short of what was asked for.** A
 *     Google account arrives missing three things — phone, the health block,
 *     and role — and collects them across two screens, with the health block
 *     deferred until the profile screen demands it. Merging them into one
 *     step is being decided by the team.
 *   - **Gap 4 is open.** `googleSignInRefusalMessage()` is written and tested
 *     and rendered nowhere, so the one refusal `emailVerified: false`
 *     produces reaches the user as a generic "try again" rather than as the
 *     "verify your email first" it was written to say.
 *
 * Turning it off again is one line and everything behind it stays exercised.
 *
 * **Being on here is not enough on its own**, and the failure is
 * environment-shaped rather than code-shaped — see
 * `docs/guides/google-sign-in-setup.md`. Every signing key needs its own
 * Android OAuth client registered against its SHA-1, and every client ID has
 * to belong to the same Google Cloud project as `google-services.json`. A
 * mismatch surfaces as `DEVELOPER_ERROR` and nothing else.
 *
 * **1.2.0 proved that "verified on a device" and "works in production" are
 * different claims.** It shipped green off a debug build and failed on the
 * first real install, because the two differ in three places at once that no
 * test can see: Play re-signs the app with its own certificate, EAS supplies
 * `EXPO_PUBLIC_*` from its own environment rather than `client/.env`, and the
 * deployed gateway's `.env` never gained `GOOGLE_CLIENT_ID`. Verify against
 * the artefact you are actually shipping, not the one on your desk.
 *
 * Unlike the passkey flag this module's sibling defines
 * (`modules/security/lib/feature-flags.ts`), this one never gated missing
 * configuration. `isGoogleSignInConfigured()` in
 * `hooks/use-google-sign-in.ts` answers the technical question — a build
 * either has `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` or it does not — and this
 * flag answered the separate product question of whether the route should be
 * offered at all. Both now say yes.
 *
 * ### What it gates
 *
 * One entry point — Google sign-in has never had passkey's four-way surface
 * area. `app/(auth)/login.tsx`'s `onGoogle` handler, gated as
 * `GOOGLE_SIGN_IN_ENABLED && isGoogleSignInConfigured()`: **both**
 * conditions, not a replacement for the env check, because a build that has
 * the credentials configured still needs this flag flipped before the button
 * appears. `AlternateSignIn` already renders nothing for a method whose
 * handler is `undefined` and drops itself entirely when neither method
 * survives, so no component downstream of `login.tsx` needed a change.
 *
 * `security/index.tsx`'s "บัญชี Google" row and `app/profile.tsx` /
 * `app/(auth)/verify-email.tsx`'s mentions of Google are a different feature
 * — *linking* an already-authenticated account — and are untouched by this
 * flag. Hiding sign-in does not hide account state or the linking flow.
 */
export const GOOGLE_SIGN_IN_ENABLED: boolean = true;
