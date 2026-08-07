/**
 * The invitations screen's three reads and the five things that change them.
 *
 * The whole module is thin — `useQuery` and `useMutation` wrappers — and
 * everything worth asserting sits in the two places a wrapper can be wrong
 * without a type noticing.
 *
 * **The invalidation set.** Four mutations refresh *both* lists because the
 * two describe the same relationships from different angles; the fifth,
 * `useUpdatePatientHealth`, refreshes only `my-patients` and its header
 * explains at length why the other two must be left alone. That is a negative
 * property — nothing on screen shows a refetch that should not have happened —
 * so the tests spell out the keys that must stay untouched, not only the ones
 * that must not.
 *
 * **Argument order.** `removeCaregiverLink(caregiverId, patientId)` takes two
 * plain strings, so swapping them is invisible to the type checker and removes
 * a link the user did not choose. `respondToInvite(caregiverId, accept,
 * permission)` decides who may read a medical history. Both are asserted
 * positionally, against distinguishable values.
 *
 * Mocked at `services/caregivers-api`, which is where the GraphQL documents
 * live; `caregivers-api.test.ts` owns whether those are shaped right. The
 * query client is per test with retries off, and `gcTime: Infinity` because
 * several tests seed an entry with `setQueryData` and read its
 * `isInvalidated` back with no observer attached to keep it alive.
 */
const mockApi = {
  fetchCaregiverLinks: jest.fn(),
  fetchMyPatients: jest.fn(),
  invitePatient: jest.fn(),
  respondToInvite: jest.fn(),
  updateCaregiverPermission: jest.fn(),
  removeCaregiverLink: jest.fn(),
  updatePatientHealth: jest.fn(),
  fetchMyProfileChangeLog: jest.fn(),
};
jest.mock('../services/caregivers-api', () => ({
  fetchCaregiverLinks: (...a: unknown[]) => mockApi.fetchCaregiverLinks(...a),
  fetchMyPatients: (...a: unknown[]) => mockApi.fetchMyPatients(...a),
  invitePatient: (...a: unknown[]) => mockApi.invitePatient(...a),
  respondToInvite: (...a: unknown[]) => mockApi.respondToInvite(...a),
  updateCaregiverPermission: (...a: unknown[]) => mockApi.updateCaregiverPermission(...a),
  removeCaregiverLink: (...a: unknown[]) => mockApi.removeCaregiverLink(...a),
  updatePatientHealth: (...a: unknown[]) => mockApi.updatePatientHealth(...a),
  fetchMyProfileChangeLog: (...a: unknown[]) => mockApi.fetchMyProfileChangeLog(...a),
}));

/**
 * Only `isAuthenticated` is read here, so the replacement is three lines
 * rather than the readings module's `__fixtures__/identity.ts`: that fixture
 * exists to model *whose* data is on screen (`useSubject`, `useActivePatient`),
 * and none of these hooks resolves a subject — the gateway derives it from
 * the session.
 */
