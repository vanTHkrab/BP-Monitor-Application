/**
 * The patient's audit trail.
 *
 * What is asserted is that the screen *translates*. The gateway stores what
 * changed as three raw strings — `"weight"`, `"60"`, `"80"` — because the five
 * fields span four types; the reader is an elderly patient checking what a
 * relative did to their record. A row that renders `weight` and `male` has
 * technically displayed the data and told them nothing, so the Thai labels
 * and the units are the feature, not decoration.
 *
 * The other half is attribution: "you did this" and "someone else did this"
 * must be distinguishable in words, not only in colour.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

jest.mock('@/modules/auth', () => ({
  useSession: () => ({ user: { role: 'patient' }, userId: 'p1', isAuthenticated: true }),
}));

jest.mock('@/modules/security', () => ({
  SecurityHeader: () => null,
}));

const mockLog = {
  entries: [] as unknown[],
  isLoading: false,
  isRefetching: false,
  error: null as unknown,
  refetch: jest.fn(),
};

jest.mock('@/modules/caregivers', () => ({
  ...jest.requireActual('@/modules/caregivers'),
  useProfileChangeLog: () => mockLog,
}));

import ProfileChangesScreen from '@/app/profile-changes';
import type { ProfileChangeLogEntry } from '@/modules/caregivers';
import { renderScreen } from '../test-utils';

const entry = (over: Partial<ProfileChangeLogEntry> = {}): ProfileChangeLogEntry => ({
  id: 'e1',
  actorId: 'c1',
  actorName: 'สมหญิง ใจงาม',
  byPatient: false,
  field: 'weight',
  oldValue: '60',
  newValue: '80',
  changedAt: new Date(2026, 7, 6, 14, 30),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLog.entries = [];
  mockLog.isLoading = false;
  mockLog.isRefetching = false;
  mockLog.error = null;
});

describe('ProfileChangesScreen — rendering entries', () => {
  it('renders one row per logged field change', async () => {
    mockLog.entries = [entry(), entry({ id: 'e2', field: 'height', oldValue: '160', newValue: '165' })];

    const view = await renderScreen(<ProfileChangesScreen />);

    expect(view.getByTestId('change-log-e1')).toBeOnTheScreen();
    expect(view.getByTestId('change-log-e2')).toBeOnTheScreen();
  });

  // The raw column name and the bare number are what the database holds.
  // Neither is what the patient asked.
  it('names the field in Thai and carries the unit', async () => {
    mockLog.entries = [entry()];

    const view = await renderScreen(<ProfileChangesScreen />);

    expect(view.getByText('น้ำหนัก')).toBeOnTheScreen();
    expect(view.getByTestId('change-log-e1-old')).toHaveTextContent(/60 กก\./);
    expect(view.getByTestId('change-log-e1-new')).toHaveTextContent(/80 กก\./);
  });

  it('renders a gender change as words, not as the stored enum', async () => {
    mockLog.entries = [entry({ field: 'gender', oldValue: 'male', newValue: 'female' })];

    const view = await renderScreen(<ProfileChangesScreen />);

    expect(view.getByTestId('change-log-e1-old')).toHaveTextContent('ชาย');
    expect(view.getByTestId('change-log-e1-new')).toHaveTextContent('หญิง');
  });

  /*
   * `dob` is stored as `YYYY-MM-DD` and parsed as a *local* midnight before
   * formatting. Parsed as UTC it would render the previous day in any
   * negative-offset zone — indistinguishable, on this screen, from the
   * caregiver having saved the wrong day.
   */
  it('renders a birthday as a Thai date', async () => {
    mockLog.entries = [
      entry({ field: 'dob', oldValue: undefined, newValue: '1950-03-01' }),
    ];

    const view = await renderScreen(<ProfileChangesScreen />);

    // The 1st, not the 28th of February: `parseIsoDate` reads the stored
    // `YYYY-MM-DD` as a local midnight. `new Date('1950-03-01')` is UTC
    // midnight and would slip a day in any negative-offset zone.
    expect(view.getByTestId('change-log-e1-new')).toHaveTextContent('1 มีนาคม 2493');
  });

  it('says "not set" rather than leaving a side of the change blank', async () => {
    mockLog.entries = [entry({ field: 'congenitalDisease', oldValue: undefined, newValue: 'เบาหวาน' })];

    const view = await renderScreen(<ProfileChangesScreen />);

    expect(view.getByTestId('change-log-e1-old')).toHaveTextContent('ยังไม่ได้ระบุ');
  });

  // A field this client does not know about must still show as *something*
  // happening. Hiding it would defeat a screen whose only job is oversight.
  it('falls back to the raw field name for a field it does not know', async () => {
    mockLog.entries = [entry({ field: 'bloodType', oldValue: 'A', newValue: 'B' })];

    const view = await renderScreen(<ProfileChangesScreen />);

    expect(view.getByText('bloodType')).toBeOnTheScreen();
  });
});

describe('ProfileChangesScreen — who did it', () => {
  it('names the caregiver for an edit made on the patient’s behalf', async () => {
    mockLog.entries = [entry()];

    const view = await renderScreen(<ProfileChangesScreen />);

    expect(view.getByText(/สมหญิง ใจงาม/)).toBeOnTheScreen();
  });

  /*
   * In words, not only in colour. Part of this audience cannot rely on a
   * colour difference, and "was this me?" is the question the screen exists
   * to answer.
   */
  it('says so in words when the patient made the change themselves', async () => {
    mockLog.entries = [entry({ byPatient: true, actorName: 'สมชาย ใจดี' })];

    const view = await renderScreen(<ProfileChangesScreen />);

    expect(view.getByText('คุณแก้ไขเอง')).toBeOnTheScreen();
  });

  // Someone who finds an edit they did not expect wants to change what that
  // person can do next. Offered only when there is somebody to restrict.
  it('offers the way to the grant only when a caregiver changed something', async () => {
    mockLog.entries = [entry({ byPatient: true })];
    const own = await renderScreen(<ProfileChangesScreen />);
    expect(own.queryByTestId('profile-changes-manage')).toBeNull();

    mockLog.entries = [entry()];
    const theirs = await renderScreen(<ProfileChangesScreen />);
    expect(theirs.getByTestId('profile-changes-manage')).toBeOnTheScreen();
  });
});

describe('ProfileChangesScreen — the states around the list', () => {
  // An empty log is the good state and is worded as one: "ไม่มีข้อมูล" reads
  // as a failure to someone who opened this screen because they were worried.
  it('reassures rather than reporting a failure when nothing was changed', async () => {
    const view = await renderScreen(<ProfileChangesScreen />);

    expect(view.getByTestId('profile-changes-empty')).toBeOnTheScreen();
  });

  it('shows a loading card while the first fetch is in flight', async () => {
    mockLog.isLoading = true;

    const view = await renderScreen(<ProfileChangesScreen />);

    expect(view.getByTestId('profile-changes-loading')).toBeOnTheScreen();
    expect(view.queryByTestId('profile-changes-empty')).toBeNull();
  });

  it('does not present a failed fetch as an empty log', async () => {
    mockLog.error = new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');

    const view = await renderScreen(<ProfileChangesScreen />);

    expect(view.getByTestId('profile-changes-error')).toBeOnTheScreen();
    expect(view.queryByTestId('profile-changes-empty')).toBeNull();
  });
});
