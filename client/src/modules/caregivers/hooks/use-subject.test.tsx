/**
 * The subject is what stops two hooks disagreeing about whose data a screen
 * is showing — the bug this replaced put a patient's readings beside the
 * caregiver's own unread count. So the assertions are about agreement, not
 * about the shape of the return value.
 */
import { renderHook } from '@testing-library/react-native';

const mockSession = { current: { userId: 'me' as string | null } };
jest.mock('@/modules/auth', () => ({
  useSession: () => mockSession.current,
}));

import { useActivePatientStore } from './use-active-patient';
import { useSubject } from './use-subject';

const patient = {
  id: 'p1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  permission: 'full' as const,
};

beforeEach(() => {
  mockSession.current = { userId: 'me' };
  useActivePatientStore.setState({ patientId: null, patient: null });
});

describe('useSubject', () => {
  it('is the signed-in user when no patient is being viewed', async () => {
    const { result } = await renderHook(() => useSubject());

    expect(result.current.subjectId).toBe('me');
    expect(result.current.isSelf).toBe(true);
  });

  it('is the patient once one is being viewed', async () => {
    useActivePatientStore.setState({ patientId: 'p1', patient });

    const { result } = await renderHook(() => useSubject());

    expect(result.current.subjectId).toBe('p1');
    expect(result.current.isSelf).toBe(false);
    expect(result.current.patient).toMatchObject({ id: 'p1' });
  });

  /*
   * The gateway treats a present `patientId` as "acting on behalf of" and runs
   * the caregiver guard for it. Sending your own id would take that path to
   * ask a question about yourself.
   */
  it('sends no patientId argument when acting as yourself', async () => {
    const { result } = await renderHook(() => useSubject());

    expect(result.current.patientIdArg).toBeUndefined();
  });

  it('sends the patient id as the argument when viewing one', async () => {
    useActivePatientStore.setState({ patientId: 'p1', patient });

    const { result } = await renderHook(() => useSubject());

    expect(result.current.patientIdArg).toBe('p1');
  });

  // Guards the specific shape of the old bug: two callers, one answer. If a
  // future hook resolves the subject its own way, this is the test that was
  // supposed to stop it.
  it('gives every caller the same answer at the same moment', async () => {
    useActivePatientStore.setState({ patientId: 'p1', patient });

    const readingsSide = await renderHook(() => useSubject());
    const alertsSide = await renderHook(() => useSubject());

    expect(readingsSide.result.current.subjectId).toBe(
      alertsSide.result.current.subjectId,
    );
    expect(readingsSide.result.current.patientIdArg).toBe(
      alertsSide.result.current.patientIdArg,
    );
  });

  // No patient record loaded yet, or a patient account: never leaks someone
  // else's id as the subject.
  it('falls back to nothing rather than a stale id before the session lands', async () => {
    mockSession.current = { userId: null };

    const { result } = await renderHook(() => useSubject());

    expect(result.current.subjectId).toBe('');
    expect(result.current.isSelf).toBe(true);
  });
});
