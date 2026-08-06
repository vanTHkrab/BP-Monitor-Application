/**
 * Invitations — the caregiver's way into a patient's data (C-005).
 *
 * Before this, `activePatientId` existed and nothing set it, so home and
 * history gated on a mode no user could enter. What is asserted here is the
 * jump: that it sets the store *and* navigates, in that order, and that it is
 * only offered for a patient the app can actually name.
 */
import { router } from 'expo-router';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

jest.mock('@/modules/auth', () => ({
  useSession: () => ({ user: { role: 'caregiver' }, userId: 'c1', isAuthenticated: true }),
}));

jest.mock('@/modules/security', () => ({
  SecurityHeader: () => null,
}));

const mockUpdatePermission = jest.fn(() => Promise.resolve({}));
const mockPatients = { current: [] as Record<string, unknown>[] };
const mockLinks = { current: [] as Record<string, unknown>[] };

jest.mock('@/modules/caregivers', () => ({
  ...jest.requireActual('@/modules/caregivers'),
  useMyPatients: () => ({ patients: mockPatients.current, isLoading: false }),
  useCaregiverLinks: () => ({
    links: mockLinks.current,
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
  }),
  useRemoveCaregiverLink: () => ({ removeLink: jest.fn(), isPending: false }),
  useRespondToInvite: () => ({ respondToInvite: jest.fn(), isPending: false }),
  useUpdateCaregiverPermission: () => ({
    updatePermission: mockUpdatePermission,
    isPending: false,
  }),
}));

import InvitationsScreen from '@/app/invitations';
import { permissionLabel, useActivePatientStore } from '@/modules/caregivers';
import { fireEvent, renderScreen } from '../test-utils';

const patient = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  relationship: 'child',
  ...over,
});

const link = (over: Record<string, unknown> = {}) => ({
  caregiverId: 'c1',
  patientId: 'p1',
  caregiverName: 'สมหญิง ใจงาม',
  caregiverPhone: '0898765432',
  patientName: 'สมชาย ใจดี',
  patientPhone: '0812345678',
  relationship: 'child',
  status: 'accepted',
  permission: 'full',
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  ...over,
});

/**
 * A link where the signed-in user is the *patient* — the side that granted
 * the permission and is the only one allowed to change it. The sections are
 * derived from the data rather than from the role, so this needs no separate
 * session mock.
 */
const myCaregiver = (over: Record<string, unknown> = {}) =>
  link({
    caregiverId: 'c2',
    patientId: 'c1',
    caregiverName: 'สมศรี ใจงาม',
    ...over,
  });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(router, 'replace').mockImplementation(() => {});
  jest.spyOn(router, 'push').mockImplementation(() => {});
  useActivePatientStore.setState({ patientId: null, patient: null });
  mockPatients.current = [patient()];
  mockLinks.current = [link()];
});

describe('InvitationsScreen — entering a patient', () => {
  it('sets the viewing context and lands on the tabs', async () => {
    const view = await renderScreen(<InvitationsScreen />);

    await fireEvent.press(view.getByTestId('patient-p1-open'));

    expect(useActivePatientStore.getState().patientId).toBe('p1');
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
  });

  // The banner names the patient from the stored record, so a half-populated
  // one would render as a blank accusation of being in someone's account.
  it('stores the whole patient, not just the id', async () => {
    const view = await renderScreen(<InvitationsScreen />);

    await fireEvent.press(view.getByTestId('patient-p1-open'));

    expect(useActivePatientStore.getState().patient).toMatchObject({
      id: 'p1',
      firstname: 'สมชาย',
    });
  });

  /*
   * The link fallback renders before `myPatients` resolves and carries no
   * `PatientSummary`. Opening from it would put an unnamed patient in the
   * store — the row becomes openable a moment later instead.
   */
  it('does not offer the jump before the patient record has loaded', async () => {
    mockPatients.current = [];
    const view = await renderScreen(<InvitationsScreen />);

    expect(view.queryByTestId('patient-p1-open')).toBeNull();
    expect(view.getByTestId('patient-p1')).toBeOnTheScreen();
  });

  // "View" and "unlink" sit in one row; one mis-tap apart would be a bad
  // place to put an irreversible action.
  it('keeps the unlink action on its own hit target', async () => {
    const view = await renderScreen(<InvitationsScreen />);

    expect(view.getByTestId('patient-p1-open')).toBeOnTheScreen();
    expect(view.getByTestId('patient-p1-remove')).toBeOnTheScreen();
  });
});

