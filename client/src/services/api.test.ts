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

import { graphqlRequest, graphqlUpload, type UploadFile } from './api';

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

    it('falls back to AnonymousOperation for an unnamed document', async () => {
      fetchMock.mockResolvedValue(respondWith({ errors: [{ message: 'boom' }] }, { status: 500 }));

      await expect(graphqlRequest('{ me { id } }')).rejects.toThrow(/^AnonymousOperation failed:/);
    });

    it('names the mutation, not just queries', async () => {
      fetchMock.mockResolvedValue(respondWith({ errors: [{ message: 'boom' }] }, { status: 500 }));

      await expect(
        graphqlRequest('mutation CreateReading($i: X!) { createReading(input: $i) { id } }'),
      ).rejects.toThrow(/^CreateReading failed:/);
    });

    it('rejects a 200 with neither data nor errors', async () => {
      // A proxy that rewrites the body, or a resolver returning null at the
      // root. Without this branch the caller destructures `undefined`.
      fetchMock.mockResolvedValue(respondWith({}));

      await expect(graphqlRequest(QUERY)).rejects.toThrow(/no data returned from server/);
    });

    it('ignores a non-numeric Retry-After and uses the extension instead', async () => {
      fetchMock.mockResolvedValue(
        respondWith(
          { errors: [{ message: 'slow down', extensions: { retryAfterSec: 99 } }] },
          { status: 429, headers: { 'Retry-After': 'Wed, 21 Oct 2015 07:28:00 GMT' } },
        ),
      );

      await expect(graphqlRequest(QUERY)).rejects.toMatchObject({ retryAfterSec: 99 });
    });

    it('reports null retryAfterSec when neither source says', async () => {
      fetchMock.mockResolvedValue(
        respondWith({ errors: [{ message: 'slow down' }] }, { status: 429 }),
      );

      await expect(graphqlRequest(QUERY)).rejects.toMatchObject({ retryAfterSec: null });
    });

    it('joins several server errors into one message, each tagged with its code', async () => {
      fetchMock.mockResolvedValue(
        respondWith(
          {
            errors: [
              { message: 'first', extensions: { code: 'BAD_USER_INPUT' } },
              { message: 'second' },
            ],
          },
          { status: 400 },
        ),
      );

      await expect(graphqlRequest(QUERY)).rejects.toThrow('Me failed: [BAD_USER_INPUT] first; second');
    });
  });

  it("aborts the request when the caller's own signal aborts", async () => {
    // The built-in timeout is not the only cancellation source: a screen that
    // unmounts mid-request passes its own signal, and the fetch must stop.
    const caller = new AbortController();
    let seen: AbortSignal | undefined;
    fetchMock.mockImplementation(async (_url, init) => {
      seen = init.signal as AbortSignal;
      return respondWith({ data: { me: null } });
    });

    await graphqlRequest(QUERY, undefined, { signal: caller.signal });

    expect(seen?.aborted).toBe(false);
    caller.abort();
    expect(seen?.aborted).toBe(true);
  });
});

/**
 * The multipart path. Its response handling is shared with `graphqlRequest`,
 * so what is asserted here is the part that is *not* shared: the multipart
 * body, and the fact that the file crosses as a `{ uri, name, type }`
 * descriptor rather than a `Blob` — `new Blob([Uint8Array])` type-checks and
 * throws on native, the same trap `upload-image.ts` exists to contain.
 */
