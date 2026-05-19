// Unified GraphQL transport for the NestJS gateway.
//
// Exposes three request flavors:
//   - graphqlRequest(query, variables?, token?)   JSON, explicit token, 30s timeout
//   - gqlRequest({ query, variables?, signal? })  JSON, auto-fetches token
//   - gqlUpload(query, variables, file, signal?)  multipart (GraphQL multipart spec)
//
// All three share the same 401 / UNAUTHENTICATED fan-out via
// `fireUnauthenticated()` from `core/auth/session` — the auth slice
// registers a handler with `setUnauthenticatedHandler` at store
// bootstrap so a rejected token triggers a single global logout
// regardless of which transport surfaced it.

import { getAuthToken } from "@/src/constants/api";
import { fireUnauthenticated } from "@/src/core/auth/session";
import {
    GQL_ERROR_CODES,
    REQUEST_TIMEOUT_MS,
} from "@/src/core/config/constants";
import { env } from "@/src/core/config/env";
import { GraphQLClientError } from "./errors";

// ── Shared response shapes ─────────────────────────────────────────

interface GqlError {
  message: string;
  extensions?: Record<string, unknown> & { code?: string };
}

interface GqlResponse<T = unknown> {
  data?: T;
  errors?: GqlError[];
}

// ── Shared helpers ─────────────────────────────────────────────────

// Surface GraphQL extension codes (Mercurius/Apollo style: UNAUTHENTICATED,
// FORBIDDEN, BAD_USER_INPUT, …) inside the thrown message so downstream
// formatters in lib/error-message.ts can map them to localized copy.
const formatGqlErrors = (errors: GqlError[]): string =>
  errors
    .map((e) => {
      const code =
        typeof e.extensions?.code === "string" ? e.extensions.code : null;
      return code ? `[${code}] ${e.message}` : e.message;
    })
    .join("; ");

const getOperationName = (query: string): string => {
  const match = query.match(/\b(query|mutation)\s+([A-Za-z0-9_]+)/);
  return match?.[2] ?? "AnonymousOperation";
};

const firstErrorCode = (
  errors: GqlError[] | undefined,
): string | null =>
  typeof errors?.[0]?.extensions?.code === "string"
    ? errors[0].extensions.code
    : null;

// Auto-logout on a rejected token. Only fires when a token was actually
// sent — a 401 / UNAUTHENTICATED on an anonymous request (login, register)
// means "wrong credentials", not "your session expired", so logging out
// the not-logged-in user would be nonsense.
const handleAuthFailure = (
  tokenSent: boolean,
  status: number,
  code: string | null,
): void => {
  if (!tokenSent) return;
  if (status === 401 || code === GQL_ERROR_CODES.UNAUTHENTICATED) {
    fireUnauthenticated();
  }
};

// ── graphqlRequest — JSON with explicit token + timeout + GraphQLClientError ──

