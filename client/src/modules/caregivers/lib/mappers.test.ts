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
 * in docs/todo/CLIENT-caregiver.md.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

import { patientSummaryFromGql, type PatientSummaryPayload } from './mappers';

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