describe('graphqlUpload', () => {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
  const appended: [string, unknown][] = [];
  const RealFormData = global.FormData;

  const MUTATION = 'mutation Analyze($file: Upload!) { analyzeBPImage(file: $file) { id } }';
  const FILE: UploadFile = { uri: 'file:///tmp/a.jpg', name: 'a.jpg', type: 'image/jpeg' };

  beforeAll(() => {
    // Node's own FormData stringifies a plain object on `append`, which would
    // erase exactly the thing worth asserting. This records instead.
    global.FormData = class {
      append(name: string, value: unknown) {
        appended.push([name, value]);
      }
    } as unknown as typeof FormData;
  });

  afterAll(() => {
    global.FormData = RealFormData;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    appended.length = 0;
    mockGetAuthToken.mockResolvedValue('token-123');
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue(respondWith({ data: { analyzeBPImage: { id: 5 } } }));
  });

  it('returns the data payload', async () => {
    await expect(graphqlUpload(MUTATION, { file: null }, FILE)).resolves.toEqual({
      analyzeBPImage: { id: 5 },
    });
  });

  it('builds the three parts the multipart spec requires, in order', async () => {
    await graphqlUpload(MUTATION, { file: null }, FILE);

    expect(appended).toEqual([
      ['operations', JSON.stringify({ query: MUTATION, variables: { file: null } })],
      ['map', JSON.stringify({ '0': ['variables.file'] })],
      ['0', FILE],
    ]);
  });

  it('sends the file as a uri descriptor, never as a Blob', async () => {
    // The regression guard: a `Blob` here type-checks and throws on device.
    await graphqlUpload(MUTATION, { file: null }, FILE);

    const filePart = appended.find(([name]) => name === '0')?.[1];
    expect(filePart).toBe(FILE);
    expect(filePart).not.toBeInstanceOf(Blob);
    expect(filePart).toEqual({ uri: 'file:///tmp/a.jpg', name: 'a.jpg', type: 'image/jpeg' });
  });

  it('leaves Content-Type unset so fetch can generate the boundary', async () => {
    // Setting it by hand produces a body fetch cannot delimit, and the gateway
    // rejects the whole upload with a parse error that names nothing useful.
    await graphqlUpload(MUTATION, { file: null }, FILE);

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers).toEqual({ Authorization: 'Bearer token-123' });
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('sends no headers at all when there is no token', async () => {
    mockGetAuthToken.mockResolvedValue(null);

    await graphqlUpload(MUTATION, { file: null }, FILE);

    expect(fetchMock.mock.calls[0][1].headers).toEqual({});
  });

  it('shares the 401 fan-out with the JSON transport', async () => {
    fetchMock.mockResolvedValue(
      respondWith({ errors: [{ message: 'nope', extensions: { code: 'UNAUTHENTICATED' } }] }),
    );

    await expect(graphqlUpload(MUTATION, { file: null }, FILE)).rejects.toThrow(ApiError);
    expect(mockFireUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('does not fan out a 401 on an anonymous upload', async () => {
    mockGetAuthToken.mockResolvedValue(null);
    fetchMock.mockResolvedValue(respondWith({ errors: [{ message: 'nope' }] }, { status: 401 }));

    await expect(graphqlUpload(MUTATION, { file: null }, FILE)).rejects.toThrow(ApiError);
    expect(mockFireUnauthenticated).not.toHaveBeenCalled();
  });

  it('maps an unreachable server to NETWORK_FAILED and names the operation', async () => {
    fetchMock.mockRejectedValue(new Error('Network request failed'));

    await expect(graphqlUpload(MUTATION, { file: null }, FILE)).rejects.toMatchObject({
      code: 'NETWORK_FAILED',
    });
    await expect(graphqlUpload(MUTATION, { file: null }, FILE)).rejects.toThrow(/^Analyze /);
  });

  it('maps an aborted upload to NETWORK_TIMEOUT', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    fetchMock.mockRejectedValue(abort);

    await expect(graphqlUpload(MUTATION, { file: null }, FILE)).rejects.toMatchObject({
      code: 'NETWORK_TIMEOUT',
    });
  });

  it("aborts the upload when the caller's signal aborts", async () => {
    const caller = new AbortController();
    let seen: AbortSignal | undefined;
    fetchMock.mockImplementation(async (_url, init) => {
      seen = init.signal as AbortSignal;
      return respondWith({ data: { analyzeBPImage: { id: 5 } } });
    });

    await graphqlUpload(MUTATION, { file: null }, FILE, { signal: caller.signal });

    caller.abort();
    expect(seen?.aborted).toBe(true);
  });
});