export async function graphqlRequest<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  token?: string | null,
): Promise<T> {
  const operationName = getOperationName(query);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    if (__DEV__) {
      console.log(`[GraphQL] ${operationName} request`, {
        endpoint: env.API_URL,
        hasToken: Boolean(token),
        variableKeys: variables ? Object.keys(variables) : [],
      });
    }

    const res = await fetch(env.API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    const rawText = await res.text();
    let json: GqlResponse<T>;

    try {
      json = JSON.parse(rawText) as GqlResponse<T>;
    } catch {
      if (__DEV__) {
        console.warn(`[GraphQL] ${operationName} invalid JSON response`, {
          status: res.status,
          endpoint: env.API_URL,
          preview: rawText.slice(0, 180),
        });
      }
      throw new Error(
        `Invalid JSON response from server while calling ${operationName} (HTTP ${res.status})`,
      );
    }

    // Prefer the standard HTTP `Retry-After` header but fall back to a custom
    // `extensions.retryAfterSec` (lifted from NestJS HttpException body by the
    // gateway's errorFormatter) so the throttle countdown still works even
    // when the server hasn't set the header.
    const readRetryAfter = (
      firstError: GqlError | undefined,
    ): number | null => {
      const headerRaw = res.headers.get("Retry-After");
      const headerParsed = headerRaw ? Number(headerRaw) : NaN;
      if (Number.isFinite(headerParsed)) return headerParsed;
      const ext = firstError?.extensions?.retryAfterSec;
      return typeof ext === "number" && Number.isFinite(ext) ? ext : null;
    };

    if (!res.ok) {
      const firstError = json.errors?.[0];
      const code = firstErrorCode(json.errors);
      const msg =
        (json.errors && json.errors.length > 0
          ? formatGqlErrors(json.errors)
          : null) || `HTTP ${res.status}`;
      const retryAfterSec = readRetryAfter(firstError);
      if (__DEV__) {
        console.warn(`[GraphQL] ${operationName} HTTP error`, {
          status: res.status,
          code,
          retryAfterSec,
          message: msg,
        });
      }
      handleAuthFailure(Boolean(token), res.status, code);
      throw new GraphQLClientError(`${operationName} failed: ${msg}`, {
        code,
        httpStatus: res.status,
        retryAfterSec,
      });
    }

    if (json.errors && json.errors.length > 0) {
      const firstError = json.errors[0];
      const code = firstErrorCode(json.errors);
      const msg = formatGqlErrors(json.errors);
      const retryAfterSec = readRetryAfter(firstError);
      if (__DEV__) {
        // Surface the gateway's class-validator constraint array (lifted
        // into extensions.validationErrors by errorFormatter in dev mode)
        // so the offending field is visible without tailing server stdout.
        const validationErrors = firstError?.extensions?.validationErrors;
        console.warn(`[GraphQL] ${operationName} GraphQL error`, {
          code,
          retryAfterSec,
          message: msg,
          validationErrors,
          variables,
        });
      }
      handleAuthFailure(Boolean(token), res.status, code);
      throw new GraphQLClientError(`${operationName} failed: ${msg}`, {
        code,
        httpStatus: res.status,
        retryAfterSec,
      });
    }

    if (!json.data) {
      if (__DEV__) console.warn(`[GraphQL] ${operationName} returned no data`);
      throw new GraphQLClientError(
        `${operationName} failed: No data returned from server`,
        { httpStatus: res.status },
      );
    }

    if (__DEV__) console.log(`[GraphQL] ${operationName} success`);
    return json.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new GraphQLClientError(
        `${operationName} timed out while connecting to ${env.API_URL}`,
        { code: GQL_ERROR_CODES.NETWORK_TIMEOUT },
      );
    }
    if (error instanceof Error && error.message === "Network request failed") {
      throw new GraphQLClientError(
        `${operationName} network request failed while connecting to ${env.API_URL}`,
        { code: GQL_ERROR_CODES.NETWORK_FAILED },
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── gqlRequest — JSON with auto-fetched token (used by AI/image flow) ──

interface GqlRequestOptions {
  query: string;
  variables?: Record<string, unknown>;
  signal?: AbortSignal;
}

export async function gqlRequest<T = unknown>(
  options: GqlRequestOptions,
): Promise<T> {
  const { query, variables, signal } = options;
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(env.API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    signal,
  });

  if (!res.ok) {
    handleAuthFailure(Boolean(token), res.status, null);
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const json = (await res.json()) as GqlResponse<T>;

  if (json.errors?.length) {
    handleAuthFailure(Boolean(token), res.status, firstErrorCode(json.errors));
    throw new Error(json.errors[0].message);
  }

  if (!json.data) {
    throw new Error("No data returned from GraphQL");
  }

  return json.data;
}

// ── gqlUpload — multipart per the GraphQL multipart spec ────────────

export async function gqlUpload<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
  file: { uri: string; name: string; type: string },
  signal?: AbortSignal,
): Promise<T> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const form = new FormData();
  form.append("operations", JSON.stringify({ query, variables }));
  form.append("map", JSON.stringify({ "0": ["variables.file"] }));
  form.append(
    "0",
    { uri: file.uri, name: file.name, type: file.type } as unknown as Blob,
  );

  const res = await fetch(env.API_URL, {
    method: "POST",
    headers, // NO Content-Type — let fetch set the multipart boundary
    body: form,
    signal,
  });

  if (!res.ok) {
    handleAuthFailure(Boolean(token), res.status, null);
    throw new Error(`HTTP ${res.status}`);
  }

  const json = (await res.json()) as GqlResponse<T>;

  if (json.errors?.length) {
    handleAuthFailure(Boolean(token), res.status, firstErrorCode(json.errors));
    throw new Error(json.errors[0].message);
  }
  if (!json.data) throw new Error("No data from upload");

  return json.data;
}
