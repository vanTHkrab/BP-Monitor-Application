/**
 * Every `process.env` read in the app, in one place.
 *
 * Expo inlines `EXPO_PUBLIC_*` at build time by **literal text substitution**
 * — the bundler rewrites the exact string `process.env.EXPO_PUBLIC_API_URL`,
 * so a dynamic read like `process.env[name]` silently yields `undefined` in a
 * release build while working fine in dev. Every variable therefore has to be
 * named literally, which is exactly the kind of rule that gets forgotten when
 * the reads are scattered across five modules.
 *
 * What is *not* here: `app.json`, `babel.config.js`, `metro.config.js`,
 * `tailwind.config.js`, `tsconfig.json`, `eslint.config.js`,
 * `drizzle.config.ts`. Those live at the project root because the tools that
 * read them resolve from there — they cannot move into `src/config/`, and
 * this directory is not an attempt to.
 */

/** Nothing public is a secret: `EXPO_PUBLIC_*` ships inside the bundle. */
const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text ? text : undefined;
};

export const env = {
  /**
   * The gateway's GraphQL endpoint. Optional here and resolved in
   * `services/endpoint.ts`, which falls back to the Expo host in dev and
   * throws in a build rather than guessing localhost.
   */
  apiUrl: trimmed(process.env.EXPO_PUBLIC_API_URL),

  /**
   * Google sign-in is absent rather than broken when unset — see
   * `modules/auth/hooks/use-google-sign-in.ts`.
   */
  googleWebClientId: trimmed(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
} as const;

/**
 * The platform Expo built for. `Platform.OS` from react-native is the right
 * call inside a component; this is the build-time constant, which is what the
 * device-label helpers want and what works outside React.
 */
export const platform = process.env.EXPO_OS as 'ios' | 'android' | 'web' | undefined;

/** True in a development build or Expo Go, false in a release bundle. */
export const isDev = __DEV__;
