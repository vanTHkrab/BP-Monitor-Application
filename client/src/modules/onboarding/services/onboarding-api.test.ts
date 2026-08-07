/**
 * The role-selection call. Small, and the one thing that can go wrong is
 * silent: the onboarding gate reads `roleSelectedAt`, not `role`, so a mapper
 * that dropped the timestamp would send a user who has already chosen back
 * through onboarding on every launch.
 */
const mockRequest = jest.fn();
jest.mock('@/services/api', () => ({
  graphqlRequest: (...args: unknown[]) => mockRequest(...args),
}));

import { GQL_SELECT_ROLE } from './operations';
import { selectRole } from './onboarding-api';

const userPayload = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  email: null,
  emailVerified: false,
  avatar: null,
  role: 'caregiver',
  roleSelectedAt: '2026-08-05T09:00:00.000Z',
  createdAt: '2026-01-02T03:04:05.000Z',
  dob: null,
  gender: null,
  weight: null,
  height: null,
  congenitalDisease: null,
  ...over,
});

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ selectRole: userPayload() });
});

describe('selectRole', () => {
  it('sends the chosen role wrapped in the input object the schema declares', async () => {
    await selectRole('caregiver');

    expect(mockRequest.mock.calls.at(-1)?.[0]).toBe(GQL_SELECT_ROLE);
    expect(mockRequest.mock.calls.at(-1)?.[1]).toEqual({ input: { role: 'caregiver' } });
  });

  it('returns the mapped user carrying the timestamp the gate reads', async () => {
    const user = await selectRole('caregiver');

    expect(user.role).toBe('caregiver');
    // Not `role`: `role` defaults to `patient` server-side, so it cannot tell
    // "chose patient" from "never chose".
    expect(user.roleSelectedAt).toBeInstanceOf(Date);
  });

  it('leaves roleSelectedAt absent when the gateway sends none', async () => {
    mockRequest.mockResolvedValue({ selectRole: userPayload({ roleSelectedAt: null }) });

    const user = await selectRole('patient');

    expect(user.roleSelectedAt).toBeUndefined();
  });
});
