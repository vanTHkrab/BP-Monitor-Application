/**
 * The caregivers wire contract — the module where getting a variable wrong
 * means someone reads or writes a medical record they should not.
 *
 * The properties worth proving from outside:
 *
 *   - `invitePatient` normalises the contact *here*, so a display-formatted
 *     phone number never reaches the gateway's exact `User.phone` match.
 *   - `respondToInvite` carries the patient's answer as `permission`. The
 *     gateway defaults a missing one to `full`, so dropping it grants write
 *     access nobody asked for.
 *   - `updatePatientHealth` forwards the caller's already-reduced patch
 *     untouched; a second filter here is a second place for absent-vs-null to
 *     drift.
 */
const mockRequest = jest.fn();
jest.mock('@/services/api', () => ({
  graphqlRequest: (...args: unknown[]) => mockRequest(...args),
}));

import { ApiError } from '@/services/api-error';

import {
  GQL_ADD_CAREGIVER_PATIENT,
  GQL_CAREGIVER_LINKS,
  GQL_MY_PATIENTS,
  GQL_MY_PROFILE_CHANGE_LOG,
  GQL_REMOVE_CAREGIVER_PATIENT,
  GQL_RESPOND_TO_CAREGIVER_INVITE,
  GQL_UPDATE_CAREGIVER_PERMISSION,
  GQL_UPDATE_PATIENT_HEALTH,
} from './operations';
import {
  fetchCaregiverLinks,
  fetchMyPatients,
  fetchMyProfileChangeLog,
  invitePatient,
  removeCaregiverLink,
  respondToInvite,
  updateCaregiverPermission,
  updatePatientHealth,
} from './caregivers-api';

const linkPayload = (over: Record<string, unknown> = {}) => ({
  caregiverId: 'cg1',
  patientId: 'p1',
  relationship: 'child',
  caregiverName: 'สมหญิง',
  caregiverPhone: '0899999999',
  caregiverAvatar: null,
  patientName: 'สมชาย',
  patientPhone: '0812345678',
  patientAvatar: null,
  status: 'pending',
  respondedAt: null,
  permission: 'view',
  ...over,
});

const patientPayload = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  avatar: null,
  dob: null,
  relationship: null,
  permission: 'view',
  latestReading: null,
  weight: null,
  height: null,
  gender: null,
  congenitalDisease: null,
  ...over,
});

const lastQuery = () => mockRequest.mock.calls.at(-1)?.[0] as string;
const lastVariables = () => mockRequest.mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  mockRequest.mockReset();
});

describe('fetchCaregiverLinks', () => {
  it('maps a link, with an unknown status failing toward "still pending"', async () => {
    mockRequest.mockResolvedValue({
      caregiverLinks: [linkPayload({ status: 'withdrawn-by-admin' })],
    });

    const [link] = await fetchCaregiverLinks();

    expect(lastQuery()).toBe(GQL_CAREGIVER_LINKS);
    // `pending` is the only status that shows the patient an action, so an
    // unrecognised value asks rather than silently granting.
    expect(link.status).toBe('pending');
  });

  it('keeps a view-only grant read-only', async () => {
    mockRequest.mockResolvedValue({ caregiverLinks: [linkPayload({ permission: 'view' })] });

    const [link] = await fetchCaregiverLinks();

    expect(link.permission).toBe('view');
  });

  /*
   * An older gateway omits `permission` entirely. Reading that as `view` would
   * lock every caregiver out of recording for a patient who granted them
   * `full`, and the server enforces the real grant either way.
   */
  it('treats an absent permission as full rather than locking the caregiver out', async () => {
    const { permission: _omitted, ...withoutPermission } = linkPayload();
    mockRequest.mockResolvedValue({ caregiverLinks: [withoutPermission] });

    const [link] = await fetchCaregiverLinks();

    expect(link.permission).toBe('full');
  });

  it('turns an unanswered invite’s respondedAt into absent, not null', async () => {
    mockRequest.mockResolvedValue({ caregiverLinks: [linkPayload({ respondedAt: null })] });

    const [link] = await fetchCaregiverLinks();

    expect(link.respondedAt).toBeUndefined();
  });
});

