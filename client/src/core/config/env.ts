// Single source of truth for environment-derived configuration.
// Read env vars HERE, not via `process.env.*` scattered across the app.
//
// Expo note: EXPO_PUBLIC_* vars are inlined into the JS bundle at build
// time and are visible to anyone with the .apk/.ipa — they cannot hold
// secrets. Anything secret belongs behind the gateway, not here.

import Constants from "expo-constants";
import { z } from "zod";

const DEFAULT_API_PORT = "3000";

const isLoopbackHost = (h: string) =>
  h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "0.0.0.0";

interface ConstantsHostShape {
  expoGoConfig?: { debuggerHost?: string; hostUri?: string };
  manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
  manifest?: { debuggerHost?: string };
  platform?: { hostUri?: string };
}

// Dev convenience: when EXPO_PUBLIC_API_URL is unset in Expo Go, derive
// the gateway URL from the Metro bundler host so a fresh clone works
// on LAN without a .env. Returns undefined in EAS/release builds where
// no Expo host exists.
function resolveExpoLanApiUrl(): string | undefined {
  const c = Constants as unknown as ConstantsHostShape;
  const hostUri =
    Constants.expoConfig?.hostUri ||
    c.expoGoConfig?.debuggerHost ||
    c.expoGoConfig?.hostUri ||
    c.manifest2?.extra?.expoClient?.hostUri ||
    c.manifest?.debuggerHost ||
    c.platform?.hostUri ||
    null;

  if (!hostUri) return undefined;
  const host = hostUri.split(":")[0];
  if (!host || isLoopbackHost(host)) return undefined;
  return `http://${host}:${DEFAULT_API_PORT}/graphql`;
}

const EnvSchema = z.object({
  API_URL: z
    .url("API_URL must be a valid URL, e.g. https://api.example.com/graphql")
    .refine((u) => u.endsWith("/graphql"), {
      message: "API_URL must end with /graphql (Mercurius endpoint path)",
    }),
  IS_DEV: z.boolean(),
});

export type Env = z.infer<typeof EnvSchema>;

function resolveRaw() {
  return {
    API_URL:
      process.env.EXPO_PUBLIC_API_URL?.trim() || resolveExpoLanApiUrl(),
    IS_DEV: __DEV__,
  };
}

function parseEnv(): Env {
  const result = EnvSchema.safeParse(resolveRaw());

  if (result.success) {
    if (__DEV__) console.log(`[env] API_URL=${result.data.API_URL}`);
    return result.data;
  }

  const issues = result.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");

  throw new Error(
    `[env] Invalid environment configuration:\n${issues}\n\n` +
      `Set EXPO_PUBLIC_API_URL in client/.env (see client/.env.example), ` +
      `or run via Expo Go on LAN so the host can be auto-detected.`,
  );
}

export const env: Env = parseEnv();