/**
 * The two-tab split.
 *
 * People and requests are different jobs — one is "who has access", the other
 * is "what is waiting on me" — and before this they were one scroll where a
 * request could sit below three groups of rows. What matters is that the
 * split does not *hide* a request: the count rides on the tab and a banner on
 * the people tab points at it.
 */
describe('InvitationsScreen — tabs', () => {
  const pendingInvite = () =>
    link({ caregiverId: 'c9', patientId: 'c1', status: 'pending' });

  it('opens on the people tab, with requests one tap away', async () => {
    mockLinks.current = [link(), pendingInvite()];
    const view = await renderScreen(<InvitationsScreen />);

    expect(view.getByTestId('patient-p1')).toBeOnTheScreen();
    expect(view.queryByTestId('invite-c9')).toBeNull();

    await fireEvent.press(view.getByTestId('invitations-tab-requests'));

    expect(view.getByTestId('invite-c9')).toBeOnTheScreen();
  });

  // A request the patient never sees is the failure mode this whole screen
  // exists to avoid, and a tab is a place to not look.
  it('points at a waiting request from the people tab', async () => {
    mockLinks.current = [link(), pendingInvite()];
    const view = await renderScreen(<InvitationsScreen />);

    await fireEvent.press(view.getByTestId('pending-requests-hint'));

    expect(view.getByTestId('invite-c9')).toBeOnTheScreen();
  });

  it('shows no pointer when nothing is waiting', async () => {
    mockLinks.current = [link()];
    const view = await renderScreen(<InvitationsScreen />);

    expect(view.queryByTestId('pending-requests-hint')).toBeNull();
  });
});

/**
 * The patient can change a grant after accepting it. Before this the only
 * route from `full` to `view` was removing the link and being re-invited,
 * which drops the relationship to change one column — so in practice nobody
 * downgraded.
 */
describe('InvitationsScreen — changing a caregiver permission', () => {
  it('states the current grant on the caregiver card', async () => {
    mockLinks.current = [myCaregiver({ permission: 'view' })];
    const view = await renderScreen(<InvitationsScreen />);

    /*
     * Read off the chip's own accessibility label rather than searching the
     * screen for the text: Tamagui keeps `Sheet` content mounted while
     * closed, so both option labels are in the tree at all times and a
     * `getByText` finds two. Asserted against `lib/permission.ts` rather than
     * a literal — the chip's job is to name the right *value*, and that file
     * owns the wording.
     */
    const chip = view.getByTestId('caregiver-c2-permission');
    expect(chip.props.accessibilityLabel).toContain(permissionLabel('view'));
    expect(chip.props.accessibilityLabel).not.toContain(permissionLabel('full'));
  });

  it('sends the new grant when the patient picks the other option', async () => {
    mockLinks.current = [myCaregiver({ permission: 'full' })];
    const view = await renderScreen(<InvitationsScreen />);

    await fireEvent.press(view.getByTestId('caregiver-c2-permission'));
    await fireEvent.press(view.getByTestId('permission-sheet-view'));

    expect(mockUpdatePermission).toHaveBeenCalledWith({
      caregiverId: 'c2',
      permission: 'view',
    });
  });

  // Picking what is already granted is how someone backs out of the sheet.
  // Sending it would spend a round trip and an invalidation writing the value
  // already in the row.
  it('sends nothing when the patient picks the grant already in force', async () => {
    mockLinks.current = [myCaregiver({ permission: 'full' })];
    const view = await renderScreen(<InvitationsScreen />);

    await fireEvent.press(view.getByTestId('caregiver-c2-permission'));
    await fireEvent.press(view.getByTestId('permission-sheet-full'));

    expect(mockUpdatePermission).not.toHaveBeenCalled();
  });

  /*
   * The chip sits inside the card, but the caregiver card has no `onOpen` —
   * only the patient cards do. Asserted so that if one is ever added, the
   * permission tap does not also fire it.
   */
  it('does not open anything else when the chip is tapped', async () => {
    mockLinks.current = [myCaregiver()];
    const view = await renderScreen(<InvitationsScreen />);

    await fireEvent.press(view.getByTestId('caregiver-c2-permission'));

    expect(router.replace).not.toHaveBeenCalled();
  });
});