const mockSession = { isAuthenticated: true };
jest.mock('@/modules/auth', () => ({
  useSession: () => ({
    status: mockSession.isAuthenticated ? 'authenticated' : 'unauthenticated',
    userId: mockSession.isAuthenticated ? 'c1' : null,
    isAuthenticated: mockSession.isAuthenticated,
    user: null,
    isLoadingUser: false,
  }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ApiError } from '@/services/api-error';

import type { CaregiverLink, PatientSummary, ProfileChangeLogEntry } from '../types';
import {
  useCaregiverLinks,
  useInvitePatient,
  useMyPatients,
  useProfileChangeLog,
  useRemoveCaregiverLink,
  useRespondToInvite,
  useUpdateCaregiverPermission,
  useUpdatePatientHealth,
} from './use-caregivers';

const CAREGIVER_ID = 'c1';
const PATIENT_ID = 'p9';

const link = (over: Partial<CaregiverLink> = {}): CaregiverLink => ({
  caregiverId: CAREGIVER_ID,
  patientId: PATIENT_ID,
  relationship: 'child',
  caregiverName: 'มานี รักดี',
  caregiverPhone: '0898765432',
  patientName: 'สมหญิง มีสุข',
  patientPhone: '0812345678',
  status: 'pending',
  permission: 'full',
  ...over,
});

const patient = (over: Partial<PatientSummary> = {}): PatientSummary => ({
  id: PATIENT_ID,
  firstname: 'สมหญิง',
  lastname: 'มีสุข',
  phone: '0812345678',
  permission: 'full',
  ...over,
});

const logEntry = (over: Partial<ProfileChangeLogEntry> = {}): ProfileChangeLogEntry => ({
  id: 'e1',
  actorName: 'มานี รักดี',
  byPatient: false,
  field: 'weight',
  oldValue: '60',
  newValue: '62',
  changedAt: new Date('2026-03-01T10:00:00.000Z'),
  ...over,
});

const LINKS_KEY = ['caregiver-links'];
const PATIENTS_KEY = ['my-patients'];
const CHANGE_LOG_KEY = ['profile-change-log', 50];

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const invalidated = (key: unknown[]) => client.getQueryState(key)?.isInvalidated;

/** Seeds the three keys a mutation could reach, so `isInvalidated` is readable. */
const seedCaches = () => {
  client.setQueryData(LINKS_KEY, [link()]);
  client.setQueryData(PATIENTS_KEY, [patient()]);
  client.setQueryData(CHANGE_LOG_KEY, [logEntry()]);
};

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` empties the call log but leaves implementations and any
  // `mockResolvedValueOnce` queue in place for the next test to consume.
  for (const fn of Object.values(mockApi)) fn.mockReset();

  mockApi.fetchCaregiverLinks.mockResolvedValue([]);
  mockApi.fetchMyPatients.mockResolvedValue([]);
  mockApi.fetchMyProfileChangeLog.mockResolvedValue([]);
  mockApi.invitePatient.mockResolvedValue(link());
  mockApi.respondToInvite.mockResolvedValue(link({ status: 'accepted' }));
  mockApi.updateCaregiverPermission.mockResolvedValue(link({ permission: 'view' }));
  mockApi.removeCaregiverLink.mockResolvedValue(true);
  mockApi.updatePatientHealth.mockResolvedValue({ patientId: PATIENT_ID, weight: 62 });

  mockSession.isAuthenticated = true;

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('useCaregiverLinks', () => {
  it('files the list under the key every mutation invalidates', async () => {
    mockApi.fetchCaregiverLinks.mockResolvedValue([link()]);

    const view = await renderHook(() => useCaregiverLinks(), { wrapper });
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));

    // A mismatch between this key and the mutations' leaves an accepted
    // invite rendering as "รอตอบรับ" until the user leaves and comes back.
    expect(client.getQueryData(LINKS_KEY)).toEqual([link()]);
    expect(view.result.current.links).toEqual([link()]);
  });

  it('gives the screen an empty array rather than undefined before the first load', async () => {
    // Held open rather than resolved, so "still loading" is true by
    // construction rather than by winning a race with the assertion.
    mockApi.fetchCaregiverLinks.mockImplementation(() => new Promise(() => {}));

    const view = await renderHook(() => useCaregiverLinks(), { wrapper });

    // `deriveSections` maps over this directly; `undefined` is a crash, not
    // a spinner.
    expect(view.result.current.links).toEqual([]);
    expect(view.result.current.isLoading).toBe(true);
  });

  it('asks for nothing while signed out', async () => {
    mockSession.isAuthenticated = false;

    const view = await renderHook(() => useCaregiverLinks(), { wrapper });
    await act(async () => {});

    // A request here would 401 and trip the global sign-out fan-out — see
    // the same `enabled` guard in `use-session.ts`.
    expect(mockApi.fetchCaregiverLinks).not.toHaveBeenCalled();
    expect(view.result.current.links).toEqual([]);
  });

  it('surfaces the transport error unwrapped', async () => {
    const cause = new ApiError('[FORBIDDEN] no', { code: 'FORBIDDEN', httpStatus: 403 });
    mockApi.fetchCaregiverLinks.mockRejectedValue(cause);

    const view = await renderHook(() => useCaregiverLinks(), { wrapper });

    await waitFor(() => expect(view.result.current.error).toBe(cause));
  });
});

describe('useMyPatients', () => {
  it('files the list under its own key, separate from the links', async () => {
    mockApi.fetchMyPatients.mockResolvedValue([patient()]);

    const view = await renderHook(() => useMyPatients(), { wrapper });
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));

    expect(client.getQueryData(PATIENTS_KEY)).toEqual([patient()]);
    // The two lists describe the same relationship and must never share a
    // key: `PatientSummary` carries the `id` and `avatar` the symmetric link
    // row lacks, so one overwriting the other loses fields silently.
    expect(client.getQueryData(LINKS_KEY)).toBeUndefined();
  });

  it('asks for nothing when the caller opts out, even while signed in', async () => {
    const view = await renderHook(() => useMyPatients({ enabled: false }), { wrapper });
    await act(async () => {});

    // The patient side of the app passes `false`. The gateway would answer
    // with an empty list, so this costs no correctness — it saves a round
    // trip on every focus for an answer with no reader.
    expect(mockApi.fetchMyPatients).not.toHaveBeenCalled();
    expect(view.result.current.patients).toEqual([]);
  });

  it('asks for nothing while signed out, whatever the caller passed', async () => {
    mockSession.isAuthenticated = false;

    await renderHook(() => useMyPatients({ enabled: true }), { wrapper });
    await act(async () => {});

    // `enabled: isAuthenticated && enabled` — the session is the outer guard
    // and an explicit `true` must not be able to override it.
    expect(mockApi.fetchMyPatients).not.toHaveBeenCalled();
  });

  it('fetches by default when called with no argument at all', async () => {
    await renderHook(() => useMyPatients(), { wrapper });

    await waitFor(() => expect(mockApi.fetchMyPatients).toHaveBeenCalledTimes(1));
  });
});

describe('useProfileChangeLog', () => {
  it('puts the limit in the key so two depths cannot share one cached list', async () => {
    mockApi.fetchMyProfileChangeLog.mockResolvedValue([logEntry()]);

    const view = await renderHook(() => useProfileChangeLog({ limit: 5 }), { wrapper });
    await waitFor(() => expect(view.result.current.entries).toHaveLength(1));

    expect(client.getQueryData(['profile-change-log', 5])).toEqual([logEntry()]);
    // Nothing lands under the default depth. A bare `['profile-change-log']`
    // would serve a 5-row preview into a screen that asked for 50.
    expect(client.getQueryData(CHANGE_LOG_KEY)).toBeUndefined();
    expect(mockApi.fetchMyProfileChangeLog).toHaveBeenCalledWith(5);
  });

  it('defaults to 50 and sends that number, not undefined', async () => {
    await renderHook(() => useProfileChangeLog(), { wrapper });

    // The gateway clamps to 1-200 either way, but `undefined` on the wire is
    // a GraphQL variable the schema declares non-null.
    await waitFor(() => expect(mockApi.fetchMyProfileChangeLog).toHaveBeenCalledWith(50));
  });

  it('asks for nothing while signed out', async () => {
    mockSession.isAuthenticated = false;

    await renderHook(() => useProfileChangeLog(), { wrapper });
    await act(async () => {});

    expect(mockApi.fetchMyProfileChangeLog).not.toHaveBeenCalled();
  });
});

describe('useInvitePatient', () => {
  it('forwards the input object unchanged', async () => {
    const input = { patientContact: 'somying@example.com', relationship: 'child' } as const;

    const view = await renderHook(() => useInvitePatient(), { wrapper });
    await act(async () => {
      await view.result.current.invitePatient(input);
    });

    // `patientContact` is sent as typed — `lib/contact.ts` decides in the API
    // layer whether it is a phone or an email, and normalising it here would
    // make that decision twice from two different places.
    expect(mockApi.invitePatient).toHaveBeenCalledWith(input);
  });

  it('refreshes both lists and leaves the audit trail alone', async () => {
    seedCaches();

    const view = await renderHook(() => useInvitePatient(), { wrapper });
    await act(async () => {
      await view.result.current.invitePatient({
        patientContact: '0812345678',
        relationship: 'child',
      });
    });

    expect(invalidated(LINKS_KEY)).toBe(true);
    expect(invalidated(PATIENTS_KEY)).toBe(true);
    // The trail is the *patient's* and a caregiver mutation cannot change
    // it — refreshing it here fetches the actor's own unrelated history.
    expect(invalidated(CHANGE_LOG_KEY)).toBe(false);
  });

  it('invalidates nothing when the gateway refuses', async () => {
    seedCaches();
    mockApi.invitePatient.mockRejectedValue(
      new ApiError('[NOT_FOUND] ไม่พบผู้ใช้', { code: 'NOT_FOUND' }),
    );

    const view = await renderHook(() => useInvitePatient(), { wrapper });
    await act(async () => {
      await view.result.current
        .invitePatient({ patientContact: '0800000000', relationship: 'child' })
        .catch(() => {});
    });

    expect(invalidated(LINKS_KEY)).toBe(false);
    expect(invalidated(PATIENTS_KEY)).toBe(false);
  });
});

describe('useRespondToInvite', () => {
  it('sends the id, the answer, and the grant in that order', async () => {
    const view = await renderHook(() => useRespondToInvite(), { wrapper });
    await act(async () => {
      await view.result.current.respondToInvite({
        caregiverId: CAREGIVER_ID,
        accept: true,
        permission: 'view',
      });
    });

    // Positional, and this is the call that decides who may read a medical
    // history: the object the hook takes and the argument list the API takes
    // are different shapes, so nothing but this assertion connects them.
    expect(mockApi.respondToInvite).toHaveBeenCalledWith(CAREGIVER_ID, true, 'view');
  });

  it('sends the permission even for a refusal, and does not invent one', async () => {
    const view = await renderHook(() => useRespondToInvite(), { wrapper });
    await act(async () => {
      await view.result.current.respondToInvite({
        caregiverId: CAREGIVER_ID,
        accept: false,
        permission: 'full',
      });
    });

    // The gateway ignores it when `accept` is false. Passing it through
    // rather than nulling it keeps this hook free of a rule the gateway
    // already enforces — a second copy of which could disagree.
    expect(mockApi.respondToInvite).toHaveBeenCalledWith(CAREGIVER_ID, false, 'full');
  });

  it('names the invite in flight so one row can spin alone, and nothing after', async () => {
    let release: (value: CaregiverLink) => void = () => {};
    mockApi.respondToInvite.mockImplementationOnce(
      () =>
        new Promise<CaregiverLink>((resolve) => {
          release = resolve;
        }),
    );

    const view = await renderHook(() => useRespondToInvite(), { wrapper });
    expect(view.result.current.pendingCaregiverId).toBeNull();

    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = view.result.current.respondToInvite({
        caregiverId: CAREGIVER_ID,
        accept: true,
        permission: 'full',
      });
    });

    // Read while the request is open. The screen renders a spinner on the
    // row whose id this is; a plain `isPending` would spin every row.
    // `waitFor`, because TanStack notifies observers through its own batching
    // timer — `result.current` is the last *committed* render, and the
    // transition into pending has not reached it yet.
    await waitFor(() => expect(view.result.current.pendingCaregiverId).toBe(CAREGIVER_ID));

    await act(async () => {
      release(link({ status: 'accepted' }));
      await pending;
    });

    await waitFor(() => expect(view.result.current.pendingCaregiverId).toBeNull());
  });

  it('refreshes both lists on success', async () => {
    seedCaches();

    const view = await renderHook(() => useRespondToInvite(), { wrapper });
    await act(async () => {
      await view.result.current.respondToInvite({
        caregiverId: CAREGIVER_ID,
        accept: true,
        permission: 'full',
      });
    });

    // Accepting moves a row out of "รอตอบรับ" and into the caregiver's
    // patient list — refreshing one without the other shows a state that no
    // longer exists.
    expect(invalidated(LINKS_KEY)).toBe(true);
    expect(invalidated(PATIENTS_KEY)).toBe(true);
    expect(invalidated(CHANGE_LOG_KEY)).toBe(false);
  });
});

describe('useUpdateCaregiverPermission', () => {
  it('sends the id and the new grant, in that order and nothing else', async () => {
    const view = await renderHook(() => useUpdateCaregiverPermission(), { wrapper });
    await act(async () => {
      await view.result.current.updatePermission({
        caregiverId: CAREGIVER_ID,
        permission: 'view',
      });
    });

    // No `patientId`: the gateway derives the patient from the session, so
    // there is none here to get wrong. An extra argument would be one.
    expect(mockApi.updateCaregiverPermission).toHaveBeenCalledWith(CAREGIVER_ID, 'view');
    expect(mockApi.updateCaregiverPermission.mock.calls[0]).toHaveLength(2);
  });

  it('names the link in flight, separately from an invite being answered', async () => {
    let release: (value: CaregiverLink) => void = () => {};
    mockApi.updateCaregiverPermission.mockImplementationOnce(
      () =>
        new Promise<CaregiverLink>((resolve) => {
          release = resolve;
        }),
    );

    const view = await renderHook(() => useUpdateCaregiverPermission(), { wrapper });

    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = view.result.current.updatePermission({
        caregiverId: CAREGIVER_ID,
        permission: 'view',
      });
    });

    // The hook is separate from `useRespondToInvite` precisely so these two
    // spinners cannot be the same one — see the header on the hook.
    await waitFor(() => expect(view.result.current.pendingCaregiverId).toBe(CAREGIVER_ID));

    await act(async () => {
      release(link({ permission: 'view' }));
      await pending;
    });

    await waitFor(() => expect(view.result.current.pendingCaregiverId).toBeNull());
  });

  it('refreshes both lists on success', async () => {
    seedCaches();

    const view = await renderHook(() => useUpdateCaregiverPermission(), { wrapper });
    await act(async () => {
      await view.result.current.updatePermission({
        caregiverId: CAREGIVER_ID,
        permission: 'view',
      });
    });

    // `PatientSummary.permission` is the caregiver's copy of the same grant,
    // and it is what the app checks before offering to record a reading.
    expect(invalidated(LINKS_KEY)).toBe(true);
    expect(invalidated(PATIENTS_KEY)).toBe(true);
  });
});

describe('useRemoveCaregiverLink', () => {
  it('sends the caregiver first and the patient second', async () => {
    const view = await renderHook(() => useRemoveCaregiverLink(), { wrapper });
    await act(async () => {
      await view.result.current.removeCaregiverLink({
        caregiverId: CAREGIVER_ID,
        patientId: PATIENT_ID,
      });
    });

    // The one call in this file whose argument order the type checker cannot
    // protect: both parameters are `string`. Swapped, the request names an
    // edge that does not exist — or, for a user who is both a caregiver and
    // a patient, one the gateway will happily delete.
    expect(mockApi.removeCaregiverLink).toHaveBeenCalledWith(CAREGIVER_ID, PATIENT_ID);
    expect(mockApi.removeCaregiverLink.mock.calls[0][0]).toBe(CAREGIVER_ID);
    expect(mockApi.removeCaregiverLink.mock.calls[0][1]).toBe(PATIENT_ID);
  });

  it('refreshes both lists on success', async () => {
    seedCaches();

    const view = await renderHook(() => useRemoveCaregiverLink(), { wrapper });
    await act(async () => {
      await view.result.current.removeCaregiverLink({
        caregiverId: CAREGIVER_ID,
        patientId: PATIENT_ID,
      });
    });

    // A removed link has to leave *both* the invitations screen and the
    // patient switcher, or the caregiver keeps a patient they can no longer
    // open.
    expect(invalidated(LINKS_KEY)).toBe(true);
    expect(invalidated(PATIENTS_KEY)).toBe(true);
  });

  it('keeps both lists when the gateway refuses', async () => {
    seedCaches();
    mockApi.removeCaregiverLink.mockRejectedValue(
      new ApiError('[FORBIDDEN] ไม่มีสิทธิ์', { code: 'FORBIDDEN' }),
    );

    const view = await renderHook(() => useRemoveCaregiverLink(), { wrapper });
    await act(async () => {
      await view.result.current
        .removeCaregiverLink({ caregiverId: CAREGIVER_ID, patientId: PATIENT_ID })
        .catch(() => {});
    });

    // The link still exists. Refetching would put a row the user just tried
    // to delete back on screen with no explanation of why it is still there.
    expect(invalidated(LINKS_KEY)).toBe(false);
    expect(invalidated(PATIENTS_KEY)).toBe(false);
  });
});

describe('useUpdatePatientHealth', () => {
  it('sends the patient id and the changed fields, in that order', async () => {
    const input = { weight: 62, congenitalDisease: null };

    const view = await renderHook(() => useUpdatePatientHealth(), { wrapper });
    await act(async () => {
      await view.result.current.updatePatientHealth({ patientId: PATIENT_ID, input });
    });

    expect(mockApi.updatePatientHealth).toHaveBeenCalledWith(PATIENT_ID, input);
  });

  it('passes an explicit null through, which is how a column is cleared', async () => {
    const view = await renderHook(() => useUpdatePatientHealth(), { wrapper });
    await act(async () => {
      await view.result.current.updatePatientHealth({
        patientId: PATIENT_ID,
        input: { weight: null },
      });
    });

    // Absent and `null` are different instructions to the gateway
    // (`if (submitted === undefined) continue`), and `lib/health-form.ts` is
    // the only thing allowed to decide which one a field gets. A hook that
    // pruned nulls on the way past would make "clear my weight" unsendable.
    expect(mockApi.updatePatientHealth.mock.calls[0][1]).toEqual({ weight: null });
  });

  it('refreshes the patient list and nothing else', async () => {
    seedCaches();

    const view = await renderHook(() => useUpdatePatientHealth(), { wrapper });
    await act(async () => {
      await view.result.current.updatePatientHealth({
        patientId: PATIENT_ID,
        input: { weight: 62 },
      });
    });

    // `my-patients` carries `dob`, `weight` and `height`, so it goes stale.
    expect(invalidated(PATIENTS_KEY)).toBe(true);
    // The other two are the point of this test. `caregiver-links` describes
    // the *relationship*, which a health edit does not touch, and the change
    // log is the patient's own — the caregiver is never allowed to read it.
    // `useInvalidateCaregivers` would have refreshed both; using it here
    // would be a second request answering a question nobody asked.
    expect(invalidated(LINKS_KEY)).toBe(false);
    expect(invalidated(CHANGE_LOG_KEY)).toBe(false);
  });

  it('refreshes nothing when the grant has been withdrawn since the form opened', async () => {
    seedCaches();
    mockApi.updatePatientHealth.mockRejectedValue(
      new ApiError('[FORBIDDEN] ไม่มีสิทธิ์แก้ไขข้อมูล', { code: 'FORBIDDEN' }),
    );

    const view = await renderHook(() => useUpdatePatientHealth(), { wrapper });
    let thrown: unknown = null;
    await act(async () => {
      try {
        await view.result.current.updatePatientHealth({
          patientId: PATIENT_ID,
          input: { weight: 62 },
        });
      } catch (error) {
        thrown = error;
      }
    });

    // The refusal is thrown on rather than swallowed: the patient can
    // downgrade a grant at any moment, so this arrives for a form that
    // rendered its edit button honestly and the screen has to say so.
    expect(thrown).toBeInstanceOf(ApiError);
    expect(invalidated(PATIENTS_KEY)).toBe(false);
  });
});
