/**
 * @jest-environment node
 */
import { ApiError } from './api-error';

// The transport reads the endpoint and the token at call time. Both are
// mocked rather than stubbed through the real modules: endpoint.ts throws
// without EXPO_PUBLIC_API_URL, and auth-token.ts reaches for SecureStore.
jest.mock('./endpoint', () => ({
  getGraphqlEndpoint: () => 'http://gateway.test/graphql',
  getApiBaseUrl: () => 'http://gateway.test',
}));

const mockGetAuthToken = jest.fn<Promise<string | null>, []>();
jest.mock('./auth-token', () => ({
  getAuthToken: () => mockGetAuthToken(),
}));

const mockFireUnauthenticated = jest.fn();
jest.mock('./session', () => ({
  fireUnauthenticated: () => mockFireUnauthenticated(),
}));

import { graphqlRequest } from './api';

const QUERY = 'query Me { me { id } }';

function respondWith(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(init.headers);
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('graphqlRequest', () => {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthToken.mockResolvedValue('token-123');
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('returns the data payload', async () => {
    fetchMock.mockResolvedValue(respondWith({ data: { me: { id: 'u-1' } } }));

    await expect(graphqlRequest(QUERY)).resolves.toEqual({ me: { id: 'u-1' } });
  });

  it('sends the bearer token when one is stored', async () => {
    fetchMock.mockResolvedValue(respondWith({ data: { me: null } }));

    await graphqlRequest(QUERY);

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-123');
  });

  it('omits the Authorization header when no token is stored', async () => {
    mockGetAuthToken.mockResolvedValue(null);
    fetchMock.mockResolvedValue(respondWith({ data: { me: null } }));

    await graphqlRequest(QUERY);

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  describe('auth failure fan-out', () => {
    it('fires on UNAUTHENTICATED when a token was sent', async () => {
      fetchMock.mockResolvedValue(
        respondWith({
          errors: [{ message: 'nope', extensions: { code: 'UNAUTHENTICATED' } }],
        }),
      );

      await expect(graphqlRequest(QUERY)).rejects.toThrow(ApiError);
      expect(mockFireUnauthenticated).toHaveBeenCalledTimes(1);
    });

    it('fires on HTTP 401 when a token was sent', async () => {
      fetchMock.mockResolvedValue(respondWith({ errors: [{ message: 'nope' }] }, { status: 401 }));

      await expect(graphqlRequest(QUERY)).rejects.toThrow(ApiError);
      expect(mockFireUnauthenticated).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire when no token was sent', async () => {
      // Login and register are anonymous: a 401 there means "wrong
      // credentials", and logging out a user who is not logged in would
      // race the login screen's own error handling.
      mockGetAuthToken.mockResolvedValue(null);
      fetchMock.mockResolvedValue(
        respondWith(
          { errors: [{ message: 'bad credentials', extensions: { code: 'UNAUTHENTICATED' } }] },
          { status: 401 },
        ),
      );

      await expect(graphqlRequest(QUERY)).rejects.toThrow(ApiError);
      expect(mockFireUnauthenticated).not.toHaveBeenCalled();
    });

    it('does not fire for unrelated error codes', async () => {
      fetchMock.mockResolvedValue(
        respondWith({ errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] }),
      );

      await expect(graphqlRequest(QUERY)).rejects.toThrow(ApiError);
      expect(mockFireUnauthenticated).not.toHaveBeenCalled();
    });
  });

  describe('error shape', () => {
    it('exposes extensions.code and the http status', async () => {
      fetchMock.mockResolvedValue(
        respondWith(
          { errors: [{ message: 'invalid', extensions: { code: 'BAD_USER_INPUT' } }] },
          { status: 400 },
        ),
      );

      await expect(graphqlRequest(QUERY)).rejects.toMatchObject({
        code: 'BAD_USER_INPUT',
        httpStatus: 400,
      });
    });

    it('prefers the Retry-After header for the throttle countdown', async () => {
      fetchMock.mockResolvedValue(
        respondWith(
          { errors: [{ message: 'slow down', extensions: { retryAfterSec: 99 } }] },
          { status: 429, headers: { 'Retry-After': '42' } },
        ),
      );

      await expect(graphqlRequest(QUERY)).rejects.toMatchObject({ retryAfterSec: 42 });
    });

    it('falls back to extensions.retryAfterSec when the header is absent', async () => {
      fetchMock.mockResolvedValue(
        respondWith(
          { errors: [{ message: 'slow down', extensions: { retryAfterSec: 99 } }] },
          { status: 429 },
        ),
      );

      await expect(graphqlRequest(QUERY)).rejects.toMatchObject({ retryAfterSec: 99 });
    });

    it('reports a non-JSON response with its status instead of a parse error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
        headers: new Headers(),
        text: async () => '<html>Bad Gateway</html>',
      } as unknown as Response);

      await expect(graphqlRequest(QUERY)).rejects.toMatchObject({ httpStatus: 502 });
      await expect(graphqlRequest(QUERY)).rejects.toThrow(/invalid JSON response/);
    });

    it('maps an unreachable server to NETWORK_FAILED', async () => {
      fetchMock.mockRejectedValue(new Error('Network request failed'));

      await expect(graphqlRequest(QUERY)).rejects.toMatchObject({ code: 'NETWORK_FAILED' });
    });

    it('maps an aborted request to NETWORK_TIMEOUT', async () => {
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      fetchMock.mockRejectedValue(abort);

      await expect(graphqlRequest(QUERY)).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
    });

    it('names the operation in the message so logs are attributable', async () => {
      fetchMock.mockResolvedValue(respondWith({ errors: [{ message: 'boom' }] }, { status: 500 }));

      await expect(graphqlRequest(QUERY)).rejects.toThrow(/^Me failed:/);
    });
  });
});
