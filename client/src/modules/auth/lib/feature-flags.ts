/**
 * Ship-time switches for this module.
 *
 * ## `GOOGLE_SIGN_IN_ENABLED`
 *
 * **Off, and the reason is no longer technical either.** It was verified
 * end to end on a real device on 2026-08-24 — a Google account is created,
 * `resolveGate` routes it through the phone step and then role selection, and
 * it lands in the app. Every blocker the plan named is closed.
 *
 * What is left is product, in two pieces:
 *
 *   - **The completion form is one screen short of what was asked for.** A
 *     Google account arrives missing three things — phone, the health block,
 *     and role — and today collects them across two screens with the health
 *     block deferred until the profile screen demands it. Merging them into
 *     one completion step is designed but not built.
 *   - **Gap 4 is open.** `googleSignInRefusalMessage()` is written and tested
 *     and rendered nowhere, so the one refusal `emailVerified: false`
 *     produces reaches the user as a generic "try again".
 *
 * Neither breaks anything on its own, and neither is a reason the flag could
 * not be flipped tomorrow. It is off because shipping a sign-in route is a
 * product call — the same kind it always was, now with the engineering behind
 * it finished rather than pending.
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
export const GOOGLE_SIGN_IN_ENABLED: boolean = false;
