/**
 * The readings wire contract.
 *
 * Two properties here are load-bearing beyond "the call happened":
 *
 *   - `fetchReadings` must ask for one page that is the whole history.
 *     `lib/sync.ts` prunes mirrored rows this fetch did not return, so a
 *     smaller page silently deletes the patient's older readings from the
 *     local mirror.
 *   - `patientId` must be `null`, not the caller's own id, when acting as
 *     yourself — a present value puts every ordinary request down the
 *     gateway's caregiver authorisation path.
 */
const mockRequest = jest.fn();
jest.mock('@/services/api', () => ({
  graphqlRequest: (...args: unknown[]) => mockRequest(...args),
}));

import { ApiError } from '@/services/api-error';

import { GQL_CREATE_READING, GQL_DELETE_READING, GQL_READINGS } from './operations';
import {
  createReading,
  deleteReading,
  fetchReadings,
  READINGS_PAGE_SIZE,
  type CreateReadingPayload,
} from './readings-api';

const readingPayload = (over: Record<string, unknown> = {}) => ({
  id: 7,
  userId: 'u1',
  clientId: 'c-7',
  systolic: 120,
  diastolic: 80,
  pulse: 70,
  status: 'normal',
  measuredAt: '2026-08-05T07:00:00.000Z',
  s3Key: null,
  notes: null,
  createdAt: '2026-08-05T07:00:01.000Z',
  recordedBy: null,
  ...over,
});

const lastQuery = () => mockRequest.mock.calls.at(-1)?.[0] as string;
const lastVariables = () => mockRequest.mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  mockRequest.mockReset();
});

describe('fetchReadings', () => {
  beforeEach(() => {
    mockRequest.mockResolvedValue({ readings: [] });
  });

  it('asks for the whole history in one page, because the prune assumes it', async () => {
    await fetchReadings();

    expect(lastQuery()).toBe(GQL_READINGS);
    expect(lastVariables()).toEqual({
      limit: READINGS_PAGE_SIZE,
      offset: 0,
      patientId: null,
    });
  });

  it('asks for the patient when a caregiver is viewing one', async () => {
    await fetchReadings('p1');

    expect(lastVariables().patientId).toBe('p1');
  });

  it('maps a row into the domain shape rather than returning the payload', async () => {
    mockRequest.mockResolvedValue({
      readings: [
        readingPayload({
          notes: 'หลังอาหาร',
          recordedBy: { id: 'cg1', firstname: 'สมหญิง', lastname: 'ดูแลดี' },
        }),
      ],
    });

    const [reading] = await fetchReadings();

    expect(reading.remoteId).toBe(7);
    expect(reading.measuredAt).toBeInstanceOf(Date);
    expect(reading.syncState).toBe('synced');
    // Two name fields on the wire, one in the domain. A mapper that dropped
    // the join would blank "recorded by" on every caregiver-entered reading.
    expect(reading.recordedById).toBe('cg1');
    expect(reading.recordedByName).toBe('สมหญิง ดูแลดี');
    expect(reading.notes).toBe('หลังอาหาร');
  });

  it('keys a synced row by its clientId so the card does not remount on promotion', async () => {
    mockRequest.mockResolvedValue({ readings: [readingPayload()] });

    const [reading] = await fetchReadings();

    expect(reading.key).toBe('client:c-7');
  });

  it('falls back to the remote id for a row this device never queued', async () => {
    mockRequest.mockResolvedValue({ readings: [readingPayload({ clientId: null })] });

    const [reading] = await fetchReadings();

    expect(reading.key).toBe('remote:7');
    expect(reading.clientId).toBeUndefined();
  });

  it('leaves recordedByName absent when the gateway sends no recorder', async () => {
    mockRequest.mockResolvedValue({ readings: [readingPayload({ recordedBy: null })] });

    const [reading] = await fetchReadings();

    expect(reading.recordedById).toBeUndefined();
    expect(reading.recordedByName).toBeUndefined();
  });
});

describe('createReading', () => {
  const input: CreateReadingPayload = {
    systolic: 145,
    diastolic: 95,
    pulse: 88,
    status: 'high',
    measuredAt: '2026-08-05T07:00:00.000Z',
    clientId: 'c-9',
  };

  it('sends the caller-built payload under one input, unaltered', async () => {
    mockRequest.mockResolvedValue({ createReading: readingPayload({ id: 9, clientId: 'c-9' }) });

    await createReading(input);

    expect(lastQuery()).toBe(GQL_CREATE_READING);
    // `toEqual` on the whole object, not a field check: the duplicate guard
    // keys on `clientId`, so a dropped or renamed key turns every retry of the
    // offline drain into a second reading in the patient's history.
    expect(lastVariables()).toEqual({ input });
  });

  it('carries imageId through so the drain does not re-upload the same photo', async () => {
    mockRequest.mockResolvedValue({ createReading: readingPayload() });

    await createReading({ ...input, imageId: 42 });

    expect((lastVariables().input as Record<string, unknown>).imageId).toBe(42);
  });

  it('returns the server row as a synced domain reading', async () => {
    mockRequest.mockResolvedValue({
      createReading: readingPayload({ id: 9, clientId: 'c-9', status: 'high' }),
    });

    const reading = await createReading(input);

    expect(reading.remoteId).toBe(9);
    expect(reading.status).toBe('high');
    expect(reading.syncState).toBe('synced');
  });

  /*
   * The gateway's duplicate guard answers CONFLICT when the same `clientId`
   * arrives twice. The drain branches on that code to treat the row as already
   * synced instead of retrying forever, so it must not be flattened here.
   */
  it('lets a duplicate-clientId conflict through with its code', async () => {
    mockRequest.mockRejectedValue(
      new ApiError('CreateReading failed: [CONFLICT] duplicate', {
        code: 'CONFLICT',
        httpStatus: 409,
      }),
    );

    await expect(createReading(input)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'CONFLICT',
      httpStatus: 409,
    });
  });
});

describe('deleteReading', () => {
  it('sends the id and resolves to the server’s answer', async () => {
    mockRequest.mockResolvedValue({ deleteReading: true });

    await expect(deleteReading(7)).resolves.toBe(true);
    expect(lastQuery()).toBe(GQL_DELETE_READING);
    expect(lastVariables()).toEqual({ id: 7 });
  });

  it('reports a refusal as false rather than as success', async () => {
    mockRequest.mockResolvedValue({ deleteReading: false });

    await expect(deleteReading(7)).resolves.toBe(false);
  });
});
