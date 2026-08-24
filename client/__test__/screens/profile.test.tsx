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
import { Alert } from 'react-native';

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

const mockUpdateProfile = jest.fn();

jest.mock('@/modules/auth', () => ({
  ...jest.requireActual('@/modules/auth'),
  useSession: () => mockSession.current,
  useUpdateProfile: () => ({ updateProfile: mockUpdateProfile, isPending: false }),
}));

jest.mock('@/modules/profile', () => ({
  ...jest.requireActual('@/modules/profile'),
  useProfileAvatar: () => mockAvatar.current,
}));

jest.mock('@/modules/security', () => ({
  SecurityHeader: () => null,
}));

import ProfileScreen from '@/app/profile';
import { fireEvent, renderScreen } from '../test-utils';

/** Runs the button at `index` of the last Alert — same helper shape as `settings.test.tsx`. */
function pressAlertButton(index: number) {
  const spy = Alert.alert as unknown as jest.Mock;
  const buttons = spy.mock.calls.at(-1)?.[2] as { onPress?: () => void }[] | undefined;
  return buttons?.[index]?.onPress?.();
}

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  email: 'somchai@example.com',
  emailVerified: true,
  dob: new Date(1980, 0, 15),
  gender: 'male',
  weight: 65,
  height: 170,
  /*
   * The string the gateway sends for a NULL column — "answered: no
   * condition", not "unanswered". It is here so the reopen-and-save case
   * below covers the congenital round trip for free: if the form ever seeded
   * the select from this *and* left the literal in the text box, or sent the
   * word back instead of `null`, that test would start seeing a mutation.
   */
  congenitalDisease: 'ไม่มี',
  role: 'patient',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockSession.current = { user: user() };
  mockAvatar.current = {
    localPreview: null,
    isUploading: false,
    error: null,
    changeAvatar: jest.fn(),
  };
  mockUpdateProfile.mockResolvedValue(undefined);
});

/*
 * One interaction case, deliberately not a suite.
 *
 * `updateProfile` is a partial update where a present-but-empty value *clears*
 * the column, so sending the whole form rewrites every column with whatever
 * this screen was holding — silently reverting anything another device
 * changed. `changedFields` is what stops that, and after the move to React
 * Hook Form it is only still safe because `profileSchema` happens to be a
 * transform-free `z.object` whose keys match `ProfileForm` exactly. Add one
 * key, or one `.transform()`, and the diff starts shipping fields nobody
 * edited — with no type error and no other test objecting.
 *
 * The rest of edit mode (validation, cancel, the banner) is covered by a plan
 * in the PR body rather than here.
 */
