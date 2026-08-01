/**
 * Resolves the GraphQL endpoint of the NestJS gateway.
 *
 * In Expo Go there is usually no env var set, so the LAN host the bundler is
 * served from is a good guess. In a release build there is no Expo host at
 * all, which is why a missing EXPO_PUBLIC_API_URL throws rather than falling
 * back to localhost — a device resolving "localhost" would silently hit
 * itself and every request would fail with an unhelpful network error.
 */
import Constants from 'expo-constants';

import { env } from '@/config';

const DEFAULT_API_PORT = '3000';

const isLoopbackHost = (host: string) =>
  host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0';

/** The shape varies by Expo runtime (Go, dev client, release), hence the fan-out. */
type ConstantsHostShape = {
  expoGoConfig?: { debuggerHost?: string; hostUri?: string };
  manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
  manifest?: { debuggerHost?: string };
  platform?: { hostUri?: string };
};

function getExpoHostUri(): string | null {
  const c = Constants as unknown as ConstantsHostShape;
  const hostUri =
    Constants.expoConfig?.hostUri ||
    c.expoGoConfig?.debuggerHost ||
    c.expoGoConfig?.hostUri ||
    c.manifest2?.extra?.expoClient?.hostUri ||
    c.manifest?.debuggerHost ||
    c.platform?.hostUri ||
    null;

  return typeof hostUri === 'string' && hostUri.length > 0 ? hostUri : null;
}

export function resolveGraphqlEndpoint(): string {
  if (env.apiUrl) return env.apiUrl;

  const hostUri = getExpoHostUri();
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && !isLoopbackHost(host)) {
      return `http://${host}:${DEFAULT_API_PORT}/graphql`;
    }
  }

  // Fail loudly. Silently picking a default here means a misconfigured build
  // hits some other developer's machine, or nothing at all, with no clue why.
  throw new Error(
    '[GraphQL] EXPO_PUBLIC_API_URL is not set and no usable Expo host URI was ' +
      'found. Add EXPO_PUBLIC_API_URL=http://<host>:3000/graphql to client/.env ' +
      "(or to app.json's `expo.extra` for a build).",
  );
}

/** Resolved once — the endpoint cannot change while the app is running. */
let cachedEndpoint: string | null = null;

export function getGraphqlEndpoint(): string {
  cachedEndpoint ??= resolveGraphqlEndpoint();
  return cachedEndpoint;
}

/** Same host without the /graphql suffix, for REST-ish routes and S3 helpers. */
export function getApiBaseUrl(): string {
  return getGraphqlEndpoint().replace(/\/graphql\/?$/, '');
}
