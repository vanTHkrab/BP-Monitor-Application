import AsyncStorage from '@react-native-async-storage/async-storage';

const GQL_ENDPOINT = process.env.EXPO_PUBLIC_API_URL + '/graphql';

interface GQLOptions {
  query: string;
  variables?: Record<string, unknown>;
  signal?: AbortSignal;
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function gqlRequest<T = unknown>(options: GQLOptions): Promise<T> {
  const { query, variables, signal } = options;
  const authHeader = await getAuthHeader();

  const res = await fetch(GQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...authHeader,
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json() as { data?: T; errors?: { message: string }[] };

  if (json.errors?.length) {
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
  const authHeader = await getAuthHeader();

  const form = new FormData();
  form.append('operations', JSON.stringify({ query, variables }));
  form.append('map', JSON.stringify({ '0': ['variables.file'] }));
  form.append('0', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);

  const res = await fetch(GQL_ENDPOINT, {
    method: 'POST',
    headers: authHeader,  // NO Content-Type — let fetch set multipart boundary
    body: form,
    signal,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { data?: T; errors?: { message: string }[] };

  if (json.errors?.length) throw new Error(json.errors[0].message);
  if (!json.data) throw new Error('No data from upload');

  return json.data;
}