/**
 * Permission parsing.
 *
 * Worth its own test because the fallback is a security-shaped decision: an
 * unrecognised value must not become `view` (locking a legitimate caregiver
 * out) nor be trusted blindly. It falls to `full`, matching the column
 * default, and the gateway refuses the write regardless — the client gate is
 * a courtesy, never the enforcement.
 *
 * AsyncStorage is mocked because `mappers.ts` now reaches `@/modules/readings`
 * for the BP-status parser, and that barrel pulls the auth module behind it.
 * A pure mapper needing a native-module mock is a smell — see the barrel note
 * in docs/project/CLIENT-caregiver.md.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

import {
  caregiverLinkFromGql,
  patientSummaryFromGql,
  type CaregiverLinkPayload,
  type PatientSummaryPayload,
} from './mappers';

const payload = (over: Partial<PatientSummaryPayload> = {}): PatientSummaryPayload => ({
  id: 'p1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  avatar: null,
  dob: null,
  relationship: 'child',
  permission: 'full',
  weight: null,
  height: null,
  gender: null,
  congenitalDisease: null,
  ...over,
});

describe('patientSummaryFromGql — permission', () => {
  it('carries a view-only link through', () => {
    expect(patientSummaryFromGql(payload({ permission: 'view' })).permission).toBe('view');
  });

  it('carries a full link through', () => {
    expect(patientSummaryFromGql(payload({ permission: 'full' })).permission).toBe('full');
  });

  // A gateway that predates the column omits the field. Defaulting to `view`
  // would lock every caregiver out of recording against an older server.
  it.each([
    ['an omitted field', undefined],
    ['an explicit null', null],
    ['an unrecognised value', 'superuser'],
  ])('defaults to full for %s', (_label, permission) => {
    expect(
      patientSummaryFromGql(payload({ permission: permission as string | null })).permission,
    ).toBe('full');
  });
});

/**
 * The link carries the permission too, so the *patient* — who granted it and
 * could previously not see it anywhere — can read and change their own
 * decision. Same fallback and the same reason as the summary above.
 */
describe('caregiverLinkFromGql — permission', () => {
  const linkPayload = (over: Partial<CaregiverLinkPayload> = {}): CaregiverLinkPayload => ({
    caregiverId: 'c1',
    patientId: 'p1',
    relationship: 'child',
    caregiverName: 'สมหญิง ใจงาม',
    caregiverPhone: '0898765432',
    patientName: 'สมชาย ใจดี',
    patientPhone: '0812345678',
    status: 'accepted',
    respondedAt: null,
    permission: 'full',
    ...over,
  });

  it('carries view through', () => {
    expect(caregiverLinkFromGql(linkPayload({ permission: 'view' })).permission).toBe('view');
  });

  it('carries full through', () => {
    expect(caregiverLinkFromGql(linkPayload({ permission: 'full' })).permission).toBe('full');
  });

  // A gateway from before the field existed must not make every link look
  // read-only — that would hide the record button from caregivers who have
  // it, and the server is what actually enforces the grant.
  it('falls back to full when the field is missing', () => {
    expect(caregiverLinkFromGql(linkPayload({ permission: undefined })).permission).toBe('full');
    expect(caregiverLinkFromGql(linkPayload({ permission: null })).permission).toBe('full');
  });

  it('falls back to full on a value it does not recognise', () => {
    expect(caregiverLinkFromGql(linkPayload({ permission: 'admin' })).permission).toBe('full');
  });
});
