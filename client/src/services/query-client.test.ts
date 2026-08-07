/**
 * @jest-environment node
 *
 * The retry policy is the whole content of this file, and it is a policy
 * decision rather than a default: retrying a FORBIDDEN wastes a round trip,
 * retrying a 429 makes the throttle worse, and retrying a mutation can create
 * a duplicate reading. None of that is visible from a render test.
 */
import { cache, network } from '@/config';
import { ApiError } from './api-error';
import { createQueryClient, isThrottled } from './query-client';

type RetryFn = (failureCount: number, error: unknown) => boolean;

function queryRetry(): RetryFn {
  const retry = createQueryClient().getDefaultOptions().queries?.retry;
  // Guards the shape as well as the behaviour: a bare `true`/number here would
  // silently retry everything, and every assertion below would still pass.
  expect(typeof retry).toBe('function');
  return retry as RetryFn;
}

const networkError = () => new ApiError('offline', { code: 'NETWORK_FAILED' });
const timeoutError = () => new ApiError('slow', { code: 'NETWORK_TIMEOUT' });

describe('query defaults', () => {
  it('uses the shared stale time rather than a local number', () => {
    expect(createQueryClient().getDefaultOptions().queries?.staleTime).toBe(cache.staleTimeMs);
  });

  it('never retries a mutation', () => {
    // Mutations are not idempotent here — durable retry belongs to the SQLite
    // queue, which dedupes on clientId.
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });
});

describe('query retry policy', () => {
  it.each([networkError(), timeoutError()])('retries a transport failure (%s)', (error) => {
    expect(queryRetry()(0, error)).toBe(true);
  });

  it('stops at the configured ceiling', () => {
    const retry = queryRetry();

    expect(retry(network.maxRetries - 1, networkError())).toBe(true);
    expect(retry(network.maxRetries, networkError())).toBe(false);
    expect(retry(network.maxRetries + 1, networkError())).toBe(false);
  });

  it.each([
    ['FORBIDDEN', 403],
    ['BAD_USER_INPUT', 400],
    ['UNAUTHENTICATED', 401],
    ['CONFLICT', 409],
  ])('never retries %s — it fails identically every time', (code, httpStatus) => {
    expect(queryRetry()(0, new ApiError('no', { code, httpStatus }))).toBe(false);
  });

  it('never retries a 429, which would make the throttle worse', () => {
    expect(queryRetry()(0, new ApiError('slow down', { httpStatus: 429 }))).toBe(false);
  });

  it.each([
    ['a plain Error', new Error('boom')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
  ])('does not retry %s', (_label, error) => {
    expect(queryRetry()(0, error)).toBe(false);
  });
});

describe('isThrottled', () => {
  it('is true only for the gateway login throttle', () => {
    expect(isThrottled(new ApiError('slow down', { httpStatus: 429 }))).toBe(true);
  });

  it.each([400, 401, 403, 500, 503])('is false for %s', (httpStatus) => {
    expect(isThrottled(new ApiError('no', { httpStatus }))).toBe(false);
  });

  it.each([
    ['a plain Error', new Error('boom')],
    ['null', null],
    ['a bare object with the right status', { httpStatus: 429 }],
  ])('is false for %s', (_label, error) => {
    // The last case is the interesting one: `isApiError` checks `name`, so a
    // duck-typed object must not be mistaken for a throttle response.
    expect(isThrottled(error)).toBe(false);
  });
});
