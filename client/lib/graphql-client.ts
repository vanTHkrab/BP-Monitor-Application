import {
  fireUnauthenticated,
  getAuthToken,
  getGraphqlEndpoint,
} from '@/constants/api';

interface GQLOptions {
  query: string;
  variables?: Record<string, unknown>;
  signal?: AbortSignal;
}

interface GqlErrorShape {
  message: string;
  extensions?: { code?: string };
}

interface GqlResponseShape<T> {
  data?: T;
  errors?: GqlErrorShape[];
}

// Auto-logout on a rejected token. Mirrors graphqlRequest's behavior so the
// AI / image-upload flow doesn't sit in a permanent "session-expired but
// nobody told the user" state. Only fires when a token was actually sent —
// public endpoints (none today, but defensive) shouldn't trigger logout.
const maybeFireUnauthenticated = (
  tokenSent: boolean,
  status: number,
  code: string | undefined,
): void => {
  if (!tokenSent) return;
  if (status === 401 || code === 'UNAUTHENTICATED') {
    fireUnauthenticated();
  }
};

const firstErrorCode = (
  errors: GqlErrorShape[] | undefined,
): string | undefined => errors?.[0]?.extensions?.code;

export async function gqlRequest<T = unknown>(options: GQLOptions): Promise<T> {
  const { query, variables, signal } = options;
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(getGraphqlEndpoint(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    signal,
  });

  if (!res.ok) {
    maybeFireUnauthenticated(Boolean(token), res.status, undefined);
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const json = (await res.json()) as GqlResponseShape<T>;

  if (json.errors?.length) {
    maybeFireUnauthenticated(Boolean(token), res.status, firstErrorCode(json.errors));
    throw new Error(json.errors[0].message);
  }

  if (!json.data) {
    throw new Error('No data returned from GraphQL');
  }

  return json.data;
}

// Multipart upload — GraphQL multipart spec
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
  form.append('operations', JSON.stringify({ query, variables }));
  form.append('map', JSON.stringify({ '0': ['variables.file'] }));
  form.append('0', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);

  const res = await fetch(getGraphqlEndpoint(), {
    method: 'POST',
    headers, // NO Content-Type — let fetch set multipart boundary
    body: form,
    signal,
  });

  if (!res.ok) {
    maybeFireUnauthenticated(Boolean(token), res.status, undefined);
    throw new Error(`HTTP ${res.status}`);
  }

  const json = (await res.json()) as GqlResponseShape<T>;

  if (json.errors?.length) {
    maybeFireUnauthenticated(Boolean(token), res.status, firstErrorCode(json.errors));
    throw new Error(json.errors[0].message);
  }
  if (!json.data) throw new Error('No data from upload');

  return json.data;
}
