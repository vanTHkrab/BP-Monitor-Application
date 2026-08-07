/**
 * Profile — the read mode, which is the state every visit starts in.
 *
 * Edit mode is entered by pressing, so the save/cancel pair and the
 * validation banner are interaction territory and out of scope for this
 * batch. What is pure render state is `emailSummary`, and it is the part with
 * a real consequence: "ยืนยันแล้ว" is the answer someone comes to this screen
 * for, and it gates linking a Google account. Reporting an unverified address
 * as verified sends the user off to fix a problem somewhere else.
 *
 * The account group being *present* in read mode is asserted for the mirror
 * of the reason the screen hides it while editing — both of its rows navigate
 * away, and a way off the screen beside an unsaved form is how edits get
 * lost. The hidden half needs an interaction to reach, so it is recorded here
 * rather than asserted.
 */
const mockSession = {
  current: { user: null as Record<string, unknown> | null },
};
const mockAvatar = {
  current: {
    localPreview: null as string | null,
    isUploading: false,
    error: null as string | null,
    changeAvatar: jest.fn(),
  },
};

jest.mock('@/modules/auth', () => ({
  ...jest.requireActual('@/modules/auth'),
  useSession: () => mockSession.current,
  useUpdateProfile: () => ({ updateProfile: jest.fn(), isPending: false }),
}));

jest.mock('@/modules/profile', () => ({
  ...jest.requireActual('@/modules/profile'),
  useProfileAvatar: () => mockAvatar.current,
}));

jest.mock('@/modules/security', () => ({
  SecurityHeader: () => null,
}));

import ProfileScreen from '@/app/profile';
import { renderScreen } from '../test-utils';

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  email: 'somchai@example.com',
  emailVerified: true,
  role: 'patient',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.current = { user: user() };
  mockAvatar.current = {
    localPreview: null,
    isUploading: false,
    error: null,
    changeAvatar: jest.fn(),
  };
});

describe('ProfileScreen — read mode', () => {
  it('opens in read mode, offering edit rather than save', async () => {
    const view = await renderScreen(<ProfileScreen />);

    expect(view.getByTestId('profile-edit')).toBeOnTheScreen();
    expect(view.queryByTestId('profile-save')).toBeNull();
    expect(view.queryByTestId('profile-cancel')).toBeNull();
  });

  it('shows the stored values', async () => {
    const view = await renderScreen(<ProfileScreen />);

    expect(view.getByText('สมชาย')).toBeOnTheScreen();
    expect(view.getByText('ใจดี')).toBeOnTheScreen();
  });

  /*
   * Both rows navigate away. They are offered in read mode and withdrawn
   * while editing — the withdrawal needs a press to reach, so only the
   * offered half is asserted here.
   */
  it('offers the account rows while not editing', async () => {
    const view = await renderScreen(<ProfileScreen />);

    expect(view.getByTestId('profile-email')).toBeOnTheScreen();
    expect(view.getByTestId('profile-invitations')).toBeOnTheScreen();
  });

  it('renders no banner before anything has been saved', async () => {
    const view = await renderScreen(<ProfileScreen />);

    expect(view.queryByText('บันทึกข้อมูลเรียบร้อยแล้ว')).toBeNull();
    expect(view.queryByText(/บันทึกไม่สำเร็จ/)).toBeNull();
  });
});

describe('ProfileScreen — what the email row claims', () => {
  it('says an address is verified when it is', async () => {
    const view = await renderScreen(<ProfileScreen />);

    expect(view.getByTestId('profile-email')).toHaveTextContent(
      /somchai@example\.com · ยืนยันแล้ว/,
    );
  });

  /*
   * The consequential half. An unverified address blocks linking a Google
   * account, and reporting it as verified sends the user to look for the
   * problem in the wrong place entirely.
   */
  it('says an address is unverified when it is', async () => {
    mockSession.current = { user: user({ emailVerified: false }) };
    const view = await renderScreen(<ProfileScreen />);

    expect(view.getByTestId('profile-email')).toHaveTextContent(
      /somchai@example\.com · ยังไม่ยืนยัน/,
    );
  });

  // A phone-only account has no address at all — distinct from having one
  // that is not yet verified.
  it('says an address has not been set when there is none', async () => {
    mockSession.current = { user: user({ email: null }) };
    const view = await renderScreen(<ProfileScreen />);

    expect(view.getByTestId('profile-email')).toHaveTextContent(/ยังไม่ได้ตั้ง/);
  });

  // `me` may not have resolved. The row must not claim an address is missing
  // before it knows — but it must still render rather than crash.
  it('renders without a user at all', async () => {
    mockSession.current = { user: null };
    const view = await renderScreen(<ProfileScreen />);

    expect(view.getByTestId('profile-edit')).toBeOnTheScreen();
  });
});

describe('ProfileScreen — the avatar', () => {
  it('surfaces an upload failure instead of silently keeping the old picture', async () => {
    mockAvatar.current.error = 'อัปโหลดรูปไม่สำเร็จ';
    const view = await renderScreen(<ProfileScreen />);

    expect(view.getByText('อัปโหลดรูปไม่สำเร็จ')).toBeOnTheScreen();
  });

  it('shows no avatar error when the upload is fine', async () => {
    const view = await renderScreen(<ProfileScreen />);

    expect(view.queryByText('อัปโหลดรูปไม่สำเร็จ')).toBeNull();
  });
});