/**
 * The two entry points the health-edit feature adds, from opposite sides of
 * the same link.
 *
 * Both are gated, and the gates are what is asserted — an affordance offered
 * where it will be refused teaches people the app is broken, and one offered
 * in the wrong context (`myProfileChangeLog` answers about the *session*)
 * would show one person's data under another person's name.
 */
describe('InvitationsScreen — editing a patient\'s health information', () => {
  it('offers the edit affordance for a `full` link', async () => {
    mockPatients.current = [patient({ permission: 'full' })];
    const view = await renderScreen(<InvitationsScreen />);

    expect(view.getByTestId('patient-p1-edit-health')).toBeOnTheScreen();
  });

  /*
   * The gateway refuses a `view` caregiver, so offering the button would only
   * ever produce a rejection. This is not the authority — the server
   * re-decides on submit, because the patient can downgrade between this
   * render and the save — it just avoids a round trip nobody wanted.
   */
  it('offers nothing for a `view` link', async () => {
    mockPatients.current = [patient({ permission: 'view' })];
    const view = await renderScreen(<InvitationsScreen />);

    expect(view.queryByTestId('patient-p1-edit-health')).toBeNull();
    // The row itself stays: read-only access is still access.
    expect(view.getByTestId('patient-p1')).toBeOnTheScreen();
  });

  /*
   * The store is set before navigating, exactly like `openPatient`:
   * `app/patient-health.tsx` reads whose data it is about from `useSubject()`
   * rather than from a route parameter, so the other order renders one frame
   * of a form aimed at nobody.
   */
  it('sets the viewing context before pushing the edit screen', async () => {
    mockPatients.current = [patient({ permission: 'full' })];
    const view = await renderScreen(<InvitationsScreen />);

    await fireEvent.press(view.getByTestId('patient-p1-edit-health'));

    expect(useActivePatientStore.getState().patientId).toBe('p1');
    expect(router.push).toHaveBeenCalledWith('/patient-health');
    // A task on top of the list, not the mode switch `openPatient` performs.
    expect(router.replace).not.toHaveBeenCalled();
  });

  // The fallback row renders before `myPatients` resolves and carries no
  // `PatientSummary` — nothing to put in the store, so nothing to offer.
  it('offers nothing before the patient record has loaded', async () => {
    mockPatients.current = [];
    const view = await renderScreen(<InvitationsScreen />);

    expect(view.queryByTestId('patient-p1-edit-health')).toBeNull();
  });
});

describe('InvitationsScreen — the patient\'s audit trail', () => {
  it('offers the way into the change log', async () => {
    const view = await renderScreen(<InvitationsScreen />);

    await fireEvent.press(view.getByTestId('invitations-profile-changes'));

    expect(router.push).toHaveBeenCalledWith('/profile-changes');
  });

  /*
   * `myProfileChangeLog` answers about the signed-in account. A caregiver
   * inside a patient would be offered their *own* log from under a banner
   * naming somebody else — the "two people's data on one screen" failure
   * `use-subject.ts` exists to prevent, inverted.
   */
  it('hides it while a caregiver is inside a patient', async () => {
    useActivePatientStore.setState({ patientId: 'p1', patient: patient() as never });
    const view = await renderScreen(<InvitationsScreen />);

    expect(view.queryByTestId('invitations-profile-changes')).toBeNull();
  });

  // Offered whether or not a caregiver currently exists: an edit made by
  // someone since unlinked is exactly the entry someone comes looking for.
  it('stays available when there are no caregivers left', async () => {
    mockLinks.current = [];
    const view = await renderScreen(<InvitationsScreen />);

    expect(view.getByTestId('invitations-profile-changes')).toBeOnTheScreen();
  });
});
