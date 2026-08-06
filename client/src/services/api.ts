/**
 * GraphQL transport for the NestJS gateway.
 *
 * Hand-rolled rather than Apollo/urql on purpose: this app's source of truth
 * for offline-first data is SQLite, not a normalized client cache, so a
 * GraphQL client library would mostly add a second cache competing with the
 * local database. What is actually project-specific — the 401 fan-out, the
 * throttle countdown, the multipart upload shape — has to be written either
 * way.
 *
 * The old client had two transports (`graphqlRequest` and `gqlRequest`) with
 * copy-pasted auth-failure handling and different error types. They are one
 * function here, and `graphqlUpload` shares the same response handling.
 */
import { network } from '@/config';
import { ApiError } from './api-error';
import { getAuthToken } from './auth-token';
import { getGraphqlEndpoint } from './endpoint';
import { fireUnauthenticated } from './session';

const REQUEST_TIMEOUT_MS = network.requestTimeoutMs;

type GraphqlError = {
  message: string;
  extensions?: Record<string, unknown> & { code?: string };
};

type GraphqlResponse<T> = {
  data?: T;
  errors?: GraphqlError[];
};

/**
 * Keeps the server's extension code inside the message so downstream
 * formatters can map it to localized copy without re-reading `error.code`.
 */
function formatErrors(errors: GraphqlError[]): string {
  return errors
    .map((e) => {
      const code = typeof e.extensions?.code === 'string' ? e.extensions.code : null;
      return code ? `[${code}] ${e.message}` : e.message;
    })
    .join('; ');
}

function operationNameOf(query: string): string {
  return query.match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/)?.[1] ?? 'AnonymousOperation';
}

function codeOf(error: GraphqlError | undefined): string | null {
  return typeof error?.extensions?.code === 'string' ? error.extensions.code : null;
}

/**
 * Prefers the standard `Retry-After` header, falling back to the gateway's
 * `extensions.retryAfterSec` so the throttle countdown still works when the
 * header is absent.
 */
function retryAfterOf(response: Response, error: GraphqlError | undefined): number | null {
  const header = response.headers.get('Retry-After');
  const parsed = header ? Number(header) : Number.NaN;
  if (Number.isFinite(parsed)) return parsed;

  const ext = error?.extensions?.retryAfterSec;
  return typeof ext === 'number' && Number.isFinite(ext) ? ext : null;
}

/**
 * Auto-logout, but only when a token was actually sent.
 *
 * A 401 on an anonymous request (login, register) just means "wrong
 * credentials". Logging out a user who is not logged in would be nonsense,
 * and would race the login mutation's own error handling.
 */
function handleAuthFailure(tokenSent: boolean, status: number, code: string | null): void {
  if (!tokenSent) return;
  if (status === 401 || code === 'UNAUTHENTICATED') fireUnauthenticated();
}

/** Shared by the JSON and multipart paths so 401 handling cannot drift. */
async function readResponse<T>(
  response: Response,
  operationName: string,
  tokenSent: boolean,
): Promise<T> {
  const rawText = await response.text();

  let json: GraphqlResponse<T>;
  try {
    json = JSON.parse(rawText) as GraphqlResponse<T>;
  } catch {
    // An HTML error page or a proxy response — surface the status and a
    // slice of the body rather than a bare "Unexpected token <".
    throw new ApiError(
      `${operationName} failed: invalid JSON response (HTTP ${response.status}): ` +
        rawText.slice(0, 180),
      { httpStatus: response.status },
    );
  }

  const firstError = json.errors?.[0];
  const code = codeOf(firstError);

  if (!response.ok || json.errors?.length) {
    handleAuthFailure(tokenSent, response.status, code);
    const message = json.errors?.length ? formatErrors(json.errors) : `HTTP ${response.status}`;
    throw new ApiError(`${operationName} failed: ${message}`, {
      code,
      httpStatus: response.status,
      retryAfterSec: retryAfterOf(response, firstError),
    });
  }

  if (!json.data) {
    throw new ApiError(`${operationName} failed: no data returned from server`, {
      httpStatus: response.status,
    });
  }

  return json.data;
}

/** Maps fetch's opaque failures onto codes a screen can branch on. */
function toApiError(error: unknown, operationName: string, endpoint: string): unknown {
  if (error instanceof Error && error.name === 'AbortError') {
    return new ApiError(`${operationName} timed out while connecting to ${endpoint}`, {
      code: 'NETWORK_TIMEOUT',
    });
  }
  if (error instanceof Error && error.message === 'Network request failed') {
    return new ApiError(`${operationName} could not reach ${endpoint}`, {
      code: 'NETWORK_FAILED',
    });
  }
  return error;
}

export type GraphqlRequestOptions = {
  /** Caller-supplied cancellation, on top of the built-in timeout. */
  signal?: AbortSignal;
};

export async function graphqlRequest<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  options: GraphqlRequestOptions = {},
): Promise<T> {
  const endpoint = getGraphqlEndpoint();
  const operationName = operationNameOf(query);
  const token = await getAuthToken();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    return await readResponse<T>(response, operationName, Boolean(token));
  } catch (error) {
    throw toApiError(error, operationName, endpoint);
  } finally {
    clearTimeout(timeout);
  }
}

export type UploadFile = {
  uri: string;
  name: string;
  type: string;
};

/**
 * Multipart upload following the GraphQL multipart request spec.
 *
 * The file part is the React Native `{ uri, name, type }` descriptor, not a
 * Blob: `new Blob([Uint8Array])` type-checks but throws at runtime on
 * native, and FormData can stream a file URI without loading it into JS
 * memory.
 *
 * Content-Type is deliberately unset so fetch generates the multipart
 * boundary itself.
 */
export async function graphqlUpload<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
  file: UploadFile,
  options: GraphqlRequestOptions = {},
): Promise<T> {
  const endpoint = getGraphqlEndpoint();
  const operationName = operationNameOf(query);
  const token = await getAuthToken();

  const form = new FormData();
  form.append('operations', JSON.stringify({ query, variables }));
  form.append('map', JSON.stringify({ '0': ['variables.file'] }));
  form.append('0', file as unknown as Blob);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
      signal: controller.signal,
    });

    return await readResponse<T>(response, operationName, Boolean(token));
  } catch (error) {
    throw toApiError(error, operationName, endpoint);
  } finally {
    clearTimeout(timeout);
  }
}

export {
  ApiError,
  errorCode,
  errorHttpStatus,
  errorRetryAfterSec,
  isApiError,
  isNetworkError,
} from './api-error';
export { clearAuthToken, getAuthToken, setAuthToken } from './auth-token';
export { getApiBaseUrl, getGraphqlEndpoint } from './endpoint';
export { fireUnauthenticated, setUnauthenticatedHandler } from './session';