describe('fetchMyPatients', () => {
  it('maps the latest reading into domain shape when there is one', async () => {
    mockRequest.mockResolvedValue({
      myPatients: [
        patientPayload({
          latestReading: {
            systolic: 150,
            diastolic: 95,
            pulse: 80,
            status: 'high',
            measuredAt: '2026-08-05T07:00:00.000Z',
          },
        }),
      ],
    });

    const [patient] = await fetchMyPatients();

    expect(lastQuery()).toBe(GQL_MY_PATIENTS);
    expect(patient.latestReading?.status).toBe('high');
    expect(patient.latestReading?.measuredAt).toBeInstanceOf(Date);
  });

  it('leaves latestReading absent for a patient who has recorded nothing', async () => {
    mockRequest.mockResolvedValue({ myPatients: [patientPayload()] });

    const [patient] = await fetchMyPatients();

    expect(patient.latestReading).toBeUndefined();
  });

  /*
   * Records today's behaviour, which is NOT what the sibling mapper does.
   * `patientHealthProfileFromGql` narrows gender to the three the form can
   * render and drops anything else, with a comment explaining why; the summary
   * mapper passes it through as a plain `string`, and `lib/health-form.ts:117`
   * then casts it to `Gender`. So an unrecognised value from `myPatients`
   * reaches the form as a selection that renders nothing — the exact failure
   * the other mapper's comment describes. Flagged for `expo-dev`; asserted
   * here so a fix is a deliberate change to this test, not a silent one.
   */
  it('passes an unrecognised gender through from myPatients (see comment)', async () => {
    mockRequest.mockResolvedValue({ myPatients: [patientPayload({ gender: 'unspecified' })] });

    const [patient] = await fetchMyPatients();

    expect(patient.gender).toBe('unspecified');
  });

  it('drops the same value on the health-profile path, which narrows it', async () => {
    mockRequest.mockResolvedValue({
      updatePatientHealth: {
        patientId: 'p1',
        dob: null,
        gender: 'unspecified',
        weight: null,
        height: null,
        congenitalDisease: null,
      },
    });

    const profile = await updatePatientHealth('p1', { weight: 70 });

    expect(profile.gender).toBeUndefined();
  });

  it('carries the five health columns through so the form can read what it writes', async () => {
    mockRequest.mockResolvedValue({
      myPatients: [
        patientPayload({
          dob: '1960-01-01T00:00:00.000Z',
          gender: 'male',
          weight: 70,
          height: 170,
          congenitalDisease: 'เบาหวาน',
        }),
      ],
    });

    const [patient] = await fetchMyPatients();

    expect(patient.dob).toBeInstanceOf(Date);
    expect(patient.gender).toBe('male');
    expect(patient.weight).toBe(70);
    expect(patient.height).toBe(170);
    expect(patient.congenitalDisease).toBe('เบาหวาน');
  });
});

describe('invitePatient', () => {
  beforeEach(() => {
    mockRequest.mockResolvedValue({ addCaregiverPatient: linkPayload() });
  });

  it('strips a display-formatted phone number to digits before sending', async () => {
    await invitePatient({ patientContact: '081-234-5678', relationship: 'child' });

    expect(lastQuery()).toBe(GQL_ADD_CAREGIVER_PATIENT);
    // The gateway does an exact `User.phone` match; the hyphenated form finds
    // nobody and surfaces as "no user with this phone number", a lie about why.
    expect(lastVariables()).toEqual({ patientContact: '0812345678', relationship: 'child' });
  });

  it('does not strip an email to digits, which would leave nothing to look up', async () => {
    await invitePatient({ patientContact: '  Some.One@Example.COM ', relationship: 'child' });

    expect(lastVariables().patientContact).toBe('some.one@example.com');
  });
});

describe('respondToInvite', () => {
  beforeEach(() => {
    mockRequest.mockResolvedValue({
      respondToCaregiverInvite: linkPayload({ status: 'accepted' }),
    });
  });

  it('sends the grant the patient actually chose', async () => {
    await respondToInvite('cg1', true, 'view');

    expect(lastQuery()).toBe(GQL_RESPOND_TO_CAREGIVER_INVITE);
    expect(lastVariables()).toEqual({ caregiverId: 'cg1', accept: true, permission: 'view' });
  });

  // The gateway defaults an absent `permission` to `full` for older clients,
  // so an accept that forgets to carry it silently grants write access to a
  // medical record.
  it('never sends an accept without a permission', async () => {
    await respondToInvite('cg1', true, 'view');

    expect(lastVariables().permission).toBeDefined();
  });

  it('still carries the field on a rejection, which the gateway then ignores', async () => {
    mockRequest.mockResolvedValue({
      respondToCaregiverInvite: linkPayload({ status: 'rejected' }),
    });

    await respondToInvite('cg1', false, 'view');

    expect(lastVariables()).toEqual({ caregiverId: 'cg1', accept: false, permission: 'view' });
  });
});

describe('updateCaregiverPermission', () => {
  it('sends the caregiver and the new grant, and no patient id to get wrong', async () => {
    mockRequest.mockResolvedValue({ updateCaregiverPermission: linkPayload({ permission: 'full' }) });

    const link = await updateCaregiverPermission('cg1', 'full');

    expect(lastQuery()).toBe(GQL_UPDATE_CAREGIVER_PERMISSION);
    // The patient is derived from the session server-side. A `patientId` here
    // would be a second, spoofable source of truth for whose record it is.
    expect(lastVariables()).toEqual({ caregiverId: 'cg1', permission: 'full' });
    expect(link.permission).toBe('full');
  });
});

