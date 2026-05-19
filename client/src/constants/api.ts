// constants/api.ts — endpoint accessors + auth token helpers.
//
// Storage details (SecureStore wrapping, key naming) live in
// `core/storage/`; this file just composes them into the auth-flow
// convenience helpers the slices/transport want to call.

import { env } from "@/src/core/config/env";
import { secureStorage } from "@/src/core/storage/secure.storage";
import { SECURE_KEYS } from "@/src/core/storage/storage.keys";

export const getApiBaseUrl = () => env.API_URL.replace(/\/graphql\/?$/, "");
export const getGraphqlEndpoint = () => env.API_URL;

export const setAuthToken = (token: string): Promise<void> =>
  secureStorage.set(SECURE_KEYS.AUTH_TOKEN, token);

export const getAuthToken = (): Promise<string | null> =>
  secureStorage.get(SECURE_KEYS.AUTH_TOKEN);

export const clearAuthToken = (): Promise<void> =>
  secureStorage.delete(SECURE_KEYS.AUTH_TOKEN);
