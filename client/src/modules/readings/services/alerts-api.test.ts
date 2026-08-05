/**
 * The wire half of the bell fix.
 *
 * `useSubject` decides *whose* alerts to ask for; this is whether that answer
 * survives onto the request. Both halves have to hold — resolving the subject
 * correctly and then dropping it on the floor looks identical to the bug.
 */
const mockRequest = jest.fn();
jest.mock('@/services/api', () => ({
  graphqlRequest: (...args: unknown[]) => mockRequest(...args),
}));

import { fetchAlerts } from './alerts-api';

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ alerts: [] });
});

const variablesOfLastCall = () => mockRequest.mock.calls.at(-1)?.[1] as Record<string, unknown>;

const alertPayload = (over: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 'me',
  bpReadingId: 7,
  alertMessage: 'ค่าความดันสูง',
  alertLevel: 'warning',
  readAt: null,
  createdAt: '2026-08-05T08:00:00.000Z',
  reading: {
    id: 7,
    userId: 'me',
    systolic: 180,
    diastolic: 110,
    pulse: 88,
    status: 'high',
    measuredAt: '2026-08-05T07:59:00.000Z',
    s3Key: null,
  },
  ...over,
});

describe('alerts about someone else', () => {
  /*
   * The gateway fans an abnormal reading out to the patient's caregivers, so
   * one caregiver's bell now holds both kinds. The recipient is
   * `alert.userId`; who it is *about* is `reading.userId`.
   */
  it('marks a fanned-out alert as being about someone else', async () => {
    mockRequest.mockResolvedValue({
      alerts: [
        alertPayload({
          userId: 'caregiver-1',
          reading: { ...alertPayload().reading, userId: 'patient-1' },
        }),
      ],
    });

    const [alert] = await fetchAlerts();

    expect(alert.isAboutSomeoneElse).toBe(true);
  });

  it('leaves your own alert unmarked', async () => {
    mockRequest.mockResolvedValue({ alerts: [alertPayload()] });

    const [alert] = await fetchAlerts();

    expect(alert.isAboutSomeoneElse).toBe(false);
  });

  // The reading can be deleted after the alert was raised. Labelling the row
  // as being about somebody it can no longer name is worse than not labelling
  // it at all.
  it('does not guess when the reading is gone', async () => {
    mockRequest.mockResolvedValue({
      alerts: [alertPayload({ userId: 'caregiver-1', reading: null })],
    });

    const [alert] = await fetchAlerts();

    expect(alert.isAboutSomeoneElse).toBe(false);
  });
});

describe('fetchAlerts', () => {
  it('asks for the patient when a caregiver is viewing one', async () => {
    await fetchAlerts('p1');

    expect(variablesOfLastCall().patientId).toBe('p1');
  });

  /*
   * Null, not the caller's own id. The gateway reads a present `patientId` as
   * "on behalf of" and runs `assertCanActOnBehalfOf` for it — pointless work
   * to ask about yourself, and it would make every ordinary request take the
   * caregiver code path.
   */
  it('sends null rather than your own id when acting as yourself', async () => {
    await fetchAlerts();

    expect(variablesOfLastCall().patientId).toBeNull();
  });

  it('sends the query with a patientId variable at all', async () => {
    await fetchAlerts('p1');

    // The operation is a template string; a query that never declared the
    // variable would still "pass" the assertion above while the server
    // ignored it.
    expect(mockRequest.mock.calls.at(-1)?.[0]).toContain('$patientId: ID');
  });
});
