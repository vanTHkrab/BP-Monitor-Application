/**
 * Email OTP goes to Better Auth's REST surface, not through GraphQL, so this
 * module carries its *own* copy of the transport contract — a second place the
 * `ApiError` shape can drift from `services/api.ts`.
 *
 * That is what these assert: a Better Auth `{ code, message }` body has to
 * arrive at `formatAuthError` as an `ApiError` carrying the same `code` and
 * `httpStatus` a GraphQL failure would, and the two network failures have to
 * get the same synthetic codes so `isNetworkError` recognises them.
 */
const mockGetApiBaseUrl = jest.fn();
jest.mock('@/services/endpoint', () => ({
  getApiBaseUrl: () => mockGetApiBaseUrl(),
}));

import { isNetworkError } from '@/services/api-error';

import { sendVerificationOtp, verifyEmailOtp } from './email-otp-api';

const BASE = 'https://gateway.example';

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response;

const textResponse = (status: number, body: string) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  }) as unknown as Response;

const mockFetch = jest.fn();

beforeEach(() => {
  mockGetApiBaseUrl.mockReturnValue(BASE);
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

const lastRequest = () => {
  const [url, init] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> };
};

describe('sendVerificationOtp', () => {
  it('posts to Better Auth’s unwrapped route, not the GraphQL endpoint', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { success: true }));

    await sendVerificationOtp('a@b.co');

    const { url, init } = lastRequest();
    // `/api/auth/*` is mounted outside the GraphQL errorFormatter — sending
    // this to /graphql would 404 with a body this module cannot read.
    expect(url).toBe(`${BASE}/api/auth/email-otp/send-verification-otp`);
    expect(init.method).toBe('POST');
  });

  it('names the OTP purpose, which Better Auth branches its templates on', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { success: true }));

    await sendVerificationOtp('a@b.co');

    expect(lastRequest().body).toEqual({ email: 'a@b.co', type: 'email-verification' });
  });

  it('declares JSON in both directions', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { success: true }));

    await sendVerificationOtp('a@b.co');

    expect(lastRequest().init.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  });
});

describe('verifyEmailOtp', () => {
  it('sends the address and the code the user typed', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { status: true }));

    await verifyEmailOtp('a@b.co', '123456');

    const { url, body } = lastRequest();
    expect(url).toBe(`${BASE}/api/auth/email-otp/verify-email`);
    expect(body).toEqual({ email: 'a@b.co', otp: '123456' });
  });

  it('does not resend the purpose on the verify call', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { status: true }));

    await verifyEmailOtp('a@b.co', '123456');

    // The route already implies it; an extra key here is a field Better Auth
    // does not declare.
    expect(lastRequest().body).not.toHaveProperty('type');
  });

  it('resolves on an empty 200 body rather than failing to parse it', async () => {
    mockFetch.mockResolvedValue(textResponse(200, ''));

    await expect(verifyEmailOtp('a@b.co', '123456')).resolves.toBeUndefined();
  });
});

describe('error translation', () => {
  it('carries Better Auth’s own code across as ApiError.code', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(400, { code: 'INVALID_OTP', message: 'รหัสไม่ถูกต้อง' }),
    );

    await expect(verifyEmailOtp('a@b.co', '000000')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INVALID_OTP',
      httpStatus: 400,
      // The server's message reaches the screen verbatim; a local guess would
      // be wrong exactly when the server knows better.
      message: 'รหัสไม่ถูกต้อง',
    });
  });

  it('keeps the 429 status the resend throttle branches on', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(429, { code: 'TOO_MANY_REQUESTS', message: 'ขอรหัสบ่อยเกินไป' }),
    );

    await expect(sendVerificationOtp('a@b.co')).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      httpStatus: 429,
    });
  });

  /*
   * Records a gap rather than a guarantee: unlike the GraphQL transport, this
   * path never reads `Retry-After`, so a throttled resend arrives with no
   * countdown and the UI can only say "try again later". Asserted so a fix
   * shows up here as a deliberate change. Flagged for `expo-dev`.
   */
  it('has no retry countdown to offer on a throttled resend', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(429, { code: 'TOO_MANY_REQUESTS', message: 'ขอรหัสบ่อยเกินไป' }),
    );

    await expect(sendVerificationOtp('a@b.co')).rejects.toMatchObject({ retryAfterSec: null });
  });

  it('falls back to a status-bearing message when the body names no reason', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, {}));

    await expect(sendVerificationOtp('a@b.co')).rejects.toMatchObject({
      code: null,
      httpStatus: 500,
      message: expect.stringContaining('500'),
    });
  });

  it('reports an HTML error page by its status instead of a parse error', async () => {
    mockFetch.mockResolvedValue(textResponse(502, '<html><body>Bad Gateway</body></html>'));

    await expect(sendVerificationOtp('a@b.co')).rejects.toMatchObject({
      httpStatus: 502,
      // "Unexpected token <" tells nobody which proxy answered.
      message: expect.stringContaining('502'),
    });
  });
});

describe('network failures', () => {
  it('maps an unreachable gateway to NETWORK_FAILED', async () => {
    mockFetch.mockRejectedValue(new Error('Network request failed'));

    const error = await sendVerificationOtp('a@b.co').catch((e: unknown) => e);

    expect(error).toMatchObject({ name: 'ApiError', code: 'NETWORK_FAILED' });
    // The synthetic codes exist so a screen can offer "retry" for these and
    // not for a 400.
    expect(isNetworkError(error)).toBe(true);
  });

  it('maps an aborted request to NETWORK_TIMEOUT', async () => {
    const aborted = new Error('Aborted');
    aborted.name = 'AbortError';
    mockFetch.mockRejectedValue(aborted);

    const error = await sendVerificationOtp('a@b.co').catch((e: unknown) => e);

    expect(error).toMatchObject({ name: 'ApiError', code: 'NETWORK_TIMEOUT' });
    expect(isNetworkError(error)).toBe(true);
  });

  it('wraps an unrecognised transport failure rather than leaking it raw', async () => {
    mockFetch.mockRejectedValue(new Error('something odd'));

    await expect(sendVerificationOtp('a@b.co')).rejects.toMatchObject({
      name: 'ApiError',
      // No synthetic code: this is not known to be retryable.
      code: null,
      message: expect.stringContaining('something odd'),
    });
  });

  it('does not leave the timeout timer booked after a request settles', async () => {
    jest.useFakeTimers();
    mockFetch.mockResolvedValue(jsonResponse(200, { success: true }));

    await sendVerificationOtp('a@b.co');

    // A 30s abort timer surviving the call fires inside whichever suite runs
    // next, with a stack that points here.
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});