describe('removeCaregiverLink', () => {
  it('names both sides of the link it is severing', async () => {
    mockRequest.mockResolvedValue({ removeCaregiverPatient: true });

    await expect(removeCaregiverLink('cg1', 'p1')).resolves.toBe(true);
    expect(lastQuery()).toBe(GQL_REMOVE_CAREGIVER_PATIENT);
    expect(lastVariables()).toEqual({ caregiverId: 'cg1', patientId: 'p1' });
  });

  it('reports a refusal as false rather than as success', async () => {
    mockRequest.mockResolvedValue({ removeCaregiverPatient: false });

    await expect(removeCaregiverLink('cg1', 'p1')).resolves.toBe(false);
  });
});

describe('updatePatientHealth', () => {
  const healthPayload = {
    patientId: 'p1',
    dob: null,
    gender: null,
    weight: 70,
    height: null,
    congenitalDisease: null,
  };

  it('forwards the reduced patch untouched, keeping a null that means "clear it"', async () => {
    mockRequest.mockResolvedValue({ updatePatientHealth: healthPayload });

    await updatePatientHealth('p1', { weight: 70, congenitalDisease: null });

    expect(lastQuery()).toBe(GQL_UPDATE_PATIENT_HEALTH);
    // No re-filtering here: `lib/health-form.ts` already decided which keys
    // are present, and a second filter would be a second place for the rule
    // to drift.
    expect(lastVariables()).toEqual({
      patientId: 'p1',
      input: { weight: 70, congenitalDisease: null },
    });
  });

  it('does not add the fields the caller left out', async () => {
    mockRequest.mockResolvedValue({ updatePatientHealth: healthPayload });

    await updatePatientHealth('p1', { weight: 70 });

    const patch = lastVariables().input as Record<string, unknown>;
    for (const untouched of ['dob', 'gender', 'height', 'congenitalDisease']) {
      // An added key with `null` in it would clear a column the user never
      // opened.
      expect(patch).not.toHaveProperty(untouched);
    }
  });

  it('returns the mapped profile', async () => {
    mockRequest.mockResolvedValue({
      updatePatientHealth: { ...healthPayload, dob: '1960-01-01T00:00:00.000Z', gender: 'male' },
    });

    const profile = await updatePatientHealth('p1', { weight: 70 });

    expect(profile.dob).toBeInstanceOf(Date);
    expect(profile.gender).toBe('male');
    expect(profile.height).toBeUndefined();
  });

  /*
   * The patient can downgrade a grant at any moment, so a refusal can arrive
   * for a form that rendered its edit button honestly. `formatErrorMessage`
   * passes the gateway's Thai message through verbatim — swallowing the code
   * here would replace it with a local guess that is wrong exactly when it
   * matters.
   */
  it('lets a FORBIDDEN from a downgraded grant through unchanged', async () => {
    const refusal = new ApiError('UpdatePatientHealth failed: [FORBIDDEN] ไม่มีสิทธิ์แก้ไข', {
      code: 'FORBIDDEN',
      httpStatus: 403,
    });
    mockRequest.mockRejectedValue(refusal);

    await expect(updatePatientHealth('p1', { weight: 70 })).rejects.toBe(refusal);
  });

  it('lets a NOT_FOUND from a severed link through too', async () => {
    mockRequest.mockRejectedValue(
      new ApiError('UpdatePatientHealth failed: [NOT_FOUND] ไม่พบความสัมพันธ์', {
        code: 'NOT_FOUND',
      }),
    );

    await expect(updatePatientHealth('p1', { weight: 70 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('fetchMyProfileChangeLog', () => {
  const logPayload = (over: Record<string, unknown> = {}) => ({
    id: 'l1',
    actorId: 'cg1',
    actorName: 'สมหญิง',
    byPatient: false,
    field: 'weight',
    oldValue: '68',
    newValue: '70',
    changedAt: '2026-08-05T10:00:00.000Z',
    ...over,
  });

  it('passes the caller’s limit through', async () => {
    mockRequest.mockResolvedValue({ myProfileChangeLog: [logPayload()] });

    await fetchMyProfileChangeLog(20);

    expect(lastQuery()).toBe(GQL_MY_PROFILE_CHANGE_LOG);
    expect(lastVariables()).toEqual({ limit: 20 });
  });

  /*
   * The gateway owns the field list and could add a sixth column before this
   * client ships again. A log whose whole job is oversight must name the
   * change even when it does not recognise the field.
   */
  it('keeps a field name this build does not recognise rather than hiding it', async () => {
    mockRequest.mockResolvedValue({ myProfileChangeLog: [logPayload({ field: 'bloodType' })] });

    const [entry] = await fetchMyProfileChangeLog(20);

    expect(entry.field).toBe('bloodType');
  });

  it('turns a cleared value into absent so the row can say "removed"', async () => {
    mockRequest.mockResolvedValue({
      myProfileChangeLog: [logPayload({ oldValue: '70', newValue: null, actorId: null })],
    });

    const [entry] = await fetchMyProfileChangeLog(20);

    expect(entry.newValue).toBeUndefined();
    expect(entry.oldValue).toBe('70');
    expect(entry.actorId).toBeUndefined();
    expect(entry.changedAt).toBeInstanceOf(Date);
  });
});
