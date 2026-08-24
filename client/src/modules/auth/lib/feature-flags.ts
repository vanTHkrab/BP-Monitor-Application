/**
 * Ship-time switches for this module.
 *
 * ## `GOOGLE_SIGN_IN_ENABLED`
 *
 * **On since 2026-08-24, for testing ahead of the PR.** It had been off by
 * product decision rather than any technical blocker, and the technical half
 * is now genuinely done — `user_informations` freed `users.phone`, and
 * `mapProfileToUser` supplies the `firstname` / `lastname` that Better Auth
 * required. Before that a Google account could not be inserted at all.
 *
 * **What is still missing, and what it looks like when you hit it.** Gap 3 of
 * `docs/project/AUTH-google-oauth-plan.md` is not done: nothing routes a new
 * Google account to `app/(auth)/onboarding-phone.tsx`. `resolveGate` has no
 * signal for "this account has no usable phone", so a first-time Google user
 * lands on role selection and then in the app holding `phone: null`. They are
 * not broken — the profile form asks for the number the first time they open
 * it — but until they fill it in **no caregiver can find them**, because the
 * invite lookup is an equality match on `phone` and cannot match a NULL. The
 * signal Gap 3 needs now exists (`phone == null`); the routing does not.
 *
 * Turning this off again is one line, and the code it hides stays working.
 *
 * Unlike the passkey flag this module's sibling defines
 * (`modules/security/lib/feature-flags.ts`), there is no missing
 * configuration behind this one. `isGoogleSignInConfigured()` in
 * `hooks/use-google-sign-in.ts` already answers the technical question — a
 * build either has `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` or it does not, and the
 * code path works end to end when it does. This flag exists because the
 * sign-in flow itself has not had product sign-off to ship yet, which is a
 * different kind of gate: nothing here becomes true by configuring a service
 * correctly. Turning it back on is a product call, not an infra checklist.
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