describe('ProfileScreen — edit mode sends only what changed', () => {
  it('posts the one edited field and nothing else', async () => {
    const view = await renderScreen(<ProfileScreen />);

    await fireEvent.press(view.getByTestId('profile-edit'));
    await fireEvent.changeText(view.getByTestId('profile-firstname'), 'สมหญิง');
    await fireEvent.press(view.getByTestId('profile-save'));

    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile).toHaveBeenCalledWith({ firstname: 'สมหญิง' });
  });

  /*
   * The wire value, which the reopen-and-save case above does **not** reach.
   *
   * `changedFields` diffs in the gateway's own rendering, so when nothing
   * changes the diff is empty and `congenitalWireValue` is never called —
   * verified by mutating it to send the literal word and watching every test
   * here stay green. This is the case that exercises it: the answer actually
   * changes, so the mapper runs, and `null` is what must go out. Sending
   * `'ไม่มี'` instead would store the word as if it were a diagnosis, because
   * the gateway has no inverse on the write path.
   */
  /*
   * The migration created no `user_informations` row for anyone missing one of
   * the four, so "no health record" is a state real accounts are in. Four empty
   * fields look exactly like four unchanged ones, and without this the first
   * save is how the user finds out — four red fields at once.
   */
  it('explains the whole block is required when the record has none', async () => {
    mockSession.current = {
      user: user({ dob: undefined, gender: undefined, weight: undefined, height: undefined }),
    };
    const view = await renderScreen(<ProfileScreen />);

    expect(view.queryByText(/กรุณากรอกให้ครบทั้ง 4 ช่อง/)).toBeNull();
    await fireEvent.press(view.getByTestId('profile-edit'));

    expect(view.getByText(/กรุณากรอกให้ครบทั้ง 4 ช่อง/)).toBeOnTheScreen();
  });

  it('stays quiet for a record that already has the block', async () => {
    const view = await renderScreen(<ProfileScreen />);

    await fireEvent.press(view.getByTestId('profile-edit'));

    expect(view.queryByText(/กรุณากรอกให้ครบทั้ง 4 ช่อง/)).toBeNull();
  });

  it('sends null, not the word, when the answer becomes "no condition"', async () => {
    mockSession.current = { user: user({ congenitalDisease: 'เบาหวาน' }) };
    const view = await renderScreen(<ProfileScreen />);

    await fireEvent.press(view.getByTestId('profile-edit'));
    await fireEvent.press(view.getByRole('radio', { name: 'ไม่มี' }));
    await fireEvent.press(view.getByTestId('profile-save'));

    expect(mockUpdateProfile).toHaveBeenCalledWith({ congenitalDisease: null });
  });

  it('sends the text when the answer becomes "has a condition"', async () => {
    const view = await renderScreen(<ProfileScreen />);

    await fireEvent.press(view.getByTestId('profile-edit'));
    await fireEvent.press(view.getByRole('radio', { name: 'มี' }));
    await fireEvent.changeText(
      view.getByTestId('profile-congenital-disease'),
      'เบาหวาน',
    );
    await fireEvent.press(view.getByTestId('profile-save'));

    expect(mockUpdateProfile).toHaveBeenCalledWith({ congenitalDisease: 'เบาหวาน' });
  });

  it('sends nothing at all when the form is reopened and left alone', async () => {
    const view = await renderScreen(<ProfileScreen />);

    await fireEvent.press(view.getByTestId('profile-edit'));
    await fireEvent.press(view.getByTestId('profile-save'));

    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
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

/*
 * `useProfileAvatar` has always supported both sources — `changeAvatar` takes
 * an `AvatarSource` — but the screen used to call it with `'library'`
 * hardcoded, so a camera capture was never reachable from here. These pin the
 * fix: tapping the avatar has to offer a real choice, not silently pick one.
 */
describe('ProfileScreen — changing the avatar', () => {
  it('offers both photo sources when the avatar is tapped', async () => {
    const view = await renderScreen(<ProfileScreen />);

    fireEvent.press(view.getByTestId('profile-avatar'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'เลือกรูปโปรไฟล์',
      'กรุณาเลือกวิธีการ',
      expect.arrayContaining([
        expect.objectContaining({ text: 'ถ่ายภาพ' }),
        expect.objectContaining({ text: 'เลือกรูปจากแกลเลอรี' }),
      ]),
    );
  });

  it('opens the camera when that option is chosen', async () => {
    const view = await renderScreen(<ProfileScreen />);

    fireEvent.press(view.getByTestId('profile-avatar'));
    await pressAlertButton(0);

    expect(mockAvatar.current.changeAvatar).toHaveBeenCalledWith('camera');
  });

  it('opens the library when that option is chosen', async () => {
    const view = await renderScreen(<ProfileScreen />);

    fireEvent.press(view.getByTestId('profile-avatar'));
    await pressAlertButton(1);

    expect(mockAvatar.current.changeAvatar).toHaveBeenCalledWith('library');
  });
});

/*
 * The scrollable form is wrapped so a field near the bottom (weight, height,
 * โรคประจำตัว) is not left under the on-screen keyboard.
 *
 * The wrapper is `KeyboardAwareScrollView` from
 * `react-native-keyboard-controller` now, not the `KeyboardAvoidingView` this
 * comment used to describe — it reads the IME insets natively and there is no
 * per-platform `behavior` left to get wrong. The testID is unchanged, which is
 * why this assertion survived the swap without anyone noticing the prose had
 * stopped being true.
 */
describe('ProfileScreen — keyboard avoidance', () => {
  it('wraps the form so the keyboard cannot cover the field being edited', async () => {
    const view = await renderScreen(<ProfileScreen />);

    expect(view.getByTestId('profile-keyboard-avoiding-view')).toBeOnTheScreen();
  });
});
