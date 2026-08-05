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
